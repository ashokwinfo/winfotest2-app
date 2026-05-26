"""Release Repository – includes clone-release functionality"""
from __future__ import annotations
import uuid
from typing import Optional, Sequence

from sqlalchemy import select, update as sa_update, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import (
    Release, Module, Feature, Process, TestScript,
    MasterStep, PlaywrightCode, CaseNumberSequence,
)
from app.models.domain import ReleaseCreate, ReleaseUpdate
import structlog

log = structlog.get_logger(__name__)


class ReleaseRepository:
    def __init__(self, db: AsyncSession):
        self._db = db

    async def create(self, payload: ReleaseCreate) -> Release:
        release = Release(
            product_id=payload.product_id,
            name=payload.name,
            description=payload.description,
        )
        self._db.add(release)
        await self._db.flush()
        await self._db.refresh(release)
        return release

    async def get_by_id(self, release_id: uuid.UUID) -> Optional[Release]:
        return await self._db.get(Release, release_id)

    async def list_by_product(self, product_id: uuid.UUID) -> Sequence[Release]:
        result = await self._db.execute(
            select(Release)
            .where(Release.product_id == product_id)
            .order_by(Release.created_at.desc())
        )
        return result.scalars().all()

    async def update(self, release_id: uuid.UUID, payload: ReleaseUpdate) -> Optional[Release]:
        values = payload.model_dump(exclude_none=True)
        if values:
            await self._db.execute(
                sa_update(Release).where(Release.id == release_id).values(**values)
            )
        return await self.get_by_id(release_id)

    async def clone(self, source_id: uuid.UUID, new_name: str) -> Release:
        """
        Clone a release: copy all active modules, features, processes,
        test scripts, master steps, and playwright code into a new release.
        Case numbers are preserved. Sequences are reset to continue from max.
        """
        source = await self.get_by_id(source_id)
        if not source:
            raise ValueError(f"Source release {source_id} not found.")

        # Create new release
        new_release = Release(
            product_id=source.product_id,
            name=new_name,
            cloned_from_id=source_id,
        )
        self._db.add(new_release)
        await self._db.flush()

        # Maps: old_id → new_id for each entity type
        module_map:  dict[uuid.UUID, uuid.UUID] = {}
        feature_map: dict[uuid.UUID, uuid.UUID] = {}
        process_map: dict[uuid.UUID, uuid.UUID] = {}
        script_map:  dict[uuid.UUID, uuid.UUID] = {}

        # Clone Modules
        modules = (await self._db.execute(
            select(Module).where(Module.release_id == source_id, Module.is_active == True)
        )).scalars().all()

        for m in modules:
            new_m = Module(
                release_id=new_release.id,
                name=m.name,
                abbreviation=m.abbreviation,
                description=m.description,
            )
            self._db.add(new_m)
            await self._db.flush()
            module_map[m.id] = new_m.id

            # Clone Features for this module
            features = (await self._db.execute(
                select(Feature).where(Feature.module_id == m.id, Feature.is_active == True)
            )).scalars().all()
            for f in features:
                new_f = Feature(
                    module_id=new_m.id,
                    name=f.name,
                    abbreviation=f.abbreviation,
                    description=f.description,
                )
                self._db.add(new_f)
                await self._db.flush()
                feature_map[f.id] = new_f.id

            # Clone Processes for this module
            processes = (await self._db.execute(
                select(Process).where(Process.module_id == m.id, Process.is_active == True)
            )).scalars().all()
            for p in processes:
                new_feat_id = feature_map.get(p.feature_id) if p.feature_id else None
                new_p = Process(
                    module_id=new_m.id,
                    feature_id=new_feat_id,
                    name=p.name,
                    description=p.description,
                )
                self._db.add(new_p)
                await self._db.flush()
                process_map[p.id] = new_p.id

        # Clone Test Scripts and their steps
        scripts = (await self._db.execute(
            select(TestScript).where(
                TestScript.release_id == source_id,
                TestScript.is_deleted == False,
                TestScript.status == "valid",
            )
        )).scalars().all()

        for s in scripts:
            new_module_id  = module_map.get(s.module_id, s.module_id)
            new_feature_id = feature_map.get(s.feature_id) if s.feature_id else None

            new_s = TestScript(
                release_id=new_release.id,
                module_id=new_module_id,
                feature_id=new_feature_id,
                case_number=s.case_number,   # preserve case number
                name=s.name,
                description=s.description,
                role=s.role,
                script_type=s.script_type,
                labels=s.labels,
                status="valid",
            )
            self._db.add(new_s)
            await self._db.flush()
            script_map[s.id] = new_s.id

            # Clone master steps
            steps = (await self._db.execute(
                select(MasterStep).where(MasterStep.script_id == s.id).order_by(MasterStep.step_order)
            )).scalars().all()
            for step in steps:
                self._db.add(MasterStep(
                    script_id=new_s.id,
                    step_order=step.step_order,
                    action_type=step.action_type,
                    selector=step.selector,
                    value=step.value,
                    description=step.description,
                    screenshot_b64=step.screenshot_b64,
                    metadata=step.metadata,
                ))

            # Clone encrypted playwright code
            pc = (await self._db.execute(
                select(PlaywrightCode).where(PlaywrightCode.script_id == s.id)
            )).scalar_one_or_none()
            if pc:
                self._db.add(PlaywrightCode(
                    script_id=new_s.id,
                    encrypted_code=pc.encrypted_code,
                    code_hash=pc.code_hash,
                ))

        await self._db.flush()

        # Clone process ↔ script associations
        import sqlalchemy as sa
        sp = sa.Table("script_processes", sa.MetaData(),
                      sa.Column("script_id", sa.dialects.postgresql.UUID(as_uuid=True)),
                      sa.Column("process_id", sa.dialects.postgresql.UUID(as_uuid=True)))

        for old_script_id, new_script_id in script_map.items():
            rows = (await self._db.execute(
                sa.select(sp.c.process_id).where(sp.c.script_id == old_script_id)
            )).all()
            for row in rows:
                new_proc_id = process_map.get(row[0])
                if new_proc_id:
                    await self._db.execute(
                        sp.insert().values(script_id=new_script_id, process_id=new_proc_id)
                    )

        log.info(
            "Release cloned",
            source=str(source_id),
            new_release=str(new_release.id),
            modules=len(module_map),
            scripts=len(script_map),
        )
        return new_release
