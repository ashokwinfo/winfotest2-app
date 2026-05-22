"""Case Number Service - generates MODULE_ABBR-FEATURE_ABBR-SEQ (no release dependency)."""
from __future__ import annotations
import uuid
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.database import CaseNumberSequence, Module, Feature


class CaseNumberService:
    """
    Format: {MODULE_ABBR}-{FEATURE_ABBR}-{SEQ:04d}  or  {MODULE_ABBR}-{SEQ:04d}
    Sequence is per module+feature combination (no release dependency).
    """

    async def generate(
        self,
        db: AsyncSession,
        module_id: uuid.UUID,
        feature_id: Optional[uuid.UUID] = None,
    ) -> str:
        mod = await db.get(Module, module_id)
        mod_abbr = (mod.abbreviation if mod else "MOD").upper()

        feat_abbr = ""
        if feature_id:
            feat = await db.get(Feature, feature_id)
            feat_abbr = (feat.abbreviation if feat else "").upper()

        result = await db.execute(
            select(CaseNumberSequence).where(
                CaseNumberSequence.module_id  == module_id,
                CaseNumberSequence.feature_id == feature_id,
            ).with_for_update()
        )
        seq_row = result.scalar_one_or_none()

        if seq_row is None:
            seq_row = CaseNumberSequence(
                module_id=module_id,
                feature_id=feature_id,
                next_seq=1,
            )
            db.add(seq_row)
            await db.flush()

        current_seq = seq_row.next_seq
        seq_row.next_seq = current_seq + 1
        await db.flush()

        if feat_abbr:
            return f"{mod_abbr}-{feat_abbr}-{current_seq:04d}"
        return f"{mod_abbr}-{current_seq:04d}"


case_number_service = CaseNumberService()
