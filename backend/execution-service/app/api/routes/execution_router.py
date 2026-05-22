"""Execution Router – create runs, fetch results, WebSocket live updates"""
from __future__ import annotations
import uuid
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, WebSocket
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field
import sqlalchemy as sa

from app.services.runner_service import runner_service, t_runs, t_results, t_step_res
from app.utils.database import get_db
from app.websockets.execution_ws_handler import handle_execution_ws

router = APIRouter()


# ── Request / Response models ─────────────────────────────────────────────────
class CreateRunRequest(BaseModel):
    script_ids:      List[uuid.UUID] = Field(..., min_length=1)
    run_name:        Optional[str]   = None
    browser:         str             = Field(default="chromium")
    parallel_workers: int            = Field(default=1, ge=1, le=16)
    triggered_by:    Optional[str]   = None


class RunResponse(BaseModel):
    id:               uuid.UUID
    run_name:         Optional[str]
    status:           str
    browser:          str
    parallel_workers: int
    total_scripts:    int
    passed_scripts:   int
    failed_scripts:   int
    started_at:       Optional[datetime]
    ended_at:         Optional[datetime]
    created_at:       datetime


class ScriptResultResponse(BaseModel):
    id:                   uuid.UUID
    run_id:               uuid.UUID
    execution_script_id:  uuid.UUID
    status:               str
    started_at:           Optional[datetime]
    ended_at:             Optional[datetime]
    duration_ms:          Optional[int]
    total_steps:          Optional[int]
    passed_steps:         Optional[int]
    failed_steps:         Optional[int]
    error_message:        Optional[str]
    video_path:           Optional[str]


class StepResultResponse(BaseModel):
    id:                  uuid.UUID
    script_result_id:    uuid.UUID
    execution_step_id:   Optional[uuid.UUID]
    step_no:             int
    step_description:    Optional[str]
    action:              Optional[str]
    input_parameter:     Optional[str]
    input_value:         Optional[str]
    status:              str
    started_at:          Optional[datetime]
    ended_at:            Optional[datetime]
    duration_ms:         Optional[int]
    retry_count:         Optional[int]
    screenshot_b64:      Optional[str]
    error_message:       Optional[str]
    # executed_locator intentionally excluded


# ── Routes ────────────────────────────────────────────────────────────────────
@router.post("/", response_model=RunResponse, status_code=202)
async def create_run(body: CreateRunRequest, db: AsyncSession = Depends(get_db)):
    """Create and immediately start a test run."""
    run_id = await runner_service.start_run(
        script_ids=body.script_ids,
        run_name=body.run_name,
        browser=body.browser,
        parallel_workers=body.parallel_workers,
        triggered_by=body.triggered_by,
        db=db,
    )
    row = (await db.execute(
        sa.select(t_runs).where(t_runs.c.id == run_id)
    )).mappings().one()
    return RunResponse(**dict(row))


@router.get("/", response_model=List[RunResponse])
async def list_runs(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        sa.select(t_runs).order_by(t_runs.c.created_at.desc())
    )).mappings().all()
    return [RunResponse(**dict(r)) for r in rows]


@router.get("/{run_id}", response_model=RunResponse)
async def get_run(run_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(
        sa.select(t_runs).where(t_runs.c.id == run_id)
    )).mappings().one_or_none()
    if not row:
        raise HTTPException(404, "Run not found.")
    return RunResponse(**dict(row))


@router.get("/{run_id}/scripts", response_model=List[ScriptResultResponse])
async def get_script_results(run_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        sa.select(t_results).where(t_results.c.run_id == run_id)
    )).mappings().all()
    return [ScriptResultResponse(**dict(r)) for r in rows]


@router.get("/script-results/{result_id}/steps", response_model=List[StepResultResponse])
async def get_step_results(result_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        sa.select(t_step_res)
        .where(t_step_res.c.script_result_id == result_id)
        .order_by(t_step_res.c.step_no)
    )).mappings().all()
    return [StepResultResponse(**dict(r)) for r in rows]


@router.websocket("/ws/{run_id}")
async def execution_ws(websocket: WebSocket, run_id: str):
    await handle_execution_ws(websocket, run_id)
