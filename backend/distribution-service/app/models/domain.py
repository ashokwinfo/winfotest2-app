from __future__ import annotations
import uuid
from datetime import datetime
from typing import Any, List, Optional
from pydantic import BaseModel, Field


class PublishRequest(BaseModel):
    script_ids: List[uuid.UUID] = Field(..., min_length=1,
        description="Script IDs to publish to Client DB")
    release_id: Optional[uuid.UUID] = Field(None,
        description="Release to associate with these scripts (assigned at publish time)")

class ExportRequest(BaseModel):
    release_id:  Optional[uuid.UUID] = None
    module_id:   Optional[uuid.UUID] = None
    process_id:  Optional[uuid.UUID] = None
    description: str = "Export all valid scripts for the selected scope"

class PublishResult(BaseModel):
    published: int
    skipped: int
    errors: List[str] = []

class ExecutionScriptResponse(BaseModel):
    id: uuid.UUID
    master_script_id: uuid.UUID
    release_id: Optional[uuid.UUID]
    case_number: str
    name: str
    description: Optional[str]
    role: Optional[str]
    script_type: str
    status: str
    labels: List[str]
    step_count: int = 0
    published_at: Optional[datetime]
    class Config: from_attributes = True

class ExecutionStepResponse(BaseModel):
    id: uuid.UUID
    execution_script_id: uuid.UUID
    master_step_id: Optional[uuid.UUID]
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
    is_modified: bool
    is_added: bool
    created_at: Optional[datetime]
    updated_at: Optional[datetime]
    # locator_code intentionally excluded
    class Config: from_attributes = True

class StepCreate(BaseModel):
    step_no: int
    step_description: str = ""
    action: str = "Action"
    input_parameter: Optional[str] = None
    input_type: Optional[str] = None
    default_value: Optional[str] = None
    wait_ms: int = 0
    is_dropdown_open: bool = False
    is_option_selection: bool = False
    take_screenshot: bool = True
    is_manual: bool = False

class StepUpdate(BaseModel):
    step_no: Optional[int] = None
    step_description: Optional[str] = None
    action: Optional[str] = None
    input_parameter: Optional[str] = None
    input_type: Optional[str] = None
    default_value: Optional[str] = None
    wait_ms: Optional[int] = None
    is_dropdown_open: Optional[bool] = None
    is_option_selection: Optional[bool] = None

class ReorderRequest(BaseModel):
    items: List[dict[str, Any]] = Field(..., description="[{step_id, new_order}]")
