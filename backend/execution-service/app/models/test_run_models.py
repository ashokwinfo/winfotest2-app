"""
Test Run models — Execution Service
=====================================
Isolated per-run workspace for executing and editing steps.
NEVER touches execution_scripts or execution_steps.
"""
from __future__ import annotations
import uuid
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PG_UUID, ARRAY
from sqlalchemy import MetaData

meta = MetaData()

# ── test_runs ──────────────────────────────────────────────────────────────────
t_test_runs = sa.Table("test_runs", meta,
    sa.Column("id",               PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
    sa.Column("name",             sa.String(300), nullable=False),
    sa.Column("description",      sa.Text,        nullable=True),
    sa.Column("status",           sa.String(30),  nullable=False, default="pending"),
    # pending | running | paused | completed | failed | stopped
    sa.Column("browser",          sa.String(30),  nullable=False, default="chromium"),
    sa.Column("parallel_workers", sa.Integer,     nullable=False, default=1),
    sa.Column("total_scripts",    sa.Integer,     nullable=False, default=0),
    sa.Column("passed_scripts",   sa.Integer,     nullable=False, default=0),
    sa.Column("failed_scripts",   sa.Integer,     nullable=False, default=0),
    sa.Column("started_at",       sa.DateTime(timezone=True), nullable=True),
    sa.Column("ended_at",         sa.DateTime(timezone=True), nullable=True),
    sa.Column("created_at",       sa.DateTime(timezone=True),
              server_default=sa.func.now()),
)

# ── test_run_scripts ───────────────────────────────────────────────────────────
t_test_run_scripts = sa.Table("test_run_scripts", meta,
    sa.Column("id",                  PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
    sa.Column("test_run_id",         PG_UUID(as_uuid=True),
              sa.ForeignKey("test_runs.id", ondelete="CASCADE"), nullable=False),
    sa.Column("execution_script_id", PG_UUID(as_uuid=True), nullable=False),
    sa.Column("case_number",         sa.String(50),  nullable=True),
    sa.Column("name",                sa.String(255), nullable=True),
    sa.Column("status",              sa.String(30),  nullable=False, default="pending"),
    # pending | running | paused | completed | failed | stopped
    sa.Column("screenshot_mode",     sa.String(20),  nullable=False, default="all"),
    sa.Column("total_steps",         sa.Integer,     nullable=False, default=0),
    sa.Column("passed_steps",        sa.Integer,     nullable=False, default=0),
    sa.Column("failed_steps",        sa.Integer,     nullable=False, default=0),
    sa.Column("duration_ms",         sa.Integer,     nullable=True),
    sa.Column("error_summary",       sa.Text,        nullable=True),
    sa.Column("started_at",          sa.DateTime(timezone=True), nullable=True),
    sa.Column("ended_at",            sa.DateTime(timezone=True), nullable=True),
)

# ── test_run_steps ────────────────────────────────────────────────────────────
# Isolated editable copy of steps for this run.
# Copied from execution_steps on run creation; edits here never affect the source.
t_test_run_steps = sa.Table("test_run_steps", meta,
    sa.Column("id",                  PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
    sa.Column("test_run_script_id",  PG_UUID(as_uuid=True),
              sa.ForeignKey("test_run_scripts.id", ondelete="CASCADE"), nullable=False),
    sa.Column("execution_step_id",   PG_UUID(as_uuid=True), nullable=True),   # source step
    sa.Column("step_no",             sa.Integer,    nullable=False, default=0),
    sa.Column("step_description",    sa.Text,       nullable=False, default=""),
    sa.Column("action",              sa.String(100),nullable=False, default="Action"),
    sa.Column("input_parameter",     sa.String(500),nullable=True),
    sa.Column("input_type",          sa.String(50), nullable=True),
    sa.Column("locator_code",        sa.Text,       nullable=True),  # backend-only
    sa.Column("default_value",       sa.Text,       nullable=True),
    sa.Column("wait_ms",             sa.Integer,    nullable=False, default=0),
    sa.Column("is_dropdown_open",    sa.Boolean,    nullable=False, default=False),
    sa.Column("is_option_selection", sa.Boolean,    nullable=False, default=False),
    sa.Column("take_screenshot",     sa.Boolean,    nullable=False, default=True),
    sa.Column("is_active",           sa.Boolean,    nullable=False, default=True),
    sa.Column("is_manual",           sa.Boolean,    nullable=False, default=False),
    sa.Column("is_injected",         sa.Boolean,    nullable=False, default=False),
    sa.Column("is_modified",         sa.Boolean,    nullable=False, default=False),
    sa.Column("created_at",          sa.DateTime(timezone=True), server_default=sa.func.now()),
    sa.Column("updated_at",          sa.DateTime(timezone=True), server_default=sa.func.now()),
)

# ── test_run_step_results ──────────────────────────────────────────────────────
t_test_run_step_results = sa.Table("test_run_step_results", meta,
    sa.Column("id",                   PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
    sa.Column("test_run_script_id",   PG_UUID(as_uuid=True),
              sa.ForeignKey("test_run_scripts.id", ondelete="CASCADE"), nullable=False),
    sa.Column("test_run_step_id",     PG_UUID(as_uuid=True), nullable=True),
    sa.Column("step_no",              sa.Integer,    nullable=False),
    sa.Column("step_description",     sa.String(500),nullable=True),
    sa.Column("action",               sa.String(100),nullable=True),
    sa.Column("input_parameter",      sa.String(500),nullable=True),
    sa.Column("input_value",          sa.Text,       nullable=True),
    sa.Column("status",               sa.String(20), nullable=False, default="pending"),
    # pending | running | passed | failed | skipped | stopped
    sa.Column("started_at",           sa.DateTime(timezone=True), nullable=True),
    sa.Column("ended_at",             sa.DateTime(timezone=True), nullable=True),
    sa.Column("duration_ms",          sa.Integer,    nullable=True),
    sa.Column("retry_count",          sa.Integer,    nullable=False, default=0),
    sa.Column("screenshot_b64",       sa.Text,       nullable=True),
    sa.Column("error_message",        sa.Text,       nullable=True),
    # executed_locator intentionally excluded from all API responses
    sa.Column("executed_locator",     sa.Text,       nullable=True),
)