"""Script Router – CRUD, filtering, stats, dependencies, master steps (no release_id)"""
from __future__ import annotations
import uuid
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import TestScript, MasterStep, script_processes, script_dependencies
from app.models.domain import (
    ScriptCreate, ScriptUpdate, ScriptResponse, ScriptStats,
    DependencyAdd, MasterStepResponse,
)
from app.services.case_number_service import case_number_service
from app.utils.database import get_db
import sqlalchemy as sa

router = APIRouter()


@router.post("/", response_model=ScriptResponse, status_code=201)
async def create_script(body: ScriptCreate, db: AsyncSession = Depends(get_db)):
    case_num = await case_number_service.generate(
        db, module_id=body.module_id, feature_id=body.feature_id
    )
    script = TestScript(
        module_id=body.module_id, feature_id=body.feature_id,
        case_number=case_num, name=body.name, description=body.description,
        role=body.role, script_type=body.script_type, labels=body.labels or [],
    )
    db.add(script); await db.flush()
    if body.process_ids:
        await db.execute(
            script_processes.insert(),
            [{"script_id": script.id, "process_id": p} for p in body.process_ids]
        )
    await db.refresh(script)
    return await _enrich(script, db)


@router.get("/", response_model=List[ScriptResponse])
async def list_scripts(
    module_id:   Optional[uuid.UUID] = None,
    feature_id:  Optional[uuid.UUID] = None,
    process_id:  Optional[uuid.UUID] = None,
    status:      Optional[str]       = None,
    label:       Optional[str]       = None,
    search:      Optional[str]       = None,
    show_deleted: bool = False,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(TestScript)
    if module_id:   stmt = stmt.where(TestScript.module_id  == module_id)
    if feature_id:  stmt = stmt.where(TestScript.feature_id == feature_id)
    if status:      stmt = stmt.where(TestScript.status      == status)
    if not show_deleted: stmt = stmt.where(TestScript.is_deleted == False)
    if label:       stmt = stmt.where(TestScript.labels.contains([label]))
    if search:
        stmt = stmt.where(or_(
            TestScript.name.ilike(f"%{search}%"),
            TestScript.case_number.ilike(f"%{search}%"),
            TestScript.role.ilike(f"%{search}%"),
        ))
    if process_id:
        subq = select(script_processes.c.script_id).where(script_processes.c.process_id == process_id)
        stmt = stmt.where(TestScript.id.in_(subq))
    scripts = (await db.execute(stmt.order_by(TestScript.case_number))).scalars().all()
    return [await _enrich(s, db) for s in scripts]


@router.get("/stats", response_model=ScriptStats)
async def get_stats(
    module_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(
        func.count(TestScript.id).label("total"),
        func.count(TestScript.id).filter(TestScript.status == "valid",    TestScript.is_deleted == False).label("valid"),
        func.count(TestScript.id).filter(TestScript.status == "archived").label("archived"),
        func.count(TestScript.id).filter(TestScript.is_deleted == True).label("deleted"),
    )
    if module_id: stmt = stmt.where(TestScript.module_id == module_id)
    r = (await db.execute(stmt)).one()
    return ScriptStats(total=r.total, valid=r.valid, archived=r.archived, deleted=r.deleted)


@router.get("/label-suggestions", response_model=List[str])
async def label_suggestions():
    return ["smoke", "regression", "critical-path", "sanity", "happy-path", "edge-case"]


@router.get("/{sid}", response_model=ScriptResponse)
async def get_script(sid: uuid.UUID, db: AsyncSession = Depends(get_db)):
    script = await db.get(TestScript, sid)
    if not script: raise HTTPException(404, "Script not found.")
    return await _enrich(script, db)


@router.patch("/{sid}", response_model=ScriptResponse)
async def update_script(sid: uuid.UUID, body: ScriptUpdate, db: AsyncSession = Depends(get_db)):
    script = await db.get(TestScript, sid)
    if not script: raise HTTPException(404, "Script not found.")
    values = body.model_dump(exclude_none=True, exclude={"process_ids"})
    for k, v in values.items(): setattr(script, k, v)
    if body.process_ids is not None:
        await db.execute(script_processes.delete().where(script_processes.c.script_id == sid))
        if body.process_ids:
            await db.execute(script_processes.insert(),
                             [{"script_id": sid, "process_id": p} for p in body.process_ids])
    await db.flush(); await db.refresh(script)
    return await _enrich(script, db)


@router.delete("/{sid}", status_code=200)
async def delete_script(sid: uuid.UUID, db: AsyncSession = Depends(get_db)):
    await db.execute(
        sa.update(TestScript).where(TestScript.id == sid)
        .values(is_deleted=True, status="archived")
    )
    return {"message": "Script archived."}


@router.post("/{sid}/restore", status_code=200)
async def restore_script(sid: uuid.UUID, db: AsyncSession = Depends(get_db)):
    await db.execute(
        sa.update(TestScript).where(TestScript.id == sid)
        .values(is_deleted=False, status="valid")
    )
    return {"message": "Script restored."}


# ── DEPENDENCIES ───────────────────────────────────────────────────────────────
@router.get("/{sid}/dependencies", response_model=List[uuid.UUID])
async def get_dependencies(sid: uuid.UUID, db: AsyncSession = Depends(get_db)):
    r = await db.execute(
        select(script_dependencies.c.depends_on).where(script_dependencies.c.script_id == sid)
    )
    return [row[0] for row in r.all()]

@router.post("/{sid}/dependencies", status_code=201)
async def add_dependency(sid: uuid.UUID, body: DependencyAdd, db: AsyncSession = Depends(get_db)):
    if sid == body.depends_on:
        raise HTTPException(400, "A script cannot depend on itself.")
    await db.execute(script_dependencies.insert().values(script_id=sid, depends_on=body.depends_on))
    return {"message": "Dependency added."}

@router.delete("/{sid}/dependencies/{dep_id}", status_code=204)
async def remove_dependency(sid: uuid.UUID, dep_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    await db.execute(script_dependencies.delete().where(
        script_dependencies.c.script_id == sid,
        script_dependencies.c.depends_on == dep_id,
    ))


# ── MASTER STEPS (safe output - no locator_code) ──────────────────────────────
@router.get("/{sid}/steps", response_model=List[MasterStepResponse])
async def get_master_steps(sid: uuid.UUID, db: AsyncSession = Depends(get_db)):
    steps = (await db.execute(
        select(MasterStep)
        .where(MasterStep.script_id == sid, MasterStep.is_active == True)
        .order_by(MasterStep.step_no)
    )).scalars().all()
    return [MasterStepResponse.model_validate(s) for s in steps]


# ── Helper ─────────────────────────────────────────────────────────────────────
async def _enrich(script: TestScript, db: AsyncSession) -> ScriptResponse:
    proc_ids = [r[0] for r in (await db.execute(
        select(script_processes.c.process_id).where(script_processes.c.script_id == script.id)
    )).all()]
    dep_ids = [r[0] for r in (await db.execute(
        select(script_dependencies.c.depends_on).where(script_dependencies.c.script_id == script.id)
    )).all()]
    step_count = (await db.execute(
        select(func.count(MasterStep.id)).where(
            MasterStep.script_id == script.id, MasterStep.is_active == True
        )
    )).scalar() or 0
    return ScriptResponse(
        id=script.id, module_id=script.module_id, feature_id=script.feature_id,
        case_number=script.case_number, name=script.name, description=script.description,
        role=script.role, script_type=script.script_type, status=script.status,
        labels=script.labels or [], is_deleted=script.is_deleted, version=script.version,
        process_ids=proc_ids, depends_on=dep_ids, step_count=step_count,
        created_at=script.created_at, updated_at=script.updated_at,
    )
