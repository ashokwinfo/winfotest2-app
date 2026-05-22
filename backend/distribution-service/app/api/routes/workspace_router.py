"""Workspace Router – execution scripts & editable steps in Client DB"""
from __future__ import annotations
import uuid
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timezone
import sqlalchemy as sa

from app.models.domain import (
    ExecutionScriptResponse, ExecutionStepResponse,
    StepCreate, StepUpdate, ReorderRequest,
)
from app.utils.database import get_client_db

router = APIRouter()

meta = sa.MetaData()

t_scripts = sa.Table("execution_scripts", meta,
    sa.Column("id",               sa.dialects.postgresql.UUID(as_uuid=True)),
    sa.Column("master_script_id", sa.dialects.postgresql.UUID(as_uuid=True)),
    sa.Column("release_id",       sa.dialects.postgresql.UUID(as_uuid=True)),
    sa.Column("case_number",      sa.String),
    sa.Column("name",             sa.String),
    sa.Column("description",      sa.String),
    sa.Column("role",             sa.String),
    sa.Column("script_type",      sa.String),
    sa.Column("status",           sa.String),
    sa.Column("labels",           sa.ARRAY(sa.String)),
    sa.Column("published_at",     sa.DateTime))

t_steps = sa.Table("execution_steps", meta,
    sa.Column("id",                  sa.dialects.postgresql.UUID(as_uuid=True)),
    sa.Column("execution_script_id", sa.dialects.postgresql.UUID(as_uuid=True)),
    sa.Column("master_step_id",      sa.dialects.postgresql.UUID(as_uuid=True)),
    sa.Column("step_order",          sa.Integer),
    sa.Column("action_type",         sa.String),
    sa.Column("selector",            sa.String),
    sa.Column("value",               sa.String),
    sa.Column("description",         sa.String),
    sa.Column("is_modified",         sa.Boolean),
    sa.Column("is_added",            sa.Boolean),
    sa.Column("metadata",            sa.JSON),
    sa.Column("created_at",          sa.DateTime(timezone=True)),
    sa.Column("updated_at",          sa.DateTime(timezone=True)))


# ── SCRIPTS ──────────────────────────────────────────────────────────────────
@router.get("/scripts", response_model=List[ExecutionScriptResponse])
async def list_execution_scripts(db: AsyncSession = Depends(get_client_db)):
    rows = (await db.execute(sa.select(t_scripts))).mappings().all()
    result = []
    for r in rows:
        count = (await db.execute(
            sa.select(sa.func.count()).select_from(t_steps)
            .where(t_steps.c.execution_script_id == r["id"])
        )).scalar() or 0
        result.append(ExecutionScriptResponse(
            id=r["id"], master_script_id=r["master_script_id"],
            release_id=r.get("release_id"),
            case_number=r["case_number"], name=r["name"],
            description=r.get("description"), role=r.get("role"),
            script_type=r["script_type"], status=r["status"],
            labels=r["labels"] or [], step_count=count,
            published_at=r.get("published_at"),
        ))
    return result


@router.get("/scripts/{sid}", response_model=ExecutionScriptResponse)
async def get_execution_script(sid: uuid.UUID, db: AsyncSession = Depends(get_client_db)):
    row = (await db.execute(
        sa.select(t_scripts).where(t_scripts.c.id == sid)
    )).mappings().one_or_none()
    if not row:
        raise HTTPException(404, "Execution script not found.")
    count = (await db.execute(
        sa.select(sa.func.count()).select_from(t_steps)
        .where(t_steps.c.execution_script_id == sid)
    )).scalar() or 0
    return ExecutionScriptResponse(**{**dict(row), "step_count": count})


# ── STEPS (safe: locator_code excluded from response) ────────────────────────
@router.get("/scripts/{sid}/steps", response_model=List[ExecutionStepResponse])
async def list_steps(sid: uuid.UUID, db: AsyncSession = Depends(get_client_db)):
    rows = (await db.execute(
        sa.select(t_steps)
        .where(t_steps.c.execution_script_id == sid)
        .order_by(t_steps.c.step_order)
    )).mappings().all()
    return [_step_out(r) for r in rows]


# @router.post("/scripts/{sid}/steps", response_model=ExecutionStepResponse, status_code=201)
# async def add_step(sid: uuid.UUID, body: StepCreate, db: AsyncSession = Depends(get_client_db)):
#     new_id = uuid.uuid4()
#     now = datetime.now(timezone.utc)
#     await db.execute(t_steps.insert().values(
#         id=new_id,
#         execution_script_id=sid,
#         master_step_id=None,
#         step_order=body.step_no,
#         action_type=body.action or "Action",
#         selector=body.input_parameter,
#         value=body.default_value,
#         description=body.step_description or "",
#         is_modified=False,
#         is_added=True,
#         metadata={
#             "input_type":          body.input_type,
#             "input_parameter":     body.input_parameter,
#             "wait_ms":             body.wait_ms or 0,
#             "is_dropdown_open":    body.is_dropdown_open,
#             "is_option_selection": body.is_option_selection,
#             "take_screenshot":     body.take_screenshot,
#             "is_manual":           body.is_manual,
#         },
#         created_at=now,
#         updated_at=now,
#     ))
#     row = (await db.execute(
#         sa.select(t_steps).where(t_steps.c.id == new_id)
#     )).mappings().one()
#     return _step_out(row)

@router.post("/scripts/{sid}/steps", response_model=ExecutionStepResponse, status_code=201)
async def add_step(sid: uuid.UUID, body: StepCreate, db: AsyncSession = Depends(get_client_db)):
    new_id  = uuid.uuid4()
    now     = datetime.now(timezone.utc)
    insert_after = body.step_no  # insert AFTER this step_order
    temp_offset = 1000

    # Shift to a temporary high range first to avoid unique collisions during update.
    await db.execute(
        sa.update(t_steps)
        .where(
            t_steps.c.execution_script_id == sid,
            t_steps.c.step_order > insert_after,
        )
        .values(step_order=t_steps.c.step_order + temp_offset)
    )

    # Bring temporary values back with a net +1 shift.
    await db.execute(
        sa.update(t_steps)
        .where(
            t_steps.c.execution_script_id == sid,
            t_steps.c.step_order > insert_after + temp_offset,
        )
        .values(step_order=t_steps.c.step_order - (temp_offset - 1))
    )

    # Insert new step at insert_after + 1
    await db.execute(t_steps.insert().values(
        id=new_id,
        execution_script_id=sid,
        master_step_id=None,
        step_order=insert_after + 1,
        action_type=body.action or "Action",
        selector=body.input_parameter,
        value=body.default_value,
        description=body.step_description or "",
        is_modified=False,
        is_added=True,
        metadata={
            "input_type":          body.input_type,
            "input_parameter":     body.input_parameter,
            "wait_ms":             body.wait_ms or 0,
            "is_dropdown_open":    body.is_dropdown_open,
            "is_option_selection": body.is_option_selection,
            "take_screenshot":     body.take_screenshot,
            "is_manual":           body.is_manual,
        },
        created_at=now,
        updated_at=now,
    ))

    row = (await db.execute(
        sa.select(t_steps).where(t_steps.c.id == new_id)
    )).mappings().one()
    return _step_out(row)

@router.patch("/steps/{step_id}", response_model=ExecutionStepResponse)
async def update_step(step_id: uuid.UUID, body: StepUpdate, db: AsyncSession = Depends(get_client_db)):
    row = (await db.execute(
        sa.select(t_steps).where(t_steps.c.id == step_id)
    )).mappings().one_or_none()
    if not row:
        raise HTTPException(404, "Step not found.")

    patch = body.model_dump(exclude_none=True)
    values: dict = {
        "is_modified": True,
        "updated_at": datetime.now(timezone.utc),
    }

    if "step_description" in patch:
        values["description"] = patch["step_description"]
    if "action" in patch:
        values["action_type"] = patch["action"]
    if "input_parameter" in patch:
        values["selector"] = patch["input_parameter"]
    if "default_value" in patch:
        values["value"] = patch["default_value"]

    metadata_updates = {
        "input_type": patch.get("input_type"),
        "wait_ms": patch.get("wait_ms"),
        "is_dropdown_open": patch.get("is_dropdown_open"),
        "is_option_selection": patch.get("is_option_selection"),
    }
    if "input_parameter" in patch:
        metadata_updates["input_parameter"] = patch["input_parameter"]

    current_meta = dict(row.get("metadata") or {})
    for key, value in metadata_updates.items():
        if value is not None:
            current_meta[key] = value
    if current_meta:
        values["metadata"] = current_meta

    # Reposition step safely if order is changed.
    if "step_no" in patch:
        old_order = int(row.get("step_order") or 0)
        new_order = int(patch["step_no"])
        script_id = row["execution_script_id"]
        temp_offset = 1000

        if new_order > old_order:
            await db.execute(
                sa.update(t_steps)
                .where(
                    t_steps.c.execution_script_id == script_id,
                    t_steps.c.step_order > old_order,
                    t_steps.c.step_order <= new_order,
                )
                .values(step_order=t_steps.c.step_order + temp_offset)
            )
            await db.execute(
                sa.update(t_steps)
                .where(
                    t_steps.c.execution_script_id == script_id,
                    t_steps.c.step_order > old_order + temp_offset,
                    t_steps.c.step_order <= new_order + temp_offset,
                )
                .values(step_order=t_steps.c.step_order - (temp_offset + 1))
            )
            values["step_order"] = new_order
        elif new_order < old_order:
            await db.execute(
                sa.update(t_steps)
                .where(
                    t_steps.c.execution_script_id == script_id,
                    t_steps.c.step_order >= new_order,
                    t_steps.c.step_order < old_order,
                )
                .values(step_order=t_steps.c.step_order + temp_offset)
            )
            await db.execute(
                sa.update(t_steps)
                .where(
                    t_steps.c.execution_script_id == script_id,
                    t_steps.c.step_order >= new_order + temp_offset,
                    t_steps.c.step_order < old_order + temp_offset,
                )
                .values(step_order=t_steps.c.step_order - (temp_offset - 1))
            )
            values["step_order"] = new_order

    await db.execute(
        sa.update(t_steps).where(t_steps.c.id == step_id).values(**values)
    )

    updated = (await db.execute(
        sa.select(t_steps).where(t_steps.c.id == step_id)
    )).mappings().one()
    return _step_out(updated)


# @router.delete("/steps/{step_id}", status_code=204)
# async def delete_step(step_id: uuid.UUID, db: AsyncSession = Depends(get_client_db)):
#     await db.execute(sa.delete(t_steps).where(t_steps.c.id == step_id))

@router.delete("/steps/{step_id}", status_code=204)
async def delete_step(step_id: uuid.UUID, db: AsyncSession = Depends(get_client_db)):
    # Get the step first to know its script and order
    row = (await db.execute(
        sa.select(t_steps).where(t_steps.c.id == step_id)
    )).mappings().one_or_none()

    if not row:
        raise HTTPException(404, "Step not found.")

    script_id     = row["execution_script_id"]
    deleted_order = row["step_order"]

    # Delete the step
    await db.execute(sa.delete(t_steps).where(t_steps.c.id == step_id))

    # Shift down: move to large temp offset first to avoid unique constraint
    await db.execute(
        sa.update(t_steps)
        .where(
            t_steps.c.execution_script_id == script_id,
            t_steps.c.step_order > deleted_order,
        )
        .values(step_order=t_steps.c.step_order + 1000)
    )

    # Then set final values by subtracting 1001 (net effect: -1)
    await db.execute(
        sa.update(t_steps)
        .where(
            t_steps.c.execution_script_id == script_id,
            t_steps.c.step_order > deleted_order + 1000,
        )
        .values(step_order=t_steps.c.step_order - 1001)
    )


@router.post("/scripts/{sid}/steps/reorder", status_code=200)
async def reorder_steps(sid: uuid.UUID, body: ReorderRequest, db: AsyncSession = Depends(get_client_db)):
    for item in body.items:
        await db.execute(
            sa.update(t_steps)
            .where(t_steps.c.id == uuid.UUID(str(item["step_id"])))
            .values(step_order=item["new_order"], is_modified=True,
                    updated_at=datetime.now(timezone.utc))
        )
    return {"message": "Steps reordered."}


# ── Serialiser (locator_code intentionally excluded) ─────────────────────────
def _step_out(r) -> ExecutionStepResponse:
    meta = r.get("metadata") or {}
    return ExecutionStepResponse(
        id=r["id"],
        execution_script_id=r["execution_script_id"],
        master_step_id=r.get("master_step_id"),
        step_no=r.get("step_order") or 0,
        step_description=r.get("description") or "",
        action=r.get("action_type") or "Action",
        input_parameter=r.get("selector") or meta.get("input_parameter"),
        input_type=meta.get("input_type"),
        default_value=r.get("value"),
        wait_ms=meta.get("wait_ms") or 0,
        is_dropdown_open=bool(meta.get("is_dropdown_open")),
        is_option_selection=bool(meta.get("is_option_selection")),
        take_screenshot=bool(meta.get("take_screenshot", True)),
        is_manual=bool(meta.get("is_manual")),
        is_modified=bool(r.get("is_modified")),
        is_added=bool(r.get("is_added")),
        created_at=r.get("created_at"),
        updated_at=r.get("updated_at"),
    )
