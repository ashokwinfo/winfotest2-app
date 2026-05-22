"""SQLAlchemy ORM Models – Master Database (Recording Service)
NOTE: TestScript has NO release_id. Release is assigned only at Publish time.
MasterStep fields match the monolith exactly.
"""
from __future__ import annotations
import uuid
import sqlalchemy as sa
from sqlalchemy import (
    Boolean, Column, DateTime, ForeignKey, Integer, String, Text, func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID, JSON
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


# ── Association tables ──────────────────────────────────────────────────────
script_processes = sa.Table(
    "script_processes", Base.metadata,
    sa.Column("script_id",  UUID(as_uuid=True), sa.ForeignKey("test_scripts.id", ondelete="CASCADE")),
    sa.Column("process_id", UUID(as_uuid=True), sa.ForeignKey("processes.id",    ondelete="CASCADE")),
)

script_dependencies = sa.Table(
    "script_dependencies", Base.metadata,
    sa.Column("script_id",  UUID(as_uuid=True), sa.ForeignKey("test_scripts.id", ondelete="CASCADE")),
    sa.Column("depends_on", UUID(as_uuid=True), sa.ForeignKey("test_scripts.id", ondelete="CASCADE")),
)


class Product(Base):
    __tablename__ = "products"
    id           = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name         = Column(String(255), nullable=False, unique=True)
    abbreviation = Column(String(20),  nullable=False)
    description  = Column(Text)
    is_active    = Column(Boolean, nullable=False, default=True)
    created_at   = Column(DateTime(timezone=True), server_default=func.now())
    updated_at   = Column(DateTime(timezone=True), server_default=func.now())
    modules      = relationship("Module", back_populates="product", cascade="all, delete-orphan")


class Release(Base):
    """Release exists in master DB but is only used by the Distribution Service."""
    __tablename__ = "releases"
    id             = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id     = Column(UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    name           = Column(String(100), nullable=False)
    description    = Column(Text)
    cloned_from_id = Column(UUID(as_uuid=True), ForeignKey("releases.id"), nullable=True)
    is_active      = Column(Boolean, nullable=False, default=True)
    created_at     = Column(DateTime(timezone=True), server_default=func.now())
    updated_at     = Column(DateTime(timezone=True), server_default=func.now())
    product        = relationship("Product")


class Module(Base):
    __tablename__ = "modules"
    id           = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id   = Column(UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    name         = Column(String(255), nullable=False)
    abbreviation = Column(String(20),  nullable=False)
    description  = Column(Text)
    is_active    = Column(Boolean, nullable=False, default=True)
    created_at   = Column(DateTime(timezone=True), server_default=func.now())
    updated_at   = Column(DateTime(timezone=True), server_default=func.now())
    product      = relationship("Product", back_populates="modules")
    features     = relationship("Feature",  back_populates="module", cascade="all, delete-orphan")
    processes    = relationship("Process",  back_populates="module", cascade="all, delete-orphan")


class Feature(Base):
    __tablename__ = "features"
    id           = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    module_id    = Column(UUID(as_uuid=True), ForeignKey("modules.id",  ondelete="CASCADE"), nullable=False)
    name         = Column(String(255), nullable=False)
    abbreviation = Column(String(20),  nullable=False)
    description  = Column(Text)
    is_active    = Column(Boolean, nullable=False, default=True)
    created_at   = Column(DateTime(timezone=True), server_default=func.now())
    updated_at   = Column(DateTime(timezone=True), server_default=func.now())
    module       = relationship("Module", back_populates="features")
    processes    = relationship("Process", back_populates="feature")


class Process(Base):
    __tablename__ = "processes"
    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    module_id   = Column(UUID(as_uuid=True), ForeignKey("modules.id",   ondelete="CASCADE"), nullable=False)
    feature_id  = Column(UUID(as_uuid=True), ForeignKey("features.id",  ondelete="SET NULL"), nullable=True)
    name        = Column(String(255), nullable=False)
    description = Column(Text)
    is_active   = Column(Boolean, nullable=False, default=True)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())
    updated_at  = Column(DateTime(timezone=True), server_default=func.now())
    module      = relationship("Module",  back_populates="processes")
    feature     = relationship("Feature", back_populates="processes")


class CaseNumberSequence(Base):
    """Sequence counter per module+feature combination (no release dependency)."""
    __tablename__ = "case_number_sequences"
    id         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    module_id  = Column(UUID(as_uuid=True), ForeignKey("modules.id",  ondelete="CASCADE"), nullable=False)
    feature_id = Column(UUID(as_uuid=True), ForeignKey("features.id", ondelete="SET NULL"), nullable=True)
    next_seq   = Column(Integer, nullable=False, default=1)


class TestScript(Base):
    """Test script - belongs to Module/Feature/Process. NO release_id."""
    __tablename__ = "test_scripts"
    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    module_id   = Column(UUID(as_uuid=True), ForeignKey("modules.id"),   nullable=False)
    feature_id  = Column(UUID(as_uuid=True), ForeignKey("features.id"),  nullable=True)
    case_number = Column(String(50),  nullable=False, unique=True)
    name        = Column(String(255), nullable=False)
    description = Column(Text)
    role        = Column(String(255))
    script_type = Column(String(50),  nullable=False, default="standard")
    status      = Column(String(20),  nullable=False, default="valid")
    labels      = Column(ARRAY(String), default=[])
    is_deleted  = Column(Boolean, nullable=False, default=False)
    version     = Column(Integer, nullable=False, default=1)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())
    updated_at  = Column(DateTime(timezone=True), server_default=func.now())
    master_steps     = relationship("MasterStep",      back_populates="script", cascade="all, delete-orphan",
                                    order_by="MasterStep.step_no")
    playwright_code  = relationship("PlaywrightCode",  back_populates="script", uselist=False, cascade="all, delete-orphan")
    recording_session = relationship("RecordingSession", back_populates="script", uselist=False)


class MasterStep(Base):
    """Master step - matches monolith's MasterStep field structure exactly.
    locator_code contains the Playwright template - NEVER sent to UI.
    """
    __tablename__ = "master_steps"
    id                   = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    script_id            = Column(UUID(as_uuid=True), ForeignKey("test_scripts.id", ondelete="CASCADE"), nullable=False)
    step_no              = Column(Integer, nullable=False, default=0)
    step_description     = Column(Text,         nullable=False, default="")
    action               = Column(String(100),  nullable=False, default="Action")
    input_parameter      = Column(String(500),  nullable=True)
    input_type           = Column(String(50),   nullable=True)
    locator_code         = Column(Text,         nullable=True)   # Playwright template - backend only
    default_value        = Column(Text,         nullable=True)
    wait_ms              = Column(Integer,      nullable=False, default=0)
    is_dropdown_open     = Column(Boolean,      nullable=False, default=False)
    is_option_selection  = Column(Boolean,      nullable=False, default=False)
    take_screenshot      = Column(Boolean,      nullable=False, default=True)
    is_active            = Column(Boolean,      nullable=False, default=True)
    is_manual            = Column(Boolean,      nullable=False, default=False)
    created_at           = Column(DateTime(timezone=True), server_default=func.now())
    updated_at           = Column(DateTime(timezone=True), server_default=func.now())
    script               = relationship("TestScript", back_populates="master_steps")


class PlaywrightCode(Base):
    __tablename__ = "playwright_code"
    id             = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    script_id      = Column(UUID(as_uuid=True), ForeignKey("test_scripts.id", ondelete="CASCADE"), nullable=False, unique=True)
    encrypted_code = Column(Text, nullable=False)
    code_hash      = Column(String(64), nullable=False)
    generated_at   = Column(DateTime(timezone=True), server_default=func.now())
    updated_at     = Column(DateTime(timezone=True), server_default=func.now())
    script         = relationship("TestScript", back_populates="playwright_code")


class RecordingSession(Base):
    __tablename__ = "recording_sessions"
    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    script_id   = Column(UUID(as_uuid=True), ForeignKey("test_scripts.id", ondelete="CASCADE"), nullable=False)
    session_key = Column(String(255), nullable=False, unique=True)
    status      = Column(String(50),  nullable=False, default="active")
    browser     = Column(String(50),  nullable=False, default="chromium")
    target_url  = Column(Text,        nullable=False)
    started_at  = Column(DateTime(timezone=True), server_default=func.now())
    ended_at    = Column(DateTime(timezone=True))
    # metadata    = Column(JSONB, default={})
    session_metadata = Column("metadata", JSON, nullable=True)
    script      = relationship("TestScript", back_populates="recording_session")
