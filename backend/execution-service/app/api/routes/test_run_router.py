"""
Test Run Routes — Execution Service

Fixes applied:
  Issue 1: Start→Stop→Start — detects stale "running" status and resets before re-run.
           Also supports re-running completed/failed/stopped runs cleanly.
  Issue 2: import-excel/confirm — smart script_name matching (exact → case-insensitive
           → auto-match single script). Explicit commit ensures data is persisted.
  Issue 3: Preview — start_preview uses headless=False + noVNC instructions in response.
  Issue 4: Stale page recovery is handled in step_executor.py.
  Issue 5: Re-test — reset_for_rerun clears old results before starting again.
"""
from __future__ import annotations
import uuid
from datetime import datetime, timezone
from typing import List, Optional

import sqlalchemy as sa
import sqlalchemy as sa_raw
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.test_run_models import (
    t_test_runs, t_test_run_scripts, t_test_run_steps, t_test_run_step_results,
)
from app.services.test_run_runner import test_run_service
from app.services.excel_service import (
    build_excel, parse_excel, ImportError as ExcelImportError,
)
from app.utils.database import get_db

import structlog
log = structlog.get_logger(__name__)

router = APIRouter()


# ── Source data table ─────────────────────────────────────────────────────────
_es_meta = sa_raw.MetaData()
t_exec_scripts = sa_raw.Table("execution_scripts", _es_meta,
    sa_raw.Column("id",          sa_raw.dialects.postgresql.UUID(as_uuid=True)),
    sa_raw.Column("case_number", sa_raw.String),
    sa_raw.Column("name",        sa_raw.String),
)


async def _load_exec_steps_for_script(
    db: AsyncSession, exec_script_id: uuid.UUID
) -> list[dict]:
    """
    Load execution steps from Client DB.
    selector = Playwright locator code  → locator_code (backend-only)
    value    = test data value          → default_value
    metadata = JSON with input_type, input_parameter (field label), etc.
    """
    rows = (await db.execute(sa.text("""
        SELECT
            id,
            execution_script_id,
            step_order          AS step_no,
            description         AS step_description,
            action_type         AS action,
            selector            AS locator_code,
            value               AS default_value,
            metadata
        FROM execution_steps
        WHERE execution_script_id = :exec_script_id
        ORDER BY step_order NULLS LAST, id
    """), {"exec_script_id": exec_script_id})).mappings().all()

    result = []
    for row in rows:
        r = dict(row)
        meta = r.pop("metadata") or {}
        r["input_parameter"]     = meta.get("input_parameter")
        r["input_type"]          = meta.get("input_type")
        r["wait_ms"]             = int(meta.get("wait_ms") or 0)
        r["is_dropdown_open"]    = bool(meta.get("is_dropdown_open", False))
        r["is_option_selection"] = bool(meta.get("is_option_selection", False))
        r["take_screenshot"]     = bool(meta.get("take_screenshot", True))
        r["is_manual"]           = bool(meta.get("is_manual", False))
        result.append(r)

    return result


# ── Pydantic models ────────────────────────────────────────────────────────────

class CreateTestRunRequest(BaseModel):
    name:             str
    description:      Optional[str] = None
    browser:          str = "chromium"
    parallel_workers: int = Field(default=1, ge=1, le=16)

class AddScriptsRequest(BaseModel):
    execution_script_ids: List[uuid.UUID]
    screenshot_mode:      str = "all"

class UpdateStepRequest(BaseModel):
    step_description: Optional[str] = None
    action:           Optional[str] = None
    input_parameter:  Optional[str] = None
    input_type:       Optional[str] = None
    default_value:    Optional[str] = None
    wait_ms:          Optional[int] = None
    take_screenshot:  Optional[bool] = None
    is_active:        Optional[bool] = None

class AddStepRequest(BaseModel):
    after_step_no:    int = 0
    step_description: str = ""
    action:           str = "Click Button"
    input_parameter:  Optional[str] = None
    input_type:       Optional[str] = None
    default_value:    Optional[str] = None
    locator_code:     Optional[str] = None
    wait_ms:          int = 0
    take_screenshot:  bool = True

class InjectStepRequest(BaseModel):
    after_step_no:    int = -1
    step_description: str = "Injected step"
    action:           str = "Click Button"
    input_parameter:  Optional[str] = None
    input_type:       Optional[str] = None
    default_value:    Optional[str] = None
    locator_code:     Optional[str] = None

class GetOptionsRequest(BaseModel):
    label: str


# ── Test Run CRUD ─────────────────────────────────────────────────────────────

@router.post("/", status_code=201)
async def create_test_run(
    body: CreateTestRunRequest,
    db:   AsyncSession = Depends(get_db),
):
    run_id = uuid.uuid4()
    await db.execute(t_test_runs.insert().values(
        id=run_id, name=body.name, description=body.description,
        status="pending", browser=body.browser,
        parallel_workers=body.parallel_workers,
        total_scripts=0, passed_scripts=0, failed_scripts=0,
        created_at=datetime.now(timezone.utc),
    ))
    return {"id": str(run_id), "name": body.name, "status": "pending"}


@router.get("/")
async def list_test_runs(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        sa.select(t_test_runs).order_by(t_test_runs.c.created_at.desc())
    )).mappings().all()
    return [_run_out(r) for r in rows]


@router.get("/{run_id}")
async def get_test_run(run_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    run = (await db.execute(
        sa.select(t_test_runs).where(t_test_runs.c.id == run_id)
    )).mappings().one_or_none()
    if not run:
        raise HTTPException(404, "Test run not found")
    scripts = (await db.execute(
        sa.select(t_test_run_scripts).where(t_test_run_scripts.c.test_run_id == run_id)
    )).mappings().all()
    return {**_run_out(run), "scripts": [_trs_out(s) for s in scripts]}


@router.delete("/{run_id}", status_code=204)
async def delete_test_run(run_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    await db.execute(sa.delete(t_test_runs).where(t_test_runs.c.id == run_id))


# ── Live preview page ─────────────────────────────────────────────────────────

@router.get("/{run_id}/live-preview", response_class=HTMLResponse)
async def live_preview_page(run_id: uuid.UUID, trs_id: Optional[uuid.UUID] = None):
    """In-browser live preview — shows CDP screencast frames via WebSocket."""
    trs_filter = f'"{str(trs_id)}"' if trs_id else "null"
    return HTMLResponse(f"""<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <title>Live Preview - {run_id}</title>
    <style>
        body {{ margin:0; background:#0b1020; color:#e8eeff; font-family:sans-serif; }}
        .wrap {{ max-width:1300px; margin:20px auto; padding:0 16px; }}
        .panel {{ background:#121a30; border:1px solid #22315c; border-radius:12px;
                  padding:14px; }}
        #frame {{ margin-top:12px; width:100%; aspect-ratio:16/10;
                  object-fit:contain; border-radius:10px; background:#02050f;
                  border:1px solid #1d2b54; }}
        .meta {{ color:#9fb0df; font-size:14px; }}
        .ok {{ color:#49dcb1; }} .warn {{ color:#ffd166; }}
    </style>
</head>
<body>
<div class="wrap"><div class="panel">
    <div style="display:flex;justify-content:space-between;">
        <div>
            <strong>Run:</strong> {run_id}<br>
            <span class="meta">CDP screencast via WebSocket</span>
        </div>
        <div id="status" class="meta warn">Connecting...</div>
    </div>
    <img id="frame" alt="Live browser frame" />
    <div class="meta" id="info">Waiting for frames...</div>
    <div class="meta" style="margin-top:8px;">
        💡 Also view via noVNC: <a href="http://localhost:6080/vnc.html"
           style="color:#49dcb1;">http://localhost:6080/vnc.html</a>
    </div>
</div></div>
<script>
    const trsFilter = {trs_filter};
    const wsScheme = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${{wsScheme}}://${{location.host}}/api/v1/runs/ws/{run_id}`);
    const img = document.getElementById("frame");
    const statusEl = document.getElementById("status");
    const infoEl = document.getElementById("info");
    let frames = 0;
    ws.onopen = () => {{ statusEl.textContent="Connected"; statusEl.className="meta ok"; }};
    ws.onclose = () => {{ statusEl.textContent="Disconnected"; statusEl.className="meta warn"; }};
    ws.onmessage = (e) => {{
        try {{
            const m = JSON.parse(e.data);
            if (m.event !== "browser_frame") return;
            const p = m.payload || {{}};
            if (trsFilter && p.run_script_id !== trsFilter) return;
            if (!p.data) return;
            frames += 1;
            img.src = `data:image/jpeg;base64,${{p.data}}`;
            infoEl.textContent = `Frames received: ${{frames}}`;
        }} catch(_) {{}}
    }};
</script>
</body></html>""")


# ── Add execution scripts to a test run ──────────────────────────────────────

@router.post("/{run_id}/scripts", status_code=201)
async def add_scripts_to_run(
    run_id: uuid.UUID,
    body:   AddScriptsRequest,
    db:     AsyncSession = Depends(get_db),
):
    """Copy execution_steps for each selected script into test_run_steps."""
    run = (await db.execute(
        sa.select(t_test_runs).where(t_test_runs.c.id == run_id)
    )).mappings().one_or_none()
    if not run:
        raise HTTPException(404, "Test run not found")

    added_ids = []
    for exec_script_id in body.execution_script_ids:
        script_row = (await db.execute(
            sa.select(t_exec_scripts).where(t_exec_scripts.c.id == exec_script_id)
        )).mappings().one_or_none()

        trs_id = uuid.uuid4()
        await db.execute(t_test_run_scripts.insert().values(
            id=trs_id, test_run_id=run_id,
            execution_script_id=exec_script_id,
            case_number=script_row["case_number"] if script_row else None,
            name=script_row["name"] if script_row else None,
            status="pending",
            screenshot_mode=body.screenshot_mode,
            total_steps=0, passed_steps=0, failed_steps=0,
        ))

        steps = await _load_exec_steps_for_script(db, exec_script_id)
        log.info("Copying steps", count=len(steps), trs_id=str(trs_id))

        for idx, step in enumerate(steps, 1):
            await db.execute(t_test_run_steps.insert().values(
                id=uuid.uuid4(),
                test_run_script_id=trs_id,
                execution_step_id=step["id"],
                step_no=step.get("step_no") or idx,
                step_description=step.get("step_description", ""),
                action=step.get("action", "Action"),
                input_parameter=step.get("input_parameter"),
                input_type=step.get("input_type"),
                locator_code=step.get("locator_code"),
                default_value=step.get("default_value"),
                wait_ms=step.get("wait_ms") or 0,
                is_dropdown_open=step.get("is_dropdown_open", False),
                is_option_selection=step.get("is_option_selection", False),
                take_screenshot=step.get("take_screenshot", True),
                is_active=True,
                is_manual=step.get("is_manual", False),
                is_injected=False, is_modified=False,
            ))

        await db.execute(
            sa.update(t_test_run_scripts).where(t_test_run_scripts.c.id == trs_id)
            .values(total_steps=len(steps))
        )
        added_ids.append(str(trs_id))

    total = (await db.execute(
        sa.select(sa.func.count()).select_from(t_test_run_scripts)
        .where(t_test_run_scripts.c.test_run_id == run_id)
    )).scalar() or 0
    await db.execute(
        sa.update(t_test_runs).where(t_test_runs.c.id == run_id)
        .values(total_scripts=total)
    )
    return {"ok": True, "test_run_script_ids": added_ids}


# ── Step management ───────────────────────────────────────────────────────────

@router.get("/{run_id}/scripts/{trs_id}/steps")
async def list_run_steps(
    run_id: uuid.UUID, trs_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    steps = (await db.execute(
        sa.select(t_test_run_steps)
        .where(t_test_run_steps.c.test_run_script_id == trs_id)
        .order_by(t_test_run_steps.c.step_no)
    )).mappings().all()
    return [_step_out(s) for s in steps]


@router.patch("/{run_id}/scripts/{trs_id}/steps/{step_id}")
async def update_run_step(
    run_id: uuid.UUID, trs_id: uuid.UUID, step_id: uuid.UUID,
    body: UpdateStepRequest,
    db: AsyncSession = Depends(get_db),
):
    values = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if values:
        values["is_modified"] = True
        values["updated_at"]  = datetime.now(timezone.utc)
        await db.execute(
            sa.update(t_test_run_steps)
            .where(t_test_run_steps.c.id == step_id,
                   t_test_run_steps.c.test_run_script_id == trs_id)
            .values(**values)
        )
    row = (await db.execute(
        sa.select(t_test_run_steps).where(t_test_run_steps.c.id == step_id)
    )).mappings().one_or_none()
    if not row:
        raise HTTPException(404, "Step not found")
    return _step_out(row)


@router.post("/{run_id}/scripts/{trs_id}/steps", status_code=201)
async def add_run_step(
    run_id: uuid.UUID, trs_id: uuid.UUID,
    body: AddStepRequest,
    db: AsyncSession = Depends(get_db),
):
    # Shift up with temp offset to avoid unique constraint on step_no
    await db.execute(
        sa.update(t_test_run_steps)
        .where(t_test_run_steps.c.test_run_script_id == trs_id,
               t_test_run_steps.c.step_no > body.after_step_no)
        .values(step_no=t_test_run_steps.c.step_no + 1000)
    )
    await db.execute(
        sa.update(t_test_run_steps)
        .where(t_test_run_steps.c.test_run_script_id == trs_id,
               t_test_run_steps.c.step_no > body.after_step_no + 1000)
        .values(step_no=t_test_run_steps.c.step_no - 999)
    )
    new_id = uuid.uuid4()
    now    = datetime.now(timezone.utc)
    await db.execute(t_test_run_steps.insert().values(
        id=new_id, test_run_script_id=trs_id, execution_step_id=None,
        step_no=body.after_step_no + 1,
        step_description=body.step_description, action=body.action,
        input_parameter=body.input_parameter, input_type=body.input_type,
        locator_code=body.locator_code, default_value=body.default_value,
        wait_ms=body.wait_ms, take_screenshot=body.take_screenshot,
        is_active=True, is_manual=True, is_injected=False, is_modified=False,
        created_at=now, updated_at=now,
    ))
    row = (await db.execute(
        sa.select(t_test_run_steps).where(t_test_run_steps.c.id == new_id)
    )).mappings().one()
    return _step_out(row)


@router.delete("/{run_id}/scripts/{trs_id}/steps/{step_id}", status_code=204)
async def delete_run_step(
    run_id: uuid.UUID, trs_id: uuid.UUID, step_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    row = (await db.execute(
        sa.select(t_test_run_steps).where(t_test_run_steps.c.id == step_id)
    )).mappings().one_or_none()
    if not row:
        return
    deleted_no = row["step_no"]
    await db.execute(sa.delete(t_test_run_steps).where(t_test_run_steps.c.id == step_id))
    await db.execute(
        sa.update(t_test_run_steps)
        .where(t_test_run_steps.c.test_run_script_id == trs_id,
               t_test_run_steps.c.step_no > deleted_no)
        .values(step_no=t_test_run_steps.c.step_no + 1000)
    )
    await db.execute(
        sa.update(t_test_run_steps)
        .where(t_test_run_steps.c.test_run_script_id == trs_id,
               t_test_run_steps.c.step_no > deleted_no + 1000)
        .values(step_no=t_test_run_steps.c.step_no - 1001)
    )


# ── Excel export ──────────────────────────────────────────────────────────────

@router.get("/{run_id}/export-excel")
async def export_excel(run_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    run = (await db.execute(
        sa.select(t_test_runs).where(t_test_runs.c.id == run_id)
    )).mappings().one_or_none()
    if not run:
        raise HTTPException(404, "Test run not found")

    trs_rows = (await db.execute(
        sa.select(t_test_run_scripts).where(t_test_run_scripts.c.test_run_id == run_id)
    )).mappings().all()

    scripts_data = []
    for trs in trs_rows:
        steps = (await db.execute(
            sa.select(t_test_run_steps)
            .where(t_test_run_steps.c.test_run_script_id == trs["id"])
            .order_by(t_test_run_steps.c.step_no)
        )).mappings().all()
        scripts_data.append({
            "script_name": trs.get("name") or str(trs["id"]),
            "steps": [
                {
                    "step_no":          s["step_no"],
                    "step_description": s.get("step_description", ""),
                    "action":           s.get("action", ""),
                    "input_type":       s.get("input_type", ""),
                    "input_parameter":  s.get("input_parameter", ""),
                    "default_value":    s.get("default_value", ""),
                    "take_screenshot":  s.get("take_screenshot", True),
                    "is_active":        s.get("is_active", True),
                }
                for s in steps
            ],
        })

    xlsx_bytes = build_excel(scripts_data)
    filename   = f"TestRun_{str(run['name']).replace(' ', '_')}.xlsx"
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Excel import ──────────────────────────────────────────────────────────────

@router.post("/{run_id}/import-excel/preview")
async def import_excel_preview(run_id: uuid.UUID, file: UploadFile = File(...)):
    content = await file.read()
    try:
        rows, warnings = parse_excel(content)
    except ExcelImportError as exc:
        raise HTTPException(400, str(exc))
    return {"rows": rows, "warnings": warnings, "row_count": len(rows)}


@router.post("/{run_id}/import-excel/confirm")
async def import_excel_confirm(
    run_id: uuid.UUID,
    body:   dict,
    db:     AsyncSession = Depends(get_db),
):
    """
    Apply previewed import rows to test_run_steps.

    FIX: Smart script_name matching:
      1. Exact match on script_name key in script_map
      2. Case-insensitive match
      3. If only one script in run and only one group in rows — auto-match
      4. Explicit db.commit() ensures data is persisted

    body = {
        "rows": [...],
        "script_map": {"Script Name from Excel": "trs_uuid"}
    }
    """
    rows       = body.get("rows", [])
    script_map = body.get("script_map", {})

    if not rows:
        return {"ok": True, "scripts_updated": 0,
                "warning": "No rows provided — nothing to import"}

    # Group rows by script_name
    by_script: dict[str, list[dict]] = {}
    for row in rows:
        key = row.get("script_name", "")
        by_script.setdefault(key, []).append(row)

    # Build a case-insensitive lookup of script_map
    script_map_lower = {k.lower(): v for k, v in script_map.items()}

    # Auto-match: if exactly one script group AND one script_map entry — match them
    if len(by_script) == 1 and len(script_map) == 1:
        only_name = list(by_script.keys())[0]
        only_trs  = list(script_map.values())[0]
        script_map_lower[only_name.lower()] = only_trs
        log.info("Auto-matched single script", script_name=only_name, trs_id=only_trs)

    updated = 0
    unmatched = []

    for script_name, step_rows in by_script.items():
        # Exact match first
        trs_id_str = script_map.get(script_name)
        # Case-insensitive fallback
        if not trs_id_str:
            trs_id_str = script_map_lower.get(script_name.lower())
        if not trs_id_str:
            unmatched.append(script_name)
            log.warning("No trs_id for script_name", script_name=script_name,
                        available_keys=list(script_map.keys()))
            continue

        trs_id = uuid.UUID(trs_id_str)

        # Delete existing steps
        await db.execute(
            sa.delete(t_test_run_steps)
            .where(t_test_run_steps.c.test_run_script_id == trs_id)
        )

        # Insert imported steps
        now = datetime.now(timezone.utc)
        for step_no_idx, row in enumerate(step_rows, 1):
            await db.execute(t_test_run_steps.insert().values(
                id=uuid.uuid4(),
                test_run_script_id=trs_id,
                execution_step_id=None,
                step_no=row.get("step_no") or step_no_idx,
                step_description=row.get("step_description", ""),
                action=row.get("action", "Action"),
                input_parameter=row.get("input_parameter"),
                input_type=row.get("input_type"),
                locator_code=None,           # no locator from Excel — built at runtime
                default_value=row.get("input_value"),
                wait_ms=0,
                take_screenshot=row.get("take_screenshot", True),
                is_active=row.get("is_active", True),
                is_manual=True,
                is_injected=False,
                is_modified=False,
                is_dropdown_open=False,
                is_option_selection=False,
                created_at=now,
                updated_at=now,
            ))

        await db.execute(
            sa.update(t_test_run_scripts)
            .where(t_test_run_scripts.c.id == trs_id)
            .values(total_steps=len(step_rows))
        )
        updated += 1

    # Explicit commit — ensures all writes are flushed to DB
    await db.commit()

    result = {"ok": True, "scripts_updated": updated}
    if unmatched:
        result["unmatched_scripts"] = unmatched
        result["hint"] = (
            "The script_map key must match the 'Script Name' column from the Excel file exactly. "
            f"Unmatched names: {unmatched}. "
            f"Available script_map keys: {list(script_map.keys())}"
        )
    return result


# ── Execution start ───────────────────────────────────────────────────────────

@router.post("/{run_id}/start")
async def start_test_run(
    run_id: uuid.UUID,
    bg:     BackgroundTasks,
    db:     AsyncSession = Depends(get_db),
):
    """
    Start test run execution.

    Issue 1 fix: handles all previous statuses:
      - running + active runners  → reject (already running)
      - running + no active runners → stale state, recover and start
      - completed/failed/stopped  → reset results and re-run
      - pending                   → start fresh
    """
    run = (await db.execute(
        sa.select(t_test_runs).where(t_test_runs.c.id == run_id)
    )).mappings().one_or_none()
    if not run:
        raise HTTPException(404, "Test run not found")

    status = run["status"]

    if status == "running":
        if await test_run_service.has_active_runner(run_id):
            raise HTTPException(400, "Run is already executing. Stop it first.")
        # Stale 'running' in DB — recover and allow restart
        await test_run_service.recover_stale_running_run(run_id)
        log.info("Recovered stale running state", run_id=str(run_id))

    elif status in ("completed", "failed", "stopped", "partial"):
        # Re-run: clear previous results and reset to pending
        await test_run_service.reset_for_rerun(run_id)
        log.info("Reset run for re-execution", run_id=str(run_id), prev_status=status)

    bg.add_task(test_run_service.start_run, run_id)
    return {"ok": True, "run_id": str(run_id), "ws_room": str(run_id)}


# ── Preview ───────────────────────────────────────────────────────────────────

@router.post("/{run_id}/scripts/{trs_id}/start-preview")
async def start_preview(run_id: uuid.UUID, trs_id: uuid.UUID):
    """
    Launch a VISIBLE browser (headless=False) for this script.

    The browser window opens on the Xvfb virtual display (:99).
    View it two ways:
      1. noVNC:     http://localhost:6080/vnc.html
      2. Screencast: GET /api/v1/test-runs/{run_id}/live-preview?trs_id={trs_id}
    """
    await test_run_service.start_preview(run_id, trs_id)
    return {
        "ok":         True,
        "trs_id":     str(trs_id),
        "novnc_url":  "http://localhost:6080/vnc.html",
        "stream_url": f"/api/v1/test-runs/{run_id}/live-preview?trs_id={trs_id}",
        "message":    "Preview browser launching. Watch via noVNC or stream_url.",
    }


@router.post("/{run_id}/scripts/{trs_id}/stop-preview", status_code=204)
async def stop_preview(run_id: uuid.UUID, trs_id: uuid.UUID):
    """Stop preview browser and close the session."""
    await test_run_service.stop_script(trs_id)


# ── Per-script pause / resume / stop ─────────────────────────────────────────

@router.post("/{run_id}/scripts/{trs_id}/pause")
async def pause_script(run_id: uuid.UUID, trs_id: uuid.UUID):
    ok = await test_run_service.pause_script(trs_id)
    if not ok:
        raise HTTPException(404, "Script not currently running")
    return {"ok": True, "trs_id": str(trs_id), "status": "paused"}


@router.post("/{run_id}/scripts/{trs_id}/resume")
async def resume_script(run_id: uuid.UUID, trs_id: uuid.UUID):
    ok = await test_run_service.resume_script(trs_id)
    if not ok:
        raise HTTPException(404, "Script not currently paused")
    return {"ok": True, "trs_id": str(trs_id), "status": "running"}


@router.post("/{run_id}/scripts/{trs_id}/stop")
async def stop_script(run_id: uuid.UUID, trs_id: uuid.UUID):
    ok = await test_run_service.stop_script(trs_id)
    return {"ok": ok, "trs_id": str(trs_id), "status": "stopped"}


# ── Run-level pause / resume / stop ──────────────────────────────────────────

@router.post("/{run_id}/pause-all")
async def pause_run(run_id: uuid.UUID):
    n = await test_run_service.pause_run(run_id)
    return {"ok": True, "paused": n}


@router.post("/{run_id}/resume-all")
async def resume_run(run_id: uuid.UUID):
    n = await test_run_service.resume_run(run_id)
    return {"ok": True, "resumed": n}


@router.post("/{run_id}/stop-all")
async def stop_run(run_id: uuid.UUID):
    """
    Stop all scripts in the run and update DB status to 'stopped'.
    Issue 1 fix: DB is always updated regardless of in-memory runner state.
    """
    n = await test_run_service.stop_run(run_id)
    return {"ok": True, "stopped": n}


# ── Step injection while paused ──────────────────────────────────────────────

@router.post("/{run_id}/scripts/{trs_id}/inject-step", status_code=201)
async def inject_step(
    run_id: uuid.UUID,
    trs_id: uuid.UUID,
    body:   InjectStepRequest,
    db:     AsyncSession = Depends(get_db),
):
    """Inject a step while paused. Saves to DB and queues for immediate execution."""
    after_step_no = body.after_step_no
    now    = datetime.now(timezone.utc)
    new_id = uuid.uuid4()

    await db.execute(
        sa.update(t_test_run_steps)
        .where(t_test_run_steps.c.test_run_script_id == trs_id,
               t_test_run_steps.c.step_no > after_step_no)
        .values(step_no=t_test_run_steps.c.step_no + 1000)
    )
    await db.execute(
        sa.update(t_test_run_steps)
        .where(t_test_run_steps.c.test_run_script_id == trs_id,
               t_test_run_steps.c.step_no > after_step_no + 1000)
        .values(step_no=t_test_run_steps.c.step_no - 999)
    )
    await db.execute(t_test_run_steps.insert().values(
        id=new_id, test_run_script_id=trs_id, execution_step_id=None,
        step_no=after_step_no + 1,
        step_description=body.step_description, action=body.action,
        input_parameter=body.input_parameter, input_type=body.input_type,
        locator_code=body.locator_code, default_value=body.default_value,
        wait_ms=0, take_screenshot=True,
        is_active=True, is_manual=True, is_injected=True, is_modified=False,
        created_at=now, updated_at=now,
    ))

    step_dict = {
        "id":               new_id,
        "step_no":          after_step_no + 1,
        "step_description": body.step_description,
        "action":           body.action,
        "input_parameter":  body.input_parameter or "",
        "input_type":       body.input_type or "",
        "locator_code":     body.locator_code,
        "default_value":    body.default_value or "",
        "input_value":      body.default_value or "",
        "take_screenshot":  True,
        "is_manual":        True,
    }
    await test_run_service.inject_step(trs_id, step_dict, after_step_no)
    return {"ok": True, "step_id": str(new_id), "step_no": after_step_no + 1}


# ── Live page element scanning ────────────────────────────────────────────────

@router.post("/{run_id}/scripts/{trs_id}/scan-elements")
async def scan_elements(run_id: uuid.UUID, trs_id: uuid.UUID):
    """Return all visible interactive elements on the live Oracle page."""
    elements = await test_run_service.scan_page_elements(trs_id)
    return {"elements": elements, "count": len(elements)}


@router.post("/{run_id}/scripts/{trs_id}/get-options")
async def get_options(run_id: uuid.UUID, trs_id: uuid.UUID, body: GetOptionsRequest):
    """Fetch dropdown options for a given field from the live page."""
    options = await test_run_service.get_dropdown_options(trs_id, body.label)
    return {"label": body.label, "options": options}


# ── Results ───────────────────────────────────────────────────────────────────

@router.get("/{run_id}/scripts/{trs_id}/results")
async def get_step_results(
    run_id: uuid.UUID, trs_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        sa.select(t_test_run_step_results)
        .where(t_test_run_step_results.c.test_run_script_id == trs_id)
        .order_by(t_test_run_step_results.c.step_no)
    )).mappings().all()
    return [_result_out(r) for r in rows]


@router.get("/{run_id}/scripts/{trs_id}/results/{result_id}/screenshot")
async def get_screenshot(
    run_id: uuid.UUID, trs_id: uuid.UUID, result_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    row = (await db.execute(
        sa.select(t_test_run_step_results)
        .where(t_test_run_step_results.c.id == result_id)
    )).mappings().one_or_none()
    if not row or not row.get("screenshot_b64"):
        raise HTTPException(404, "Screenshot not found")
    return {"screenshot_b64": row["screenshot_b64"]}


# ── Serialisers ───────────────────────────────────────────────────────────────

def _run_out(r) -> dict:
    return {
        "id":               str(r["id"]),
        "name":             r["name"],
        "description":      r.get("description"),
        "status":           r["status"],
        "browser":          r["browser"],
        "parallel_workers": r["parallel_workers"],
        "total_scripts":    r["total_scripts"],
        "passed_scripts":   r["passed_scripts"],
        "failed_scripts":   r["failed_scripts"],
        "started_at":       r["started_at"].isoformat()  if r.get("started_at")  else None,
        "ended_at":         r["ended_at"].isoformat()    if r.get("ended_at")    else None,
        "created_at":       r["created_at"].isoformat()  if r.get("created_at")  else None,
    }

def _trs_out(r) -> dict:
    return {
        "id":                   str(r["id"]),
        "test_run_id":          str(r["test_run_id"]),
        "execution_script_id":  str(r["execution_script_id"]),
        "case_number":          r.get("case_number"),
        "name":                 r.get("name"),
        "status":               r["status"],
        "screenshot_mode":      r["screenshot_mode"],
        "total_steps":          r["total_steps"],
        "passed_steps":         r["passed_steps"],
        "failed_steps":         r["failed_steps"],
        "duration_ms":          r.get("duration_ms"),
        "error_summary":        r.get("error_summary"),
        "started_at":           r["started_at"].isoformat() if r.get("started_at") else None,
        "ended_at":             r["ended_at"].isoformat()   if r.get("ended_at")   else None,
    }

def _step_out(s) -> dict:
    return {
        "id":                  str(s["id"]),
        "test_run_script_id":  str(s["test_run_script_id"]),
        "execution_step_id":   str(s["execution_step_id"]) if s.get("execution_step_id") else None,
        "step_no":             s["step_no"],
        "step_description":    s.get("step_description", ""),
        "action":              s.get("action", ""),
        "input_parameter":     s.get("input_parameter") or "",
        "input_type":          s.get("input_type") or "",
        "default_value":       s.get("default_value") or "",
        "wait_ms":             s.get("wait_ms") or 0,
        "take_screenshot":     bool(s.get("take_screenshot")),
        "is_active":           bool(s.get("is_active")),
        "is_manual":           bool(s.get("is_manual")),
        "is_injected":         bool(s.get("is_injected")),
        "is_modified":         bool(s.get("is_modified")),
    }

def _result_out(r) -> dict:
    return {
        "id":                  str(r["id"]),
        "test_run_script_id":  str(r["test_run_script_id"]),
        "test_run_step_id":    str(r["test_run_step_id"]) if r.get("test_run_step_id") else None,
        "step_no":             r["step_no"],
        "step_description":    r.get("step_description"),
        "action":              r.get("action"),
        "input_parameter":     r.get("input_parameter"),
        "input_value":         r.get("input_value"),
        "status":              r["status"],
        "started_at":          r["started_at"].isoformat() if r.get("started_at") else None,
        "ended_at":            r["ended_at"].isoformat()   if r.get("ended_at")   else None,
        "duration_ms":         r.get("duration_ms"),
        "retry_count":         r.get("retry_count", 0),
        "has_screenshot":      bool(r.get("screenshot_b64")),
        "error_message":       r.get("error_message"),
    }