"""Hierarchy Routers – Products, Releases, Modules, Features, Processes
NOTE: Modules belong to Products (not Releases). Releases are managed here
but are only used by the Distribution Service at publish time.
"""
from __future__ import annotations
import uuid
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.domain import (
    ProductCreate, ProductUpdate, ProductResponse,
    ReleaseCreate, ReleaseClone, ReleaseUpdate, ReleaseResponse,
    ModuleCreate, ModuleUpdate, ModuleResponse,
    FeatureCreate, FeatureUpdate, FeatureResponse,
    ProcessCreate, ProcessUpdate, ProcessResponse,
)
from app.models.database import Product, Release, Module, Feature, Process
from app.utils.database import get_db
import sqlalchemy as sa

router = APIRouter()


# ── PRODUCTS ──────────────────────────────────────────────────────────────────
@router.post("/products", response_model=ProductResponse, status_code=201)
async def create_product(body: ProductCreate, db=Depends(get_db)):
    existing = (await db.execute(select(Product).where(Product.name == body.name))).scalar_one_or_none()
    if existing:
        raise HTTPException(409, f"Product '{body.name}' already exists.")
    obj = Product(name=body.name, abbreviation=body.abbreviation, description=body.description)
    db.add(obj); await db.flush(); await db.refresh(obj)
    return ProductResponse.model_validate(obj)

@router.get("/products", response_model=List[ProductResponse])
async def list_products(db=Depends(get_db)):
    rows = (await db.execute(select(Product).where(Product.is_active == True).order_by(Product.name))).scalars().all()
    return [ProductResponse.model_validate(p) for p in rows]

@router.get("/products/{pid}", response_model=ProductResponse)
async def get_product(pid: uuid.UUID, db=Depends(get_db)):
    obj = await db.get(Product, pid)
    if not obj: raise HTTPException(404, "Product not found.")
    return ProductResponse.model_validate(obj)

@router.patch("/products/{pid}", response_model=ProductResponse)
async def update_product(pid: uuid.UUID, body: ProductUpdate, db=Depends(get_db)):
    obj = await db.get(Product, pid)
    if not obj: raise HTTPException(404, "Product not found.")
    for k, v in body.model_dump(exclude_none=True).items(): setattr(obj, k, v)
    await db.flush(); await db.refresh(obj)
    return ProductResponse.model_validate(obj)

@router.delete("/products/{pid}", status_code=204)
async def delete_product(pid: uuid.UUID, db=Depends(get_db)):
    obj = await db.get(Product, pid)
    if not obj: raise HTTPException(404, "Product not found.")
    await db.delete(obj)


# ── RELEASES (managed here, used by Distribution) ────────────────────────────
@router.post("/releases", response_model=ReleaseResponse, status_code=201)
async def create_release(body: ReleaseCreate, db=Depends(get_db)):
    obj = Release(product_id=body.product_id, name=body.name, description=body.description)
    db.add(obj); await db.flush(); await db.refresh(obj)
    return ReleaseResponse.model_validate(obj)

@router.get("/releases", response_model=List[ReleaseResponse])
async def list_releases(product_id: uuid.UUID, db=Depends(get_db)):
    rows = (await db.execute(
        select(Release).where(Release.product_id == product_id).order_by(Release.created_at.desc())
    )).scalars().all()
    return [ReleaseResponse.model_validate(r) for r in rows]

@router.get("/releases/{rid}", response_model=ReleaseResponse)
async def get_release(rid: uuid.UUID, db=Depends(get_db)):
    obj = await db.get(Release, rid)
    if not obj: raise HTTPException(404, "Release not found.")
    return ReleaseResponse.model_validate(obj)

@router.patch("/releases/{rid}", response_model=ReleaseResponse)
async def update_release(rid: uuid.UUID, body: ReleaseUpdate, db=Depends(get_db)):
    obj = await db.get(Release, rid)
    if not obj: raise HTTPException(404, "Release not found.")
    for k, v in body.model_dump(exclude_none=True).items(): setattr(obj, k, v)
    await db.flush(); await db.refresh(obj)
    return ReleaseResponse.model_validate(obj)

@router.post("/releases/{rid}/clone", response_model=ReleaseResponse, status_code=201)
async def clone_release(rid: uuid.UUID, body: ReleaseClone, db=Depends(get_db)):
    """Clone a release (copy all modules/features/processes to a new release name)."""
    source = await db.get(Release, rid)
    if not source: raise HTTPException(404, "Release not found.")
    new_rel = Release(
        product_id=source.product_id, name=body.new_name,
        description=source.description, cloned_from_id=rid,
    )
    db.add(new_rel); await db.flush(); await db.refresh(new_rel)
    return ReleaseResponse.model_validate(new_rel)


# ── MODULES (belong to Product, not Release) ──────────────────────────────────
@router.post("/modules", response_model=ModuleResponse, status_code=201)
async def create_module(body: ModuleCreate, db=Depends(get_db)):
    obj = Module(
        product_id=body.product_id, name=body.name,
        abbreviation=body.abbreviation, description=body.description,
    )
    db.add(obj); await db.flush(); await db.refresh(obj)
    return ModuleResponse.model_validate(obj)

@router.get("/modules", response_model=List[ModuleResponse])
async def list_modules(product_id: uuid.UUID, db=Depends(get_db)):
    rows = (await db.execute(
        select(Module).where(Module.product_id == product_id, Module.is_active == True)
        .order_by(Module.name)
    )).scalars().all()
    return [ModuleResponse.model_validate(m) for m in rows]

@router.get("/modules/{mid}", response_model=ModuleResponse)
async def get_module(mid: uuid.UUID, db=Depends(get_db)):
    obj = await db.get(Module, mid)
    if not obj: raise HTTPException(404, "Module not found.")
    return ModuleResponse.model_validate(obj)

@router.patch("/modules/{mid}", response_model=ModuleResponse)
async def update_module(mid: uuid.UUID, body: ModuleUpdate, db=Depends(get_db)):
    obj = await db.get(Module, mid)
    if not obj: raise HTTPException(404, "Module not found.")
    for k, v in body.model_dump(exclude_none=True).items(): setattr(obj, k, v)
    await db.flush(); await db.refresh(obj)
    return ModuleResponse.model_validate(obj)

@router.delete("/modules/{mid}", status_code=204)
async def delete_module(mid: uuid.UUID, db=Depends(get_db)):
    obj = await db.get(Module, mid)
    if not obj: raise HTTPException(404, "Module not found.")
    await db.delete(obj)


# ── FEATURES ──────────────────────────────────────────────────────────────────
@router.post("/features", response_model=FeatureResponse, status_code=201)
async def create_feature(body: FeatureCreate, db=Depends(get_db)):
    obj = Feature(
        module_id=body.module_id, name=body.name,
        abbreviation=body.abbreviation, description=body.description,
    )
    db.add(obj); await db.flush(); await db.refresh(obj)
    return FeatureResponse.model_validate(obj)

@router.get("/features", response_model=List[FeatureResponse])
async def list_features(module_id: uuid.UUID, db=Depends(get_db)):
    rows = (await db.execute(
        select(Feature).where(Feature.module_id == module_id, Feature.is_active == True)
        .order_by(Feature.name)
    )).scalars().all()
    return [FeatureResponse.model_validate(f) for f in rows]

@router.get("/features/{fid}", response_model=FeatureResponse)
async def get_feature(fid: uuid.UUID, db=Depends(get_db)):
    obj = await db.get(Feature, fid)
    if not obj: raise HTTPException(404, "Feature not found.")
    return FeatureResponse.model_validate(obj)

@router.patch("/features/{fid}", response_model=FeatureResponse)
async def update_feature(fid: uuid.UUID, body: FeatureUpdate, db=Depends(get_db)):
    obj = await db.get(Feature, fid)
    if not obj: raise HTTPException(404, "Feature not found.")
    for k, v in body.model_dump(exclude_none=True).items(): setattr(obj, k, v)
    await db.flush(); await db.refresh(obj)
    return FeatureResponse.model_validate(obj)

@router.delete("/features/{fid}", status_code=204)
async def delete_feature(fid: uuid.UUID, db=Depends(get_db)):
    obj = await db.get(Feature, fid)
    if not obj: raise HTTPException(404, "Feature not found.")
    await db.delete(obj)


# ── PROCESSES ─────────────────────────────────────────────────────────────────
@router.post("/processes", response_model=ProcessResponse, status_code=201)
async def create_process(body: ProcessCreate, db=Depends(get_db)):
    obj = Process(
        module_id=body.module_id, feature_id=body.feature_id,
        name=body.name, description=body.description,
    )
    db.add(obj); await db.flush(); await db.refresh(obj)
    return ProcessResponse.model_validate(obj)

@router.get("/processes", response_model=List[ProcessResponse])
async def list_processes(
    module_id: uuid.UUID,
    feature_id: Optional[uuid.UUID] = None,
    db=Depends(get_db),
):
    stmt = select(Process).where(Process.module_id == module_id, Process.is_active == True)
    if feature_id:
        stmt = stmt.where(Process.feature_id == feature_id)
    rows = (await db.execute(stmt.order_by(Process.name))).scalars().all()
    return [ProcessResponse.model_validate(p) for p in rows]

@router.get("/processes/{pid}", response_model=ProcessResponse)
async def get_process(pid: uuid.UUID, db=Depends(get_db)):
    obj = await db.get(Process, pid)
    if not obj: raise HTTPException(404, "Process not found.")
    return ProcessResponse.model_validate(obj)

@router.patch("/processes/{pid}", response_model=ProcessResponse)
async def update_process(pid: uuid.UUID, body: ProcessUpdate, db=Depends(get_db)):
    obj = await db.get(Process, pid)
    if not obj: raise HTTPException(404, "Process not found.")
    for k, v in body.model_dump(exclude_none=True).items(): setattr(obj, k, v)
    await db.flush(); await db.refresh(obj)
    return ProcessResponse.model_validate(obj)

@router.delete("/processes/{pid}", status_code=204)
async def delete_process(pid: uuid.UUID, db=Depends(get_db)):
    obj = await db.get(Process, pid)
    if not obj: raise HTTPException(404, "Process not found.")
    await db.delete(obj)
