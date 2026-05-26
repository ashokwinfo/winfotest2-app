"""
app/services/test_run_runner.py

Orchestrates Test Run execution using the V3-proven StepRunner engine.

Fixes applied:
  - start_preview now uses headless=False (visible browser via Xvfb/noVNC)
  - stop_run properly resets DB status so Start→Stop→Start works
  - Re-run support: clears old step results and resets script statuses
"""
from __future__ import annotations
import asyncio
import uuid
from datetime import datetime, timezone
from typing import Optional

import sqlalchemy as sa
import structlog

from app.models.test_run_models import (
    t_test_runs, t_test_run_scripts, t_test_run_steps, t_test_run_step_results,
)
from app.services.step_executor import StepRunner, runner_manager
from app.utils.database import db_manager
from app.utils.settings import settings
from app.websockets.execution_ws_handler import ws_manager

log = structlog.get_logger(__name__)


class _TrsMap:
    def __init__(self): self._map: dict[str, str] = {}
    def set(self, trs_id, rid): self._map[str(trs_id)] = rid
    def get(self, trs_id) -> Optional[str]: return self._map.get(str(trs_id))
    def remove(self, trs_id): self._map.pop(str(trs_id), None)

trs_map = _TrsMap()


class TestRunService:

    async def has_active_runner(self, run_id: uuid.UUID) -> bool:
        """True when at least one script in this run has a live runner in memory."""
        for trs_id in await self._trs_ids(run_id):
            if trs_map.get(trs_id):
                return True
        return False

    async def recover_stale_running_run(self, run_id: uuid.UUID) -> int:
        """
        Mark stale DB rows as stopped when run is marked 'running' in DB
        but no runner is alive in memory. Called automatically on restart.
        """
        if await self.has_active_runner(run_id):
            return 0
        now = datetime.now(timezone.utc)
        async with db_manager.session() as db:
            result = await db.execute(
                sa.update(t_test_run_scripts)
                .where(
                    t_test_run_scripts.c.test_run_id == run_id,
                    t_test_run_scripts.c.status.in_(["running", "pending"]),
                )
                .values(status="stopped", ended_at=now)
            )
            await db.execute(
                sa.update(t_test_runs)
                .where(t_test_runs.c.id == run_id,
                       t_test_runs.c.status.in_(["running", "pending"]))
                .values(status="stopped", ended_at=now)
            )
            await db.commit()
        return int(result.rowcount or 0)

    async def reset_for_rerun(self, run_id: uuid.UUID) -> None:
        """
        Clear previous execution results and reset script statuses to 'pending'.
        Called before starting a run that has previously completed/failed/stopped.
        """
        now = datetime.now(timezone.utc)
        async with db_manager.session() as db:
            # Get all trs_ids for this run
            trs_rows = (await db.execute(
                sa.select(t_test_run_scripts.c.id)
                .where(t_test_run_scripts.c.test_run_id == run_id)
            )).scalars().all()

            for trs_id in trs_rows:
                # Clear previous step results
                await db.execute(
                    sa.delete(t_test_run_step_results)
                    .where(t_test_run_step_results.c.test_run_script_id == trs_id)
                )
                # Reset script status
                await db.execute(
                    sa.update(t_test_run_scripts)
                    .where(t_test_run_scripts.c.id == trs_id)
                    .values(
                        status="pending",
                        started_at=None,
                        ended_at=None,
                        passed_steps=0,
                        failed_steps=0,
                        error_summary=None,
                    )
                )

            # Reset run status
            await db.execute(
                sa.update(t_test_runs)
                .where(t_test_runs.c.id == run_id)
                .values(
                    status="pending",
                    started_at=None,
                    ended_at=None,
                    passed_scripts=0,
                    failed_scripts=0,
                )
            )
            await db.commit()
        log.info("Reset run for re-execution", run_id=str(run_id))

    async def start_run(self, test_run_id: uuid.UUID) -> None:
        async with db_manager.session() as db:
            run = (await db.execute(
                sa.select(t_test_runs).where(t_test_runs.c.id == test_run_id)
            )).mappings().one_or_none()
            if not run:
                log.error("TestRun not found", run_id=str(test_run_id)); return

            browser          = run["browser"]
            parallel_workers = max(1, run["parallel_workers"])

            await db.execute(
                sa.update(t_test_runs).where(t_test_runs.c.id == test_run_id)
                .values(status="running", started_at=datetime.now(timezone.utc))
            )
            await db.commit()

            trs_rows = (await db.execute(
                sa.select(t_test_run_scripts)
                .where(t_test_run_scripts.c.test_run_id == test_run_id)
            )).mappings().all()

        if not trs_rows:
            async with db_manager.session() as db:
                await db.execute(
                    sa.update(t_test_runs).where(t_test_runs.c.id == test_run_id)
                    .values(status="completed", ended_at=datetime.now(timezone.utc))
                )
                await db.commit()
            return

        sem      = asyncio.Semaphore(parallel_workers)
        outcomes = await asyncio.gather(*[
            self._run_one_script(test_run_id, uuid.UUID(str(r["id"])), browser, sem)
            for r in trs_rows
        ], return_exceptions=True)

        passed = sum(1 for o in outcomes if o is True)
        failed = sum(1 for o in outcomes if o is not True)
        final  = (
            "stopped"   if all(o == "stopped" for o in outcomes) else
            "failed"    if failed == len(outcomes) else
            "partial"   if failed > 0 else
            "completed"
        )

        async with db_manager.session() as db:
            await db.execute(
                sa.update(t_test_runs).where(t_test_runs.c.id == test_run_id)
                .values(status=final, ended_at=datetime.now(timezone.utc),
                        passed_scripts=passed, failed_scripts=failed)
            )
            await db.commit()

        await ws_manager.broadcast(test_run_id, "run_finished", {
            "run_id": str(test_run_id), "status": final,
            "passed": passed, "failed": failed,
        })

    async def _run_one_script(self, test_run_id, trs_id, browser,
                               sem, headless=None, preview=False):
        async with sem:
            async with db_manager.session() as db:
                trs = (await db.execute(
                    sa.select(t_test_run_scripts).where(t_test_run_scripts.c.id == trs_id)
                )).mappings().one_or_none()
                if not trs: return False

                await db.execute(
                    sa.update(t_test_run_scripts).where(t_test_run_scripts.c.id == trs_id)
                    .values(status="running", started_at=datetime.now(timezone.utc))
                )
                await db.commit()

                steps = (await db.execute(
                    sa.select(t_test_run_steps)
                    .where(t_test_run_steps.c.test_run_script_id == trs_id,
                           t_test_run_steps.c.is_active == True)
                    .order_by(t_test_run_steps.c.step_no)
                )).mappings().all()

            exec_steps = _build_exec_steps(steps)
            await ws_manager.broadcast(test_run_id, "script_started", {
                "trs_id": str(trs_id), "name": trs.get("name", ""),
                "case_number": trs.get("case_number", ""),
                "total_steps": len(exec_steps),
            })

            runner_id = str(uuid.uuid4())[:12]

            async def on_step_done(run_script_id, step_id, step_no, step_description,
                                    action, executed_locator, input_value,
                                    status, duration_ms, screenshot_b64, error_message):
                now = datetime.now(timezone.utc)
                async with db_manager.session() as db:
                    await db.execute(t_test_run_step_results.insert().values(
                        id=uuid.uuid4(), test_run_script_id=trs_id,
                        test_run_step_id=step_id,
                        step_no=step_no,
                        step_description=(step_description or "")[:500],
                        action=action, input_parameter=None,
                        input_value=input_value or None,
                        executed_locator=executed_locator or None,
                        status=status, started_at=now, ended_at=now,
                        duration_ms=duration_ms, retry_count=0,
                        screenshot_b64=screenshot_b64 or None,
                        error_message=error_message or None,
                    ))
                    await db.commit()
                await ws_manager.broadcast(test_run_id, "step_result", {
                    "trs_id": str(trs_id), "step_no": step_no,
                    "status": status, "duration": duration_ms,
                    "error": error_message or "",
                })

            async def on_run_done(run_script_id, final_status):
                async with db_manager.session() as db:
                    passed_c = (await db.execute(
                        sa.select(sa.func.count()).select_from(t_test_run_step_results)
                        .where(t_test_run_step_results.c.test_run_script_id == trs_id,
                               t_test_run_step_results.c.status == "passed")
                    )).scalar() or 0
                    failed_c = (await db.execute(
                        sa.select(sa.func.count()).select_from(t_test_run_step_results)
                        .where(t_test_run_step_results.c.test_run_script_id == trs_id,
                               t_test_run_step_results.c.status == "failed")
                    )).scalar() or 0
                    await db.execute(
                        sa.update(t_test_run_scripts)
                        .where(t_test_run_scripts.c.id == trs_id)
                        .values(status=final_status, ended_at=datetime.now(timezone.utc),
                                passed_steps=passed_c, failed_steps=failed_c)
                    )
                    await db.commit()
                await ws_manager.broadcast(test_run_id, "script_finished", {
                    "trs_id": str(trs_id), "status": final_status,
                    "passed": passed_c, "failed": failed_c,
                })
                trs_map.remove(trs_id)

            async def bcast(msg: dict):
                await ws_manager.broadcast(test_run_id, msg.get("type", "event"), msg)

            # headless=False for preview → visible browser via Xvfb (DISPLAY=:99)
            use_headless = settings.BROWSER_HEADLESS if headless is None else headless

            runner = StepRunner(
                runner_id=runner_id, run_script_id=trs_id, test_run_id=test_run_id,
                steps=exec_steps, oracle_url=settings.ORACLE_ERP_URL,
                ws_broadcast=bcast, on_step_done=on_step_done, on_run_done=on_run_done,
                headless=use_headless,
                slow_mo=settings.BROWSER_SLOW_MO,
                timeout_ms=settings.BROWSER_TIMEOUT,
                nav_timeout_ms=90000,   # Oracle pages need extra time
                lov_timeout_ms=20000,   # LOV dropdowns can be slow
                screenshot_mode=settings.SCREENSHOT_MODE,
                preview=preview,
            )

            runner_manager.register(runner)
            trs_map.set(trs_id, runner_id)

            try:
                await runner.start()
                if runner._task:
                    await asyncio.wait_for(runner._task, timeout=7200)
                return True
            except asyncio.TimeoutError:
                log.error("Script timed out", trs_id=str(trs_id))
                await runner.stop()
                return False
            except Exception as exc:
                log.exception("Script execution error", trs_id=str(trs_id))
                async with db_manager.session() as db:
                    await db.execute(
                        sa.update(t_test_run_scripts)
                        .where(t_test_run_scripts.c.id == trs_id)
                        .values(status="failed", ended_at=datetime.now(timezone.utc),
                                error_summary=str(exc)[:300])
                    )
                    await db.commit()
                return False
            finally:
                runner_manager.remove(runner_id)
                trs_map.remove(trs_id)

    # ── Preview ───────────────────────────────────────────────────────────────

    async def start_preview(self, test_run_id: uuid.UUID, trs_id: uuid.UUID) -> str:
        """
        Launch a VISIBLE browser (headless=False) for preview.

        The browser renders on Xvfb display :99.
        View it in real-time via noVNC at http://localhost:6080/vnc.html
        OR via the CDP screencast at GET /api/v1/test-runs/{run_id}/live-preview

        Stops any existing runner for this script before starting.
        """
        current_runner_id = trs_map.get(trs_id)
        if current_runner_id:
            log.info("Stopping existing runner before preview", runner_id=current_runner_id)
            await runner_manager.stop(current_runner_id)
            await asyncio.sleep(0.5)

        async def _safe_preview():
            try:
                await self._run_one_script(
                    test_run_id, trs_id, "chromium",
                    asyncio.Semaphore(1),
                    headless=False,   # visible browser via Xvfb
                    preview=True,     # enables CDP screencast frames
                )
            except Exception:
                log.exception("Preview run error", trs_id=str(trs_id))

        asyncio.ensure_future(_safe_preview())
        return str(trs_id)

    # ── Script controls ───────────────────────────────────────────────────────

    async def pause_script(self, trs_id: uuid.UUID) -> bool:
        rid = trs_map.get(trs_id)
        if not rid: return False
        await runner_manager.pause(rid)
        return True

    async def resume_script(self, trs_id: uuid.UUID) -> bool:
        rid = trs_map.get(trs_id)
        if not rid: return False
        await runner_manager.resume(rid)
        return True

    async def stop_script(self, trs_id: uuid.UUID) -> bool:
        rid = trs_map.get(trs_id)
        if not rid: return False
        await runner_manager.stop(rid)
        return True

    # ── Run-level controls ────────────────────────────────────────────────────

    async def _trs_ids(self, run_id: uuid.UUID) -> list[uuid.UUID]:
        async with db_manager.session() as db:
            rows = (await db.execute(
                sa.select(t_test_run_scripts.c.id)
                .where(t_test_run_scripts.c.test_run_id == run_id)
            )).scalars().all()
        return [uuid.UUID(str(r)) for r in rows]

    async def pause_run(self, run_id: uuid.UUID) -> int:
        count = 0
        for trs_id in await self._trs_ids(run_id):
            if await self.pause_script(trs_id):
                count += 1
        return count

    async def resume_run(self, run_id: uuid.UUID) -> int:
        count = 0
        for trs_id in await self._trs_ids(run_id):
            if await self.resume_script(trs_id):
                count += 1
        return count

    async def stop_run(self, run_id: uuid.UUID) -> int:
        """
        Stop all active runners for this run and update DB status.
        Falls back to recover_stale_running_run if no active runners found.
        """
        count = 0
        for trs_id in await self._trs_ids(run_id):
            if await self.stop_script(trs_id):
                count += 1

        # Always update DB status regardless of active runners
        now = datetime.now(timezone.utc)
        async with db_manager.session() as db:
            await db.execute(
                sa.update(t_test_run_scripts)
                .where(
                    t_test_run_scripts.c.test_run_id == run_id,
                    t_test_run_scripts.c.status.in_(["running", "pending", "paused"]),
                )
                .values(status="stopped", ended_at=now)
            )
            await db.execute(
                sa.update(t_test_runs)
                .where(t_test_runs.c.id == run_id,
                       t_test_runs.c.status.in_(["running", "pending", "paused"]))
                .values(status="stopped", ended_at=now)
            )
            await db.commit()

        if count == 0:
            # Recover any stale state
            await self.recover_stale_running_run(run_id)

        return count

    # ── Step injection while paused ───────────────────────────────────────────

    async def inject_step(self, trs_id: uuid.UUID, step: dict,
                           after_step_no: int = -1) -> bool:
        rid = trs_map.get(trs_id)
        if not rid: return False
        await runner_manager.inject(rid, step, after_step_no)
        return True

    # ── Live page inspection ──────────────────────────────────────────────────

    async def scan_page_elements(self, trs_id: uuid.UUID) -> list:
        rid = trs_map.get(trs_id)
        return await runner_manager.scan_elements(rid) if rid else []

    async def get_dropdown_options(self, trs_id: uuid.UUID, label: str) -> list:
        rid = trs_map.get(trs_id)
        return await runner_manager.get_options(rid, label) if rid else []


test_run_service = TestRunService()


def _build_exec_steps(steps) -> list[dict]:
    from app.services.step_executor import _q
    result = []
    for idx, s in enumerate(steps):
        s  = dict(s)
        iv = s.get("default_value") or ""
        lc_raw = s.get("locator_code") or ""
        lc = None
        if lc_raw:
            lc = (lc_raw.replace("{value}", _q(iv))
                  if iv and "{value}" in lc_raw else lc_raw)
        result.append({
            "id":                  s.get("id"),
            "step_no":             s.get("step_no") or (idx + 1),
            "step_description":    s.get("step_description", ""),
            "action":              s.get("action", "Action"),
            "input_parameter":     s.get("input_parameter") or "",
            "input_type":          s.get("input_type") or "",
            "locator_code":        lc,
            "input_value":         iv,
            "default_value":       iv,
            "wait_ms":             s.get("wait_ms") or 0,
            "is_dropdown_open":    bool(s.get("is_dropdown_open")),
            "is_option_selection": bool(s.get("is_option_selection")),
            "take_screenshot":     bool(s.get("take_screenshot", True)),
            "is_manual":           bool(s.get("is_manual")),
        })
    return result