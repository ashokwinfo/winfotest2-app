from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine,
)
import structlog
from app.utils.settings import settings

log = structlog.get_logger(__name__)


class DatabaseManager:
    def __init__(self):
        self._engine  = None
        self._factory = None

    async def connect(self):
        self._engine = create_async_engine(
            settings.client_db_url, pool_size=10, pool_pre_ping=True,
        )
        self._factory = async_sessionmaker(
            bind=self._engine, class_=AsyncSession,
            expire_on_commit=False, autoflush=False,
        )
        log.info("Client DB connected")

    async def disconnect(self):
        if self._engine:
            await self._engine.dispose()

    async def is_healthy(self) -> bool:
        try:
            async with self._engine.connect() as c:
                await c.execute(text("SELECT 1"))
            return True
        except Exception:
            return False

    def session(self):
        return self._factory()


db_manager = DatabaseManager()


async def get_client_db():
    async with db_manager.session() as s:
        try:
            yield s
            await s.commit()
        except Exception:
            await s.rollback()
            raise