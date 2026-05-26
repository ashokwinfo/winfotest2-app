"""Recording Router - start/stop + step saving + full script encryption"""

from __future__ import annotations
import io
import json
import zipfile
from typing import Optional
from fastapi.responses import Response as FastAPIResponse
from pydantic import BaseModel
from app.models.database import Module, Feature, Process, Product, script_processes
import uuid
import re
from fastapi import APIRouter, Depends, HTTPException, WebSocket
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import TestScript, MasterStep, PlaywrightCode, RecordingSession
from app.models.domain import (
    StartRecordingRequest, StopRecordingRequest, RecordingSessionResponse,
)
from app.services.session_manager import session_manager
from app.services.code_generator import code_generator
from app.utils.database import get_db
from app.utils.encryption import encryption_service
from app.utils.settings import settings
from app.websockets.recording_ws_handler import handle_recording_ws
import sqlalchemy as sa
import structlog

class ExportZipRequest(BaseModel):
    script_ids: list[uuid.UUID]

router = APIRouter()
log = structlog.get_logger(__name__)


@router.post("/start", response_model=RecordingSessionResponse, status_code=201)
async def start_recording(body: StartRecordingRequest, db: AsyncSession = Depends(get_db)):
    target_url = (body.target_url or settings.ORACLE_ERP_URL or "").strip()
    browser    = (body.browser or settings.DEFAULT_BROWSER).strip()
    if not target_url:
        raise HTTPException(400, "No target_url provided and ORACLE_ERP_URL is not set.")

    script = await db.get(TestScript, body.script_id)
    if not script:
        raise HTTPException(404, f"Script {body.script_id} not found.")

    db.add(RecordingSession(
        script_id=body.script_id, session_key="pending",
        status="starting", browser=browser, target_url=target_url,
    ))
    await db.flush()

    key = await session_manager.start(body.script_id, target_url, browser)

    await db.execute(
        sa.update(RecordingSession)
        .where(RecordingSession.script_id == body.script_id,
               RecordingSession.status == "starting")
        .values(session_key=key, status="active")
    )

    active = session_manager.get(key)
    return RecordingSessionResponse(
        session_key=key, script_id=body.script_id, status="active",
        started_at=active.started_at, target_url=target_url,
        websocket_url=f"/api/v1/recording/ws/{key}",
    )


@router.post("/stop", status_code=200)
async def stop_recording(body: StopRecordingRequest, db: AsyncSession = Depends(get_db)):
    active = session_manager.get(body.session_key)
    if not active:
        raise HTTPException(404, f"No active session: {body.session_key}")

    script_id = active.script_id
    script    = await db.get(TestScript, script_id)
    actions   = await session_manager.stop(body.session_key)

    await db.execute(
        sa.update(RecordingSession)
        .where(RecordingSession.session_key == body.session_key)
        .values(status="completed", ended_at=sa.func.now())
    )

    if not actions:
        await db.commit()
        return {"saved": 0, "session_key": body.session_key, "message": "No actions recorded."}

    # ── Step 1: Save MasterSteps — locator_code stored as PLAIN TEXT ─────────
    # Plain text is required here so the execution service can read and run it.
    saved = await _save_actions(db, script_id, actions)

    # ── Step 2: Assemble full script + ENCRYPT + store in playwright_code ─────
    # This is the full runnable .py file stored encrypted for audit/export.
    # master_steps.locator_code  = plain  (per-step, used by execution service)
    # playwright_code.encrypted_code = encrypted  (full script, used for export)
    if script:
        saved_steps = (await db.execute(
            select(MasterStep)
            .where(MasterStep.script_id == script_id, MasterStep.is_active == True)
            .order_by(MasterStep.step_no)
        )).scalars().all()

        full_code = code_generator.generate(
            script_name=script.name,
            case_number=script.case_number,
            steps=[{
                "step_no":          s.step_no,
                "step_description": s.step_description,
                "action":           s.action,
                "input_parameter":  s.input_parameter or "",
                "locator_code":     s.locator_code or "",
                "default_value":    s.default_value or "",
            } for s in saved_steps],
            target_url=active.target_url,
        )

        encrypted = encryption_service.encrypt(full_code)
        code_hash = encryption_service.hash_code(full_code)

        existing = (await db.execute(
            select(PlaywrightCode).where(PlaywrightCode.script_id == script_id)
        )).scalar_one_or_none()

        if existing:
            existing.encrypted_code = encrypted
            existing.code_hash      = code_hash
        else:
            db.add(PlaywrightCode(
                script_id=script_id,
                encrypted_code=encrypted,
                code_hash=code_hash,
            ))

    await db.commit()
    log.info("Recording stopped", session=body.session_key,
             script_id=str(script_id), steps=saved)
    return {
        "saved":      saved,
        "session_key": body.session_key,
        "script_id":  str(script_id),
        "encrypted":  bool(script),
    }


@router.websocket("/ws/{session_key}")
async def recording_ws(websocket: WebSocket, session_key: str):
    await handle_recording_ws(websocket, session_key)


# ── _save_actions ─────────────────────────────────────────────────────────────

async def _save_actions(db: AsyncSession, script_id: uuid.UUID, actions: list) -> int:
    await db.execute(
        sa.update(MasterStep)
        .where(MasterStep.script_id == script_id, MasterStep.is_active == True)
        .values(is_active=False)
    )
    await db.flush()

    step_no = 1
    db.add(MasterStep(
        script_id=script_id, step_no=step_no,
        step_description="Login into Oracle Application",
        action="Login into Application(OJ)",
        input_parameter="Login", input_type="Other",
        locator_code=None, default_value=None,
        take_screenshot=False, is_active=True, is_manual=False,
    ))
    step_no += 1

    for action in actions:
        info        = action.get("info") or {}
        code        = action.get("code", "")
        tmpl        = action.get("locator_template") or code or None
        value       = action.get("value", "") or ""
        comment     = action.get("comment", "")
        action_type = _derive_action(code, comment, info)
        input_param = _derive_input_param(info, code)
        input_type  = _derive_input_type(action_type)
        step_desc   = _derive_description(comment, info, action_type)

        db.add(MasterStep(
            script_id=script_id, step_no=step_no,
            step_description=step_desc,
            action=action_type,
            input_parameter=input_param,
            input_type=input_type,
            locator_code=tmpl,          # PLAIN TEXT in master DB
            default_value=value or None,
            wait_ms=_derive_wait(action_type,
                                 action.get("is_dropdown_open", False),
                                 action.get("is_option_selection", False)),
            is_dropdown_open=action.get("is_dropdown_open", False),
            is_option_selection=action.get("is_option_selection", False),
            take_screenshot=True, is_active=True,
            is_manual=bool(action.get("manual", False)),
        ))
        step_no += 1

    await db.commit()
    return step_no - 2


# ── Derivation helpers ────────────────────────────────────────────────────────

def _derive_description(comment: str, info: dict, action_type: str = "") -> str:
    c = comment.lstrip("# ").strip()
    if c: return c[:200]
    evt = info.get("evt", ""); role = info.get("role", "")
    if evt == "fill":    return "Enter value"
    if role == "button": return "Click button"
    if role == "tile":   return "Navigate"
    if role == "link":   return "Click link"
    return "Action"


def _derive_action(code: str, comment: str, info: dict) -> str:
    role = info.get("role", ""); evt = info.get("evt", ""); cmt = comment.lower()
    if "page.goto("   in code:               return "Login into Application(OJ)"
    if role in ("adf_drop", "adf_lov"):      return "Open Dropdown"
    if role == "option":                     return "Select Option"
    if role in ("tile", "menuitem"):         return "Navigate"
    if evt == "fill":
        if "combobox"   in code:             return "Enter Value - Dropdown"
        if "spinbutton" in code:             return "Enter Value Text Field(Oj)"
        if role == "date_input":             return "Fill Date"
        return "Enter Value - Text Field"
    if evt == "select":                      return "Dropdown Values"
    if evt == "keydown":
        key = info.get("key", "")
        if "Enter" in key:                   return "Key - Enter"
        if "Tab"   in key:                   return "Key - Tab"
        return "Key - Press"
    if evt == "check":                       return "Check"
    if '"__dg__:' in code:                   return "Enter Value - Dropdown"
    if ".click(" in code:
        if "button" in cmt:                  return "Click Button"
        if "link"   in cmt:                  return "Click Link"
        if "tile"   in cmt:                  return "Navigate"
        if "date picker" in cmt:             return "Date Picker"
        return "Click"
    return "Action"


def _derive_input_param(info: dict, code: str) -> str | None:
    label = (info.get("label") or "").strip()
    text  = (info.get("text")  or "").strip()
    title = (info.get("title") or "").strip()
    role  = (info.get("role")  or "").strip()
    if "page.goto(" in code:           return "Login"
    if role in ("option", "lov_row"):  return text or label or None
    if role == "tile":                 return title or label or text or None
    if role == "gridcell":             return text or None
    if label:                          return label
    if text and len(text) < 80:        return text
    return title or None


def _derive_input_type(action: str) -> str:
    return {
        "Enter Value - Text Field":   "Textbox",
        "Enter Value Text Field(Oj)": "Textbox",
        "Enter Value - Dropdown":     "Dropdown",
        "Open Dropdown":              "Dropdown",
        "Select Option":              "Dropdown",
        "Dropdown Values":            "Dropdown",
        "Click Button":               "Button",
        "Click Link":                 "Link",
        "Navigate":                   "Navigate",
        "Date Picker":                "Date",
        "Select Date":                "Date",
        "Fill Date":                  "Date",
        "Check":                      "Checkbox",
        "Login into Application(OJ)": "Other",
    }.get(action, "Other")


def _derive_wait(action: str, is_dd: bool, is_opt: bool) -> int:
    return 0

# ── Export ZIP (called by Distribution Service) ───────────────────────────────

@router.post("/export-zip", status_code=200)
async def export_scripts_zip(
    body: ExportZipRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Package selected scripts + their master steps + hierarchy into a ZIP archive.
    Called by the Distribution Service instead of it connecting directly to Master DB.
    Returns: application/zip with manifest.json and scripts.json inside.
    """
    scripts_data = []

    for sid in body.script_ids:
        script = await db.get(TestScript, sid)
        if not script or script.is_deleted or script.status != "valid":
            continue

        # Steps
        steps_rows = (await db.execute(
            select(MasterStep)
            .where(MasterStep.script_id == sid, MasterStep.is_active == True)
            .order_by(MasterStep.step_no)
        )).scalars().all()

        # Process associations
        proc_ids = [
            str(r[0]) for r in (await db.execute(
                select(script_processes.c.process_id)
                .where(script_processes.c.script_id == sid)
            )).all()
        ]

        # Hierarchy
        module  = await db.get(Module,  script.module_id)  if script.module_id  else None
        product = await db.get(Product, module.product_id) if module else None
        feature = await db.get(Feature, script.feature_id) if script.feature_id else None

        # Processes for this script
        processes_data = []
        for pid_str in proc_ids:
            proc = await db.get(Process, uuid.UUID(pid_str))
            if proc:
                processes_data.append({
                    "id": str(proc.id), "name": proc.name,
                    "module_id": str(proc.module_id),
                    "feature_id": str(proc.feature_id) if proc.feature_id else None,
                })

        scripts_data.append({
            "script": {
                "id":           str(script.id),
                "case_number":  script.case_number,
                "name":         script.name,
                "description":  script.description,
                "role":         script.role,
                "script_type":  script.script_type,
                "status":       script.status,
                "labels":       script.labels or [],
                "module_id":    str(script.module_id),
                "feature_id":   str(script.feature_id) if script.feature_id else None,
                "process_ids":  proc_ids,
            },
            "product": {
                "id": str(product.id), "name": product.name,
                "abbreviation": product.abbreviation,
            } if product else None,
            "module": {
                "id": str(module.id), "name": module.name,
                "abbreviation": module.abbreviation,
                "product_id": str(module.product_id),
            } if module else None,
            "feature": {
                "id": str(feature.id), "name": feature.name,
                "abbreviation": feature.abbreviation,
                "module_id": str(feature.module_id),
            } if feature else None,
            "processes": processes_data,
            "steps": [
                {
                    "id":                str(s.id),
                    "step_no":           s.step_no,
                    "step_description":  s.step_description,
                    "action":            s.action,
                    "input_parameter":   s.input_parameter,
                    "input_type":        s.input_type,
                    "locator_code":      s.locator_code,   # plain-text template
                    "default_value":     s.default_value,
                    "wait_ms":           s.wait_ms,
                    "is_dropdown_open":  s.is_dropdown_open,
                    "is_option_selection": s.is_option_selection,
                    "take_screenshot":   s.take_screenshot,
                    "is_manual":         s.is_manual,
                }
                for s in steps_rows
            ],
        })

    # Build ZIP in memory
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            "manifest.json",
            json.dumps({"version": "1.0", "script_count": len(scripts_data)}),
        )
        zf.writestr("scripts.json", json.dumps(scripts_data, default=str))

    return FastAPIResponse(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=scripts_export.zip"},
    )


@router.get("/export-zip-bulk", status_code=200)
async def export_scripts_zip_bulk(
    release_id: Optional[uuid.UUID] = None,
    module_id:  Optional[uuid.UUID] = None,
    process_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Export ALL valid scripts filtered by module/process scope.
    Called by Distribution Service's bulk export endpoint.
    """
    stmt = select(TestScript).where(
        TestScript.is_deleted == False,
        TestScript.status == "valid",
    )
    if module_id:
        stmt = stmt.where(TestScript.module_id == module_id)
    if process_id:
        subq = select(script_processes.c.script_id).where(
            script_processes.c.process_id == process_id
        )
        stmt = stmt.where(TestScript.id.in_(subq))

    scripts = (await db.execute(stmt)).scalars().all()
    # Reuse the existing export-zip logic
    return await export_scripts_zip(
        ExportZipRequest(script_ids=[s.id for s in scripts]),
        db=db,
    )