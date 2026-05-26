"""Execution Service – Entry Point"""
from contextlib import asynccontextmanager
import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator
from app.api.routes.execution_router import router
from app.utils.database import db_manager
from app.utils.settings import settings

log = structlog.get_logger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Execution Service starting", env=settings.ENV)
    await db_manager.connect()
    yield
    await db_manager.disconnect()

app = FastAPI(
    title="Winfo Test 2.0 – Execution Service",
    version="4.0.0", lifespan=lifespan,
    docs_url="/docs" if settings.ENV != "production" else None, redoc_url=None,
)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])
Instrumentator().instrument(app).expose(app, endpoint="/metrics")
app.include_router(router, prefix="/api/v1/runs", tags=["Execution"])


from app.api.routes.test_run_router import router as test_run_router
app.include_router(test_run_router, prefix="/api/v1/test-runs", tags=["TestRuns"])

# Register Playwright control router
from app.api.routes.playwright_control_router import router as playwright_control_router
app.include_router(playwright_control_router, prefix="/api/v1/playwright", tags=["PlaywrightControl"])

@app.get("/health")
async def health():
    ok = await db_manager.is_healthy()
    return {"service": "execution-service", "status": "ok" if ok else "degraded", "env": settings.ENV}
