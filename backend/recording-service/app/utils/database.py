from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine,
)
import structlog
from app.utils.settings import settings
from app.models.database import Base

log = structlog.get_logger(__name__)


class DatabaseManager:
    def __init__(self):
        self._engine: AsyncEngine | None = None
        self._factory: async_sessionmaker | None = None

    async def connect(self):
        self._engine = create_async_engine(
            settings.master_db_url,
            pool_size=10, max_overflow=20, pool_pre_ping=True,
            echo=(settings.ENV == "development"),
        )
        self._factory = async_sessionmaker(
            bind=self._engine, class_=AsyncSession,
            expire_on_commit=False, autoflush=False,
        )
        async with self._engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        log.info("Master DB connected, tables ensured", env=settings.ENV)

    async def disconnect(self):
        if self._engine:
            await self._engine.dispose()

    async def is_healthy(self) -> bool:
        if not self._engine:
            return False
        try:
            async with self._engine.connect() as c:
                await c.execute(text("SELECT 1"))
            return True
        except Exception:
            return False

    def session(self) -> AsyncSession:
        return self._factory()


db_manager = DatabaseManager()


async def get_db():
    async with db_manager.session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
