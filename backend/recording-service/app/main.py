"""Recording Service – Entry Point"""
from contextlib import asynccontextmanager
import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator

from app.api.routes.hierarchy_router import router as hierarchy_router
from app.api.routes.script_router    import router as script_router
from app.api.routes.recording_router import router as recording_router
from app.utils.database import db_manager
from app.utils.settings import settings

log = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Recording Service starting", env=settings.ENV)
    await db_manager.connect()
    yield
    await db_manager.disconnect()
    log.info("Recording Service stopped")


app = FastAPI(
    title="Winfo Test 2.0 – Recording Service",
    version="4.0.0",
    lifespan=lifespan,
    docs_url="/docs" if settings.ENV != "production" else None,
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

Instrumentator().instrument(app).expose(app, endpoint="/metrics")

app.include_router(hierarchy_router, prefix="/api/v1",          tags=["Hierarchy"])
app.include_router(script_router,    prefix="/api/v1/scripts",   tags=["Scripts"])
app.include_router(recording_router, prefix="/api/v1/recording", tags=["Recording"])


@app.get("/health", tags=["Health"])
async def health():
    ok = await db_manager.is_healthy()
    return {
        "service":  "recording-service",
        "status":   "ok" if ok else "degraded",
        "env":      settings.ENV,
        "database": "connected" if ok else "disconnected",
    }


@app.get("/api/v1/config", tags=["Config"])
async def get_config():
    """Non-sensitive config for frontend."""
    return {
        "env":              settings.ENV,
        "oracle_erp_url":   settings.ORACLE_ERP_URL,
        "default_browser":  settings.DEFAULT_BROWSER,
        "browser_timeout":  settings.BROWSER_TIMEOUT,
        "label_suggestions": ["smoke", "regression", "critical-path", "sanity", "happy-path", "edge-case"],
    }
