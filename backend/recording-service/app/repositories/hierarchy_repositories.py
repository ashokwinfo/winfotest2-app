"""Hierarchy Repositories – Product, Module, Feature, Process, MasterStep"""
from __future__ import annotations
import uuid
from typing import Optional, Sequence
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
import sqlalchemy as sa

from app.models.database import Product, Module, Feature, Process, MasterStep, PlaywrightCode
from app.repositories.base_repository import BaseRepository


class ProductRepository(BaseRepository[Product]):
    def __init__(self, db: AsyncSession):
        super().__init__(Product, db)

    async def list_all(self, active_only=True) -> Sequence[Product]:
        stmt = select(Product)
        if active_only:
            stmt = stmt.where(Product.is_active == True)
        return (await self._db.execute(stmt.order_by(Product.name))).scalars().all()

    async def get_by_name(self, name: str) -> Optional[Product]:
        result = await self._db.execute(select(Product).where(Product.name == name))
        return result.scalar_one_or_none()


class ModuleRepository(BaseRepository[Module]):
    def __init__(self, db: AsyncSession):
        super().__init__(Module, db)

    async def list_by_product(self, product_id: uuid.UUID, active_only=True) -> Sequence[Module]:
        """List modules by product_id — modules belong to Products, NOT Releases."""
        stmt = select(Module).where(Module.product_id == product_id)
        if active_only:
            stmt = stmt.where(Module.is_active == True)
        return (await self._db.execute(stmt.order_by(Module.name))).scalars().all()


class FeatureRepository(BaseRepository[Feature]):
    def __init__(self, db: AsyncSession):
        super().__init__(Feature, db)

    async def list_by_module(self, module_id: uuid.UUID, active_only=True) -> Sequence[Feature]:
        stmt = select(Feature).where(Feature.module_id == module_id)
        if active_only:
            stmt = stmt.where(Feature.is_active == True)
        return (await self._db.execute(stmt.order_by(Feature.name))).scalars().all()


class ProcessRepository(BaseRepository[Process]):
    def __init__(self, db: AsyncSession):
        super().__init__(Process, db)

    async def list_by_module(self, module_id: uuid.UUID, active_only=True) -> Sequence[Process]:
        stmt = select(Process).where(Process.module_id == module_id)
        if active_only:
            stmt = stmt.where(Process.is_active == True)
        return (await self._db.execute(stmt.order_by(Process.name))).scalars().all()

    async def list_by_feature(self, feature_id: uuid.UUID, active_only=True) -> Sequence[Process]:
        stmt = select(Process).where(Process.feature_id == feature_id)
        if active_only:
            stmt = stmt.where(Process.is_active == True)
        return (await self._db.execute(stmt.order_by(Process.name))).scalars().all()


class MasterStepRepository:
    def __init__(self, db: AsyncSession):
        self._db = db

    async def list_for_script(self, script_id: uuid.UUID) -> Sequence[MasterStep]:
        result = await self._db.execute(
            select(MasterStep)
            .where(MasterStep.script_id == script_id, MasterStep.is_active == True)
            .order_by(MasterStep.step_no)
        )
        return result.scalars().all()

    async def upsert_code(self, script_id: uuid.UUID, encrypted_code: str, code_hash: str) -> PlaywrightCode:
        existing = (await self._db.execute(
            select(PlaywrightCode).where(PlaywrightCode.script_id == script_id)
        )).scalar_one_or_none()
        if existing:
            existing.encrypted_code = encrypted_code
            existing.code_hash      = code_hash
            await self._db.flush()
            return existing
        pc = PlaywrightCode(script_id=script_id, encrypted_code=encrypted_code, code_hash=code_hash)
        self._db.add(pc)
        await self._db.flush()
        return pc
