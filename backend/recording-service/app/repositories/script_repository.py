"""Script Repository – Master DB (no release_id)"""
from __future__ import annotations
import uuid
from typing import Optional, Sequence, List

import sqlalchemy as sa
from sqlalchemy import select, update as sa_update, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import TestScript, MasterStep, PlaywrightCode, script_processes, script_dependencies
from app.models.domain import ScriptCreate, ScriptUpdate, ScriptStats
from app.services.case_number_service import case_number_service


class ScriptRepository:
    def __init__(self, db: AsyncSession):
        self._db = db

    async def create(self, payload: ScriptCreate) -> TestScript:
        case_num = await case_number_service.generate(
            self._db,
            module_id=payload.module_id,
            feature_id=payload.feature_id,
        )
        s = TestScript(
            module_id=payload.module_id,
            feature_id=payload.feature_id,
            case_number=case_num,
            name=payload.name,
            description=payload.description,
            role=payload.role,
            script_type=payload.script_type,
            labels=payload.labels or [],
        )
        self._db.add(s)
        await self._db.flush()
        if payload.process_ids:
            await self._set_processes(s.id, payload.process_ids)
        await self._db.refresh(s)
        return s

    async def get_by_id(self, sid: uuid.UUID) -> Optional[TestScript]:
        return await self._db.get(TestScript, sid)

    async def list_with_filters(
        self,
        module_id=None, feature_id=None, process_id=None,
        status=None, label=None, search=None, include_deleted=False,
    ) -> Sequence[TestScript]:
        stmt = select(TestScript)
        if module_id:          stmt = stmt.where(TestScript.module_id  == module_id)
        if feature_id:         stmt = stmt.where(TestScript.feature_id == feature_id)
        if status:             stmt = stmt.where(TestScript.status      == status)
        if not include_deleted: stmt = stmt.where(TestScript.is_deleted == False)
        if label:              stmt = stmt.where(TestScript.labels.contains([label]))
        if search:
            stmt = stmt.where(or_(
                TestScript.name.ilike(f"%{search}%"),
                TestScript.case_number.ilike(f"%{search}%"),
                TestScript.role.ilike(f"%{search}%"),
            ))
        if process_id:
            subq = select(script_processes.c.script_id).where(
                script_processes.c.process_id == process_id
            )
            stmt = stmt.where(TestScript.id.in_(subq))
        return (await self._db.execute(stmt.order_by(TestScript.case_number))).scalars().all()

    async def get_stats(self, module_id=None) -> ScriptStats:
        stmt = select(
            func.count(TestScript.id).label("total"),
            func.count(TestScript.id).filter(TestScript.status == "valid",
                                              TestScript.is_deleted == False).label("valid"),
            func.count(TestScript.id).filter(TestScript.status == "archived").label("archived"),
            func.count(TestScript.id).filter(TestScript.is_deleted == True).label("deleted"),
        )
        if module_id:
            stmt = stmt.where(TestScript.module_id == module_id)
        r = (await self._db.execute(stmt)).one()
        return ScriptStats(total=r.total, valid=r.valid, archived=r.archived, deleted=r.deleted)

    async def update(self, sid: uuid.UUID, payload: ScriptUpdate) -> Optional[TestScript]:
        values = payload.model_dump(exclude_none=True, exclude={"process_ids"})
        if values:
            await self._db.execute(
                sa_update(TestScript).where(TestScript.id == sid).values(**values)
            )
        if payload.process_ids is not None:
            await self._set_processes(sid, payload.process_ids)
        return await self.get_by_id(sid)

    async def soft_delete(self, sid: uuid.UUID):
        await self._db.execute(
            sa_update(TestScript)
            .where(TestScript.id == sid)
            .values(is_deleted=True, status="archived")
        )

    async def restore(self, sid: uuid.UUID):
        await self._db.execute(
            sa_update(TestScript)
            .where(TestScript.id == sid)
            .values(is_deleted=False, status="valid")
        )

    async def get_processes(self, sid: uuid.UUID) -> List[uuid.UUID]:
        r = await self._db.execute(
            select(script_processes.c.process_id)
            .where(script_processes.c.script_id == sid)
        )
        return [row[0] for row in r.all()]

    async def get_dependencies(self, sid: uuid.UUID) -> List[uuid.UUID]:
        r = await self._db.execute(
            select(script_dependencies.c.depends_on)
            .where(script_dependencies.c.script_id == sid)
        )
        return [row[0] for row in r.all()]

    async def add_dependency(self, sid: uuid.UUID, dep: uuid.UUID):
        await self._db.execute(
            script_dependencies.insert().values(script_id=sid, depends_on=dep)
        )

    async def remove_dependency(self, sid: uuid.UUID, dep: uuid.UUID):
        await self._db.execute(
            script_dependencies.delete().where(
                script_dependencies.c.script_id == sid,
                script_dependencies.c.depends_on == dep,
            )
        )

    async def get_step_count(self, sid: uuid.UUID) -> int:
        r = await self._db.execute(
            select(func.count(MasterStep.id)).where(
                MasterStep.script_id == sid,
                MasterStep.is_active == True,
            )
        )
        return r.scalar() or 0

    async def _set_processes(self, sid: uuid.UUID, process_ids: List[uuid.UUID]):
        await self._db.execute(
            script_processes.delete().where(script_processes.c.script_id == sid)
        )
        if process_ids:
            await self._db.execute(
                script_processes.insert(),
                [{"script_id": sid, "process_id": p} for p in process_ids],
            )
