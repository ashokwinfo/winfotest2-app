"""Base Repository – generic async CRUD"""
from __future__ import annotations
import uuid
from typing import Generic, Optional, Sequence, Type, TypeVar
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import sqlalchemy as sa

T = TypeVar("T")


class BaseRepository(Generic[T]):
    def __init__(self, model: Type[T], db: AsyncSession):
        self._model = model
        self._db    = db

    async def create(self, **kwargs) -> T:
        obj = self._model(**kwargs)
        self._db.add(obj)
        await self._db.flush()
        await self._db.refresh(obj)
        return obj

    async def get_by_id(self, obj_id: uuid.UUID) -> Optional[T]:
        return await self._db.get(self._model, obj_id)

    async def list_by(self, order_by=None, **filters) -> Sequence[T]:
        stmt = select(self._model)
        for col, val in filters.items():
            stmt = stmt.where(getattr(self._model, col) == val)
        if order_by is not None:
            stmt = stmt.order_by(order_by)
        return (await self._db.execute(stmt)).scalars().all()

    async def update_by_id(self, obj_id: uuid.UUID, **values) -> Optional[T]:
        if values:
            await self._db.execute(
                sa.update(self._model).where(self._model.id == obj_id).values(**values)
            )
        return await self.get_by_id(obj_id)

    async def delete(self, obj_id: uuid.UUID) -> bool:
        obj = await self.get_by_id(obj_id)
        if not obj:
            return False
        await self._db.delete(obj)
        return True
