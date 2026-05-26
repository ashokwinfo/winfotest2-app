from sqlalchemy import text as sa_text
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
import structlog
from app.utils.settings import settings
log = structlog.get_logger(__name__)

class DatabaseManager:
    def __init__(self): self._engine = self._factory = None
    async def connect(self):
        self._engine = create_async_engine(settings.client_db_url, pool_size=10, pool_pre_ping=True)
        self._factory = async_sessionmaker(
            bind=self._engine, class_=AsyncSession,
            expire_on_commit=False, autoflush=False,
        )
        await self._create_test_run_tables()
        log.info("Client DB connected")

    async def _create_test_run_tables(self):
        """Create test run tables if they don't exist (safe to call repeatedly)."""
        ddl = """
        CREATE TABLE IF NOT EXISTS test_runs (
            id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name             VARCHAR(300) NOT NULL,
            description      TEXT,
            status           VARCHAR(30)  NOT NULL DEFAULT 'pending',
            browser          VARCHAR(30)  NOT NULL DEFAULT 'chromium',
            parallel_workers INTEGER      NOT NULL DEFAULT 1,
            total_scripts    INTEGER      NOT NULL DEFAULT 0,
            passed_scripts   INTEGER      NOT NULL DEFAULT 0,
            failed_scripts   INTEGER      NOT NULL DEFAULT 0,
            started_at       TIMESTAMPTZ,
            ended_at         TIMESTAMPTZ,
            created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS test_run_scripts (
            id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            test_run_id          UUID NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
            execution_script_id  UUID NOT NULL,
            case_number          VARCHAR(50),
            name                 VARCHAR(255),
            status               VARCHAR(30) NOT NULL DEFAULT 'pending',
            screenshot_mode      VARCHAR(20) NOT NULL DEFAULT 'all',
            total_steps          INTEGER     NOT NULL DEFAULT 0,
            passed_steps         INTEGER     NOT NULL DEFAULT 0,
            failed_steps         INTEGER     NOT NULL DEFAULT 0,
            duration_ms          INTEGER,
            error_summary        TEXT,
            started_at           TIMESTAMPTZ,
            ended_at             TIMESTAMPTZ
        );

        CREATE TABLE IF NOT EXISTS test_run_steps (
            id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            test_run_script_id   UUID NOT NULL REFERENCES test_run_scripts(id) ON DELETE CASCADE,
            execution_step_id    UUID,
            step_no              INTEGER     NOT NULL DEFAULT 0,
            step_description     TEXT        NOT NULL DEFAULT '',
            action               VARCHAR(100) NOT NULL DEFAULT 'Action',
            input_parameter      VARCHAR(500),
            input_type           VARCHAR(50),
            locator_code         TEXT,
            default_value        TEXT,
            wait_ms              INTEGER     NOT NULL DEFAULT 0,
            is_dropdown_open     BOOLEAN     NOT NULL DEFAULT FALSE,
            is_option_selection  BOOLEAN     NOT NULL DEFAULT FALSE,
            take_screenshot      BOOLEAN     NOT NULL DEFAULT TRUE,
            is_active            BOOLEAN     NOT NULL DEFAULT TRUE,
            is_manual            BOOLEAN     NOT NULL DEFAULT FALSE,
            is_injected          BOOLEAN     NOT NULL DEFAULT FALSE,
            is_modified          BOOLEAN     NOT NULL DEFAULT FALSE,
            created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS test_run_step_results (
            id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            test_run_script_id   UUID NOT NULL REFERENCES test_run_scripts(id) ON DELETE CASCADE,
            test_run_step_id     UUID,
            step_no              INTEGER      NOT NULL,
            step_description     VARCHAR(500),
            action               VARCHAR(100),
            input_parameter      VARCHAR(500),
            input_value          TEXT,
            status               VARCHAR(20)  NOT NULL DEFAULT 'pending',
            started_at           TIMESTAMPTZ,
            ended_at             TIMESTAMPTZ,
            duration_ms          INTEGER,
            retry_count          INTEGER      NOT NULL DEFAULT 0,
            screenshot_b64       TEXT,
            error_message        TEXT,
            executed_locator     TEXT
        );
        """
        async with self._engine.begin() as conn:
            for stmt in ddl.strip().split(";"):
                stmt = stmt.strip()
                if stmt:
                    await conn.execute(sa_text(stmt))
    async def disconnect(self):
        if self._engine: await self._engine.dispose()
    async def is_healthy(self):
        try:
            async with self._engine.connect() as c: await c.execute(sa_text("SELECT 1"))
            return True
        except: return False
    def session(self): return self._factory()

db_manager = DatabaseManager()

async def get_db():
    async with db_manager.session() as s:
        try:
            yield s
            await s.commit()
        except Exception:
            await s.rollback()
            raise
