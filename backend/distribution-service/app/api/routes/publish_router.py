"""Publish Router — accepts script IDs, calls Recording Service, saves to Client DB."""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.domain import PublishRequest, ExportRequest, PublishResult
from app.services.publish_service import publish_service
from app.utils.database import get_client_db

router = APIRouter()


@router.post("/publish", response_model=PublishResult, status_code=200)
async def publish_selected(
    body: PublishRequest,
    client_db: AsyncSession = Depends(get_client_db),
):
    """
    Publish selected scripts to Client DB.
    Calls Recording Service export API to fetch data — no direct Master DB access.
    release_id is assigned at publish time.
    """
    return await publish_service.publish(
        script_ids=body.script_ids,
        release_id=body.release_id,
        client_db=client_db,
    )


@router.post("/export", response_model=PublishResult, status_code=200)
async def export_bulk(
    body: ExportRequest,
    client_db: AsyncSession = Depends(get_client_db),
):
    """Export ALL valid scripts for a release/module/process scope."""
    return await publish_service.publish_bulk(
        release_id=body.release_id,
        module_id=body.module_id,
        process_id=body.process_id,
        client_db=client_db,
    )