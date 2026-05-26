"""Pydantic Domain Models – Recording Service (no release in recording hierarchy)"""
from __future__ import annotations
import uuid
from datetime import datetime
from typing import Any, List, Optional
from pydantic import BaseModel, Field


# ── PRODUCT ──────────────────────────────────────────────────────────────────
class ProductCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    abbreviation: str = Field(..., min_length=1, max_length=20)
    description: Optional[str] = None

class ProductUpdate(BaseModel):
    name: Optional[str] = None
    abbreviation: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None

class ProductResponse(BaseModel):
    id: uuid.UUID
    name: str
    abbreviation: str
    description: Optional[str]
    is_active: bool
    created_at: datetime
    updated_at: datetime
    class Config: from_attributes = True


# ── RELEASE (only used by Distribution at publish time) ───────────────────────
class ReleaseCreate(BaseModel):
    product_id: uuid.UUID
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None

class ReleaseClone(BaseModel):
    new_name: str = Field(..., description="Name for the new release, e.g. 26B")

class ReleaseUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None

class ReleaseResponse(BaseModel):
    id: uuid.UUID
    product_id: uuid.UUID
    name: str
    description: Optional[str]
    cloned_from_id: Optional[uuid.UUID]
    is_active: bool
    created_at: datetime
    updated_at: datetime
    class Config: from_attributes = True


# ── MODULE ───────────────────────────────────────────────────────────────────
class ModuleCreate(BaseModel):
    product_id: uuid.UUID
    name: str = Field(..., min_length=1, max_length=255)
    abbreviation: str = Field(..., min_length=1, max_length=20)
    description: Optional[str] = None

class ModuleUpdate(BaseModel):
    name: Optional[str] = None
    abbreviation: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None

class ModuleResponse(BaseModel):
    id: uuid.UUID
    product_id: uuid.UUID
    name: str
    abbreviation: str
    description: Optional[str]
    is_active: bool
    created_at: datetime
    updated_at: datetime
    class Config: from_attributes = True


# ── FEATURE ──────────────────────────────────────────────────────────────────
class FeatureCreate(BaseModel):
    module_id: uuid.UUID
    name: str = Field(..., min_length=1, max_length=255)
    abbreviation: str = Field(..., min_length=1, max_length=20)
    description: Optional[str] = None

class FeatureUpdate(BaseModel):
    name: Optional[str] = None
    abbreviation: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None

class FeatureResponse(BaseModel):
    id: uuid.UUID
    module_id: uuid.UUID
    name: str
    abbreviation: str
    description: Optional[str]
    is_active: bool
    created_at: datetime
    updated_at: datetime
    class Config: from_attributes = True


# ── PROCESS ──────────────────────────────────────────────────────────────────
class ProcessCreate(BaseModel):
    module_id: uuid.UUID
    feature_id: Optional[uuid.UUID] = None
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None

class ProcessUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None

class ProcessResponse(BaseModel):
    id: uuid.UUID
    module_id: uuid.UUID
    feature_id: Optional[uuid.UUID]
    name: str
    description: Optional[str]
    is_active: bool
    created_at: datetime
    updated_at: datetime
    class Config: from_attributes = True


# ── TEST SCRIPT (no release_id) ───────────────────────────────────────────────
class ScriptCreate(BaseModel):
    module_id: uuid.UUID
    feature_id: Optional[uuid.UUID] = None
    process_ids: List[uuid.UUID] = Field(default_factory=list)
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    role: Optional[str] = None
    script_type: str = Field(default="standard")
    labels: List[str] = Field(default_factory=list)

class ScriptUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    role: Optional[str] = None
    script_type: Optional[str] = None
    status: Optional[str] = None
    labels: Optional[List[str]] = None
    process_ids: Optional[List[uuid.UUID]] = None

class ScriptResponse(BaseModel):
    id: uuid.UUID
    module_id: uuid.UUID
    feature_id: Optional[uuid.UUID]
    case_number: str
    name: str
    description: Optional[str]
    role: Optional[str]
    script_type: str
    status: str
    labels: List[str]
    is_deleted: bool
    version: int
    process_ids: List[uuid.UUID] = Field(default_factory=list)
    depends_on: List[uuid.UUID] = Field(default_factory=list)
    step_count: int = 0
    created_at: datetime
    updated_at: datetime
    class Config: from_attributes = True

class ScriptStats(BaseModel):
    total: int
    valid: int
    archived: int
    deleted: int


# ── DEPENDENCY ────────────────────────────────────────────────────────────────
class DependencyAdd(BaseModel):
    depends_on: uuid.UUID


# ── MASTER STEP (safe output - no locator_code) ──────────────────────────────
class MasterStepResponse(BaseModel):
    id: uuid.UUID
    script_id: uuid.UUID
    step_no: int
    step_description: str
    action: str
    input_parameter: Optional[str]
    input_type: Optional[str]
    default_value: Optional[str]
    wait_ms: int
    is_dropdown_open: bool
    is_option_selection: bool
    take_screenshot: bool
    is_manual: bool
    created_at: datetime
    # locator_code intentionally excluded
    class Config: from_attributes = True


# ── RECORDING ─────────────────────────────────────────────────────────────────
class StartRecordingRequest(BaseModel):
    script_id: uuid.UUID
    target_url: Optional[str] = None
    browser: Optional[str] = None

class StopRecordingRequest(BaseModel):
    session_key: str

class RecordingSessionResponse(BaseModel):
    session_key: str
    script_id: uuid.UUID
    status: str
    started_at: datetime
    target_url: str
    websocket_url: str


# ── WEBSOCKET MESSAGE ─────────────────────────────────────────────────────────
class WSMessage(BaseModel):
    event: str
    payload: dict[str, Any] = Field(default_factory=dict)
