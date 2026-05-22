"""
Publish Service  —  Winfo Test 2.0
=======================================
New architecture: calls Recording Service export API instead of
connecting to Master DB directly.

Flow:
  1. POST /api/v1/recording/export-zip → Recording Service
     Body: { script_ids: [...] }
  2. Receive ZIP archive containing manifest.json + scripts.json
  3. Extract JSON, save to Client DB (imported_* + execution_* tables)
"""
from __future__ import annotations
import io
import json
import uuid
import zipfile
from typing import List, Optional

import httpx
import structlog
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.domain import PublishResult
from app.utils.settings import settings

log = structlog.get_logger(__name__)

# ── Client DB table definitions (Core DB tables) ─────────────────────────────
_meta = sa.MetaData()

from datetime import datetime, timezone

t_releases  = sa.Table("imported_releases", _meta,
    sa.Column("id",         PG_UUID(as_uuid=True)),
    sa.Column("master_id",  PG_UUID(as_uuid=True)),
    sa.Column("product_id", PG_UUID(as_uuid=True)),
    sa.Column("name",       sa.String),
    sa.Column("imported_at", sa.DateTime(timezone=True)))

t_modules   = sa.Table("imported_modules", _meta,
    sa.Column("id",           PG_UUID(as_uuid=True)),
    sa.Column("master_id",    PG_UUID(as_uuid=True)),
    sa.Column("release_id",   PG_UUID(as_uuid=True)),
    sa.Column("name",         sa.String),
    sa.Column("abbreviation", sa.String),
    sa.Column("imported_at",  sa.DateTime(timezone=True)))

t_features  = sa.Table("imported_features", _meta,
    sa.Column("id",           PG_UUID(as_uuid=True)),
    sa.Column("master_id",    PG_UUID(as_uuid=True)),
    sa.Column("module_id",    PG_UUID(as_uuid=True)),
    sa.Column("name",         sa.String),
    sa.Column("abbreviation", sa.String),
    sa.Column("imported_at",  sa.DateTime(timezone=True)))

t_processes = sa.Table("imported_processes", _meta,
    sa.Column("id",         PG_UUID(as_uuid=True)),
    sa.Column("master_id",  PG_UUID(as_uuid=True)),
    sa.Column("module_id",  PG_UUID(as_uuid=True)),
    sa.Column("feature_id", PG_UUID(as_uuid=True)),
    sa.Column("name",       sa.String),
    sa.Column("imported_at", sa.DateTime(timezone=True)))

t_scripts   = sa.Table("execution_scripts", _meta,
    sa.Column("id",               PG_UUID(as_uuid=True)),
    sa.Column("master_script_id", PG_UUID(as_uuid=True)),
    sa.Column("release_id",       PG_UUID(as_uuid=True)),
    sa.Column("module_id",        PG_UUID(as_uuid=True)),
    sa.Column("feature_id",       PG_UUID(as_uuid=True)),
    sa.Column("case_number",      sa.String),
    sa.Column("name",             sa.String),
    sa.Column("description",      sa.Text),
    sa.Column("role",             sa.String),
    sa.Column("script_type",      sa.String),
    sa.Column("status",           sa.String),
    sa.Column("labels",           sa.ARRAY(sa.String)),
    sa.Column("published_at",     sa.DateTime(timezone=True)),
    sa.Column("updated_at",       sa.DateTime(timezone=True)))

t_steps = sa.Table("execution_steps", _meta,
    sa.Column("id",                  PG_UUID(as_uuid=True)),
    sa.Column("execution_script_id", PG_UUID(as_uuid=True)),
    sa.Column("master_step_id",      PG_UUID(as_uuid=True)),
    sa.Column("step_order",          sa.Integer),
    sa.Column("action_type",         sa.String),
    sa.Column("selector",            sa.String),
    sa.Column("value",               sa.String),
    sa.Column("description",         sa.String),
    sa.Column("is_modified",         sa.Boolean),
    sa.Column("is_added",            sa.Boolean),
    sa.Column("metadata",            sa.JSON),
    sa.Column("created_at",          sa.DateTime(timezone=True)),
    sa.Column("updated_at",          sa.DateTime(timezone=True)))

# ── Main service ──────────────────────────────────────────────────────────────

class PublishService:

    # ── Public API ────────────────────────────────────────────────────────────

    async def publish(
        self,
        script_ids: List[uuid.UUID],
        release_id: Optional[uuid.UUID],
        client_db:  AsyncSession,
    ) -> PublishResult:
        """
        Fetch a ZIP archive from Recording Service and save to Client DB.
        release_id is assigned here at publish time.
        """
        scripts_data = await self._fetch_zip(script_ids)
        published = skipped = 0
        errors: List[str] = []

        for item in scripts_data:
            try:
                did = await self._save_one(item, release_id, client_db)
                if did:
                    published += 1
                else:
                    skipped += 1
            except Exception as exc:
                sid = item.get("script", {}).get("id", "?")
                log.error("Save failed", script_id=sid, error=str(exc))
                errors.append(f"{sid}: {exc}")

        return PublishResult(published=published, skipped=skipped, errors=errors)

    async def publish_bulk(
        self,
        release_id:  Optional[uuid.UUID],
        module_id:   Optional[uuid.UUID] = None,
        process_id:  Optional[uuid.UUID] = None,
        client_db:   AsyncSession = None,
    ) -> PublishResult:
        """
        Export ALL valid scripts for a given scope by calling Recording Service's
        bulk-export endpoint (uses query params for scoped filtering).
        """
        params: dict = {}
        if release_id: params["release_id"] = str(release_id)
        if module_id:  params["module_id"]  = str(module_id)
        if process_id: params["process_id"] = str(process_id)

        scripts_data = await self._fetch_zip_bulk(params)
        published = skipped = 0
        errors: List[str] = []

        for item in scripts_data:
            try:
                did = await self._save_one(item, release_id, client_db)
                if did:
                    published += 1
                else:
                    skipped += 1
            except Exception as exc:
                sid = item.get("script", {}).get("id", "?")
                log.error("Bulk save failed", script_id=sid, error=str(exc))
                errors.append(f"{sid}: {exc}")

        return PublishResult(published=published, skipped=skipped, errors=errors)

    # ── HTTP helpers ──────────────────────────────────────────────────────────

    async def _fetch_zip(self, script_ids: List[uuid.UUID]) -> list:
        """POST to Recording Service export-zip and unpack the ZIP."""
        url = f"{settings.RECORDING_SERVICE_URL}/api/v1/recording/export-zip"
        payload = {"script_ids": [str(s) for s in script_ids]}

        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(url, json=payload)
            if resp.status_code != 200:
                raise RuntimeError(
                    f"Recording Service export-zip returned {resp.status_code}: {resp.text[:200]}"
                )
            return self._unpack_zip(resp.content)

    async def _fetch_zip_bulk(self, params: dict) -> list:
        """GET Recording Service bulk-export endpoint (with query params)."""
        url = f"{settings.RECORDING_SERVICE_URL}/api/v1/recording/export-zip-bulk"
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.get(url, params=params)
            if resp.status_code != 200:
                raise RuntimeError(
                    f"Recording Service bulk export returned {resp.status_code}: {resp.text[:200]}"
                )
            return self._unpack_zip(resp.content)

    @staticmethod
    def _unpack_zip(content: bytes) -> list:
        buf = io.BytesIO(content)
        with zipfile.ZipFile(buf) as zf:
            return json.loads(zf.read("scripts.json"))

    # ── Save one script + its hierarchy to Client DB ──────────────────────────

    # async def _save_one(
    #     self,
    #     item:       dict,
    #     release_id: Optional[uuid.UUID],
    #     client_db:  AsyncSession,
    # ) -> bool:
    #     script_raw = item.get("script")
    #     if not script_raw:
    #         return False

    #     master_script_id = uuid.UUID(script_raw["id"])
    #     steps_raw        = item.get("steps", [])
    #     product_raw      = item.get("product")
    #     module_raw       = item.get("module")
    #     feature_raw      = item.get("feature")
    #     processes_raw    = item.get("processes", [])

    #     # ── Hierarchy (upsert via ON CONFLICT DO NOTHING) ─────────────────────
    #     # Order matters: products → releases → modules → features
    #     # (modules FK on release_id, features FK on module_id)

    #     if product_raw:
    #         await client_db.execute(
    #             pg_insert(t_products)
    #             .values(
    #                 id=uuid.uuid4(), master_id=uuid.UUID(product_raw["id"]),
    #                 name=product_raw["name"], abbreviation=product_raw["abbreviation"],
    #             )
    #             .on_conflict_do_nothing(index_elements=["master_id"])
    #         )

    #     if release_id:
    #         product_in_client = None
    #         if product_raw:
    #             product_in_client = (await client_db.execute(
    #                 sa.select(t_products.c.id).where(
    #                     t_products.c.master_id == uuid.UUID(product_raw["id"])
    #                 )
    #             )).scalar_one_or_none()
    #         await client_db.execute(
    #             pg_insert(t_releases)
    #             .values(
    #                 id=release_id, master_id=release_id,
    #                 product_id=product_in_client or uuid.uuid4(),
    #                 name=str(release_id),
    #             )
    #             .on_conflict_do_nothing(index_elements=["master_id"])
    #         )

    #     if module_raw:
    #         release_in_client = release_id
    #         module_release_master_id = module_raw.get("release_id")
    #         if not release_in_client and module_release_master_id:
    #             release_in_client = (await client_db.execute(
    #                 sa.select(t_releases.c.id).where(
    #                     t_releases.c.master_id == uuid.UUID(module_release_master_id)
    #                 )
    #             )).scalar_one_or_none()
    #         await client_db.execute(
    #             pg_insert(t_modules)
    #             .values(
    #                 id=uuid.uuid4(), master_id=uuid.UUID(module_raw["id"]),
    #                 release_id=release_in_client or uuid.uuid4(),
    #                 name=module_raw["name"], abbreviation=module_raw["abbreviation"],
    #             )
    #             .on_conflict_do_nothing(index_elements=["master_id"])
    #         )

    #     if feature_raw:
    #         module_in_client = (await client_db.execute(
    #             sa.select(t_modules.c.id).where(
    #                 t_modules.c.master_id == uuid.UUID(feature_raw["module_id"])
    #             )
    #         )).scalar_one_or_none()
    #         await client_db.execute(
    #             pg_insert(t_features)
    #             .values(
    #                 id=uuid.uuid4(), master_id=uuid.UUID(feature_raw["id"]),
    #                 module_id=module_in_client or uuid.uuid4(),
    #                 name=feature_raw["name"], abbreviation=feature_raw["abbreviation"],
    #             )
    #             .on_conflict_do_nothing(index_elements=["master_id"])
    #         )

    #     for proc in processes_raw:
    #         module_client_id_for_proc = None
    #         if proc.get("module_id"):
    #             module_client_id_for_proc = (await client_db.execute(
    #                 sa.select(t_modules.c.id).where(
    #                     t_modules.c.master_id == uuid.UUID(proc["module_id"])
    #                 )
    #             )).scalar_one_or_none()

    #         feature_client_id_for_proc = None
    #         if proc.get("feature_id"):
    #             feature_client_id_for_proc = (await client_db.execute(
    #                 sa.select(t_features.c.id).where(
    #                     t_features.c.master_id == uuid.UUID(proc["feature_id"])
    #                 )
    #             )).scalar_one_or_none()

    #         await client_db.execute(
    #             pg_insert(t_processes)
    #             .values(
    #                 id=uuid.uuid4(), master_id=uuid.UUID(proc["id"]),
    #                 module_id=module_client_id_for_proc or uuid.uuid4(),
    #                 feature_id=feature_client_id_for_proc,
    #                 name=proc["name"],
    #             )
    #             .on_conflict_do_nothing(index_elements=["master_id"])
    #         )

    #     # ── execution_scripts (upsert) ────────────────────────────────────────
    #     module_client_id = None
    #     if module_raw:
    #         module_client_id = (await client_db.execute(
    #             sa.select(t_modules.c.id).where(
    #                 t_modules.c.master_id == uuid.UUID(module_raw["id"])
    #             )
    #         )).scalar_one_or_none()

    #     feature_client_id = None
    #     if feature_raw:
    #         feature_client_id = (await client_db.execute(
    #             sa.select(t_features.c.id).where(
    #                 t_features.c.master_id == uuid.UUID(feature_raw["id"])
    #             )
    #         )).scalar_one_or_none()

    #     existing_script_id = (await client_db.execute(
    #         sa.select(t_scripts.c.id).where(
    #             t_scripts.c.master_script_id == master_script_id
    #         )
    #     )).scalar_one_or_none()

    #     exec_script_id = existing_script_id or uuid.uuid4()

    #     from datetime import datetime, timezone
    #     if existing_script_id:
    #         await client_db.execute(
    #             sa.update(t_scripts)
    #             .where(t_scripts.c.id == existing_script_id)
    #             .values(
    #                 release_id=release_id, module_id=module_client_id,
    #                 feature_id=feature_client_id,
    #                 case_number=script_raw["case_number"],
    #                 name=script_raw["name"], description=script_raw.get("description"),
    #                 role=script_raw.get("role"), script_type=script_raw.get("script_type", "standard"),
    #                 status=script_raw.get("status", "valid"),
    #                 labels=script_raw.get("labels", []),
    #                 published_at=datetime.now(timezone.utc),
    #             )
    #         )
    #     else:
    #         await client_db.execute(
    #             t_scripts.insert().values(
    #                 id=exec_script_id, master_script_id=master_script_id,
    #                 release_id=release_id, module_id=module_client_id,
    #                 feature_id=feature_client_id,
    #                 case_number=script_raw["case_number"],
    #                 name=script_raw["name"], description=script_raw.get("description"),
    #                 role=script_raw.get("role"),
    #                 script_type=script_raw.get("script_type", "standard"),
    #                 status=script_raw.get("status", "valid"),
    #                 labels=script_raw.get("labels", []),
    #                 published_at=datetime.now(timezone.utc),
    #             )
    #         )

    #     # ── execution_steps (delete-and-reinsert for republish) ───────────────
    #     await client_db.execute(
    #         sa.delete(t_steps).where(t_steps.c.execution_script_id == exec_script_id)
    #     )
    #     for step in steps_raw:
    #         selector = step.get("selector") or step.get("locator_code")
    #         value = step.get("value")
    #         if value is None:
    #             value = step.get("input_parameter")
    #         if value is None:
    #             value = step.get("default_value")

    #         await client_db.execute(
    #             t_steps.insert().values(
    #                 id=uuid.uuid4(),
    #                 execution_script_id=exec_script_id,
    #                 master_step_id=uuid.UUID(step["id"]),
    #                 step_order=step.get("step_order", step.get("step_no", 0)),
    #                 action_type=step.get("action_type", step.get("action", "Action")),
    #                 selector=selector,
    #                 value=value,
    #                 description=step.get("description", step.get("step_description", "")),
    #                 is_modified=bool(step.get("is_modified", False)),
    #                 is_added=bool(step.get("is_added", False)),
    #                 metadata={
    #                     "input_type": step.get("input_type"),
    #                     "wait_ms": step.get("wait_ms", 0),
    #                     "is_dropdown_open": bool(step.get("is_dropdown_open", False)),
    #                     "is_option_selection": bool(step.get("is_option_selection", False)),
    #                     "take_screenshot": bool(step.get("take_screenshot", True)),
    #                     "is_manual": bool(step.get("is_manual", False)),
    #                 },
    #             )
    #         )

    #     # ── Process associations ───────────────────────────────────────────────
    #     await client_db.execute(
    #         sa.delete(t_sp).where(t_sp.c.script_id == exec_script_id)
    #     )
    #     for proc in processes_raw:
    #         proc_client = (await client_db.execute(
    #             sa.select(t_processes.c.id).where(
    #                 t_processes.c.master_id == uuid.UUID(proc["id"])
    #             )
    #         )).scalar_one_or_none()
    #         if proc_client:
    #             await client_db.execute(
    #                 pg_insert(t_sp)
    #                 .values(script_id=exec_script_id, process_id=proc_client)
    #                 .on_conflict_do_nothing()
    #             )

    #     log.info("Script published", master_id=str(master_script_id), exec_id=str(exec_script_id))
    #     return True

    async def _save_one(
        self,
        item:       dict,
        release_id: Optional[uuid.UUID],
        client_db:  AsyncSession,
    ) -> bool:
        script_raw    = item.get("script")
        if not script_raw:
            return False

        master_script_id = uuid.UUID(script_raw["id"])
        steps_raw        = item.get("steps", [])
        product_raw      = item.get("product")
        module_raw       = item.get("module")
        feature_raw      = item.get("feature")
        processes_raw    = item.get("processes", [])
        now              = datetime.now(timezone.utc)

        # ── 1. imported_releases — insert first (modules FK to this) ─────────────
        if release_id:
            product_id = uuid.UUID(product_raw["id"]) if product_raw else uuid.uuid4()
            existing_release = (await client_db.execute(
                sa.select(t_releases.c.id).where(t_releases.c.master_id == release_id)
            )).scalar_one_or_none()

            if not existing_release:
                await client_db.execute(
                    pg_insert(t_releases).values(
                        id=release_id,
                        master_id=release_id,
                        product_id=product_id,
                        name=str(release_id),
                        imported_at=now,
                    ).on_conflict_do_nothing(index_elements=["master_id"])
                )

        # ── 2. imported_modules ───────────────────────────────────────────────────
        module_client_id = None
        if module_raw:
            module_master_id = uuid.UUID(module_raw["id"])
            existing_module = (await client_db.execute(
                sa.select(t_modules.c.id).where(t_modules.c.master_id == module_master_id)
            )).scalar_one_or_none()

            module_client_id = existing_module or uuid.uuid4()
            if not existing_module:
                await client_db.execute(
                    pg_insert(t_modules).values(
                        id=module_client_id,
                        master_id=module_master_id,
                        release_id=release_id,
                        name=module_raw["name"],
                        abbreviation=module_raw.get("abbreviation", ""),
                        imported_at=now,
                    ).on_conflict_do_nothing(index_elements=["master_id"])
                )

        # ── 3. imported_features ──────────────────────────────────────────────────
        feature_client_id = None
        if feature_raw:
            feature_master_id = uuid.UUID(feature_raw["id"])
            existing_feature = (await client_db.execute(
                sa.select(t_features.c.id).where(t_features.c.master_id == feature_master_id)
            )).scalar_one_or_none()

            feature_client_id = existing_feature or uuid.uuid4()
            if not existing_feature:
                await client_db.execute(
                    pg_insert(t_features).values(
                        id=feature_client_id,
                        master_id=feature_master_id,
                        module_id=module_client_id,
                        name=feature_raw["name"],
                        abbreviation=feature_raw.get("abbreviation", ""),
                        imported_at=now,
                    ).on_conflict_do_nothing(index_elements=["master_id"])
                )

        # ── 4. imported_processes ─────────────────────────────────────────────────
        for proc in processes_raw:
            proc_master_id = uuid.UUID(proc["id"])
            existing_proc = (await client_db.execute(
                sa.select(t_processes.c.id).where(t_processes.c.master_id == proc_master_id)
            )).scalar_one_or_none()

            if not existing_proc:
                await client_db.execute(
                    pg_insert(t_processes).values(
                        id=uuid.uuid4(),
                        master_id=proc_master_id,
                        module_id=module_client_id,
                        feature_id=feature_client_id,
                        name=proc["name"],
                        imported_at=now,
                    ).on_conflict_do_nothing(index_elements=["master_id"])
                )

        # ── 5. execution_scripts — upsert ─────────────────────────────────────────
        existing_script_id = (await client_db.execute(
            sa.select(t_scripts.c.id).where(
                t_scripts.c.master_script_id == master_script_id
            )
        )).scalar_one_or_none()

        exec_script_id = existing_script_id or uuid.uuid4()

        if existing_script_id:
            await client_db.execute(
                sa.update(t_scripts)
                .where(t_scripts.c.id == existing_script_id)
                .values(
                    release_id=release_id,
                    module_id=module_client_id,
                    feature_id=feature_client_id,
                    case_number=script_raw["case_number"],
                    name=script_raw["name"],
                    description=script_raw.get("description"),
                    role=script_raw.get("role"),
                    script_type=script_raw.get("script_type", "standard"),
                    status=script_raw.get("status", "valid"),
                    labels=script_raw.get("labels", []),
                    published_at=now,
                    updated_at=now,
                )
            )
        else:
            await client_db.execute(
                t_scripts.insert().values(
                    id=exec_script_id,
                    master_script_id=master_script_id,
                    release_id=release_id,
                    module_id=module_client_id,
                    feature_id=feature_client_id,
                    case_number=script_raw["case_number"],
                    name=script_raw["name"],
                    description=script_raw.get("description"),
                    role=script_raw.get("role"),
                    script_type=script_raw.get("script_type", "standard"),
                    status=script_raw.get("status", "valid"),
                    labels=script_raw.get("labels", []),
                    published_at=now,
                    updated_at=now,
                )
            )

        # ── 6. execution_steps — delete and reinsert ──────────────────────────────
        await client_db.execute(
            sa.delete(t_steps).where(t_steps.c.execution_script_id == exec_script_id)
        )
        for step in steps_raw:
            await client_db.execute(
                t_steps.insert().values(
                    id=uuid.uuid4(),
                    execution_script_id=exec_script_id,
                    master_step_id=uuid.UUID(step["id"]),
                    step_order=step.get("step_no", 0),
                    action_type=step.get("action", "Action"),
                    selector=step.get("locator_code") or step.get("input_parameter"),
                    value=step.get("default_value"),
                    description=step.get("step_description", ""),
                    is_modified=False,
                    is_added=False,
                    metadata={
                        "input_type":        step.get("input_type"),
                        "input_parameter":   step.get("input_parameter"),
                        "wait_ms":           step.get("wait_ms", 0),
                        "is_dropdown_open":  step.get("is_dropdown_open", False),
                        "is_option_selection": step.get("is_option_selection", False),
                        "take_screenshot":   step.get("take_screenshot", True),
                        "is_manual":         step.get("is_manual", False),
                    },
                    created_at=now,
                    updated_at=now,
                )
            )

        log.info("Script published", master_id=str(master_script_id), exec_id=str(exec_script_id))
        return True

publish_service = PublishService()