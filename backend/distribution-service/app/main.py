"""Distribution Service – Entry Point"""
from contextlib import asynccontextmanager
import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator

from app.api.routes import publish_router, workspace_router
from app.utils.database import db_manager
from app.utils.settings import settings

log = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Distribution Service starting", env=settings.ENV)
    await db_manager.connect()
    yield
    await db_manager.disconnect()


app = FastAPI(
    title="Winfo Test 2.0 – Distribution Service",
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

app.include_router(publish_router.router,    prefix="/api/v1", tags=["Publish / Export"])
app.include_router(workspace_router.router,  prefix="/api/v1/workspace", tags=["Workspace"])


@app.get("/health", tags=["Health"])
async def health():
    ok = await db_manager.is_healthy()
    return {"service": "distribution-service", "status": "ok" if ok else "degraded", "env": settings.ENV}
