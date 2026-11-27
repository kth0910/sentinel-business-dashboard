"""노션 레코드 저장소: records(종류별 JSONB 레코드), changes(변경 로그), applied_tx(처리한 트랜잭션)."""
import uuid
from time import time

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    Index,
    String,
    Table,
    func,
    select,
)
from sqlalchemy.dialects.postgresql import JSONB, insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import Base

# 원본 packages/shared/src/records.ts의 TABLES와 같은 16개 레코드 종류.
TABLES: tuple[str, ...] = (
    "block", "space", "space_view", "team", "lit_user", "user_root", "user_settings",
    "collection", "collection_view", "discussion", "comment", "notification",
    "page_visit", "follow", "automation", "workflow",
)

records = Table(
    "records",
    Base.metadata,
    Column("tbl", String, primary_key=True),
    Column("id", String, primary_key=True),
    Column("version", BigInteger, nullable=False),
    Column("space_id", String, nullable=True),
    Column("parent_id", String, nullable=True),
    Column("parent_table", String, nullable=True),
    Column("alive", Boolean, nullable=True),
    Column("last_edited_time", BigInteger, nullable=True),
    Column("data", JSONB, nullable=False),
    Index("ix_records_tbl_parent_id", "tbl", "parent_id"),
    Index("ix_records_tbl_space_id_last_edited_time", "tbl", "space_id", "last_edited_time"),
)

changes = Table(
    "changes",
    Base.metadata,
    Column("lsn", BigInteger, primary_key=True, autoincrement=True),
    Column("tbl", String),
    Column("id", String),
    Column("space_id", String, nullable=True),
    Column("version", BigInteger),
    Column("time", BigInteger),
    Index("ix_changes_space_id_lsn", "space_id", "lsn"),
)

applied_tx = Table(
    "applied_tx",
    Base.metadata,
    Column("id", String, primary_key=True),
    Column("at", BigInteger, nullable=False),
)


def new_id() -> str:
    return str(uuid.uuid4())


def now_ms() -> int:
    return int(time() * 1000)


async def get_record(db: AsyncSession, table: str, id: str) -> dict | None:
    res = await db.execute(select(records.c.data).where(records.c.tbl == table, records.c.id == id))
    return res.scalar_one_or_none()


async def get_records(db: AsyncSession, table: str, ids: list[str]) -> dict[str, dict]:
    """ID로 여러 레코드를 한 번에 읽는다. 없는 ID는 결과에 없다."""
    if not ids:
        return {}
    res = await db.execute(
        select(records.c.id, records.c.data).where(records.c.tbl == table, records.c.id.in_(ids))
    )
    return {row.id: row.data for row in res}


async def put_record(db: AsyncSession, table: str, rec: dict) -> None:
    """레코드를 upsert하고 changes에 한 줄 남긴다. version은 호출하는 쪽이 정하고, 커밋하지 않는다."""
    values = {
        "tbl": table,
        "id": rec["id"],
        "version": rec["version"],
        "space_id": rec.get("space_id"),
        "parent_id": rec.get("parent_id"),
        "parent_table": rec.get("parent_table"),
        "alive": rec.get("alive"),
        "last_edited_time": rec.get("last_edited_time"),
        "data": rec,
    }
    stmt = insert(records).values(**values)
    stmt = stmt.on_conflict_do_update(
        index_elements=[records.c.tbl, records.c.id],
        set_={k: v for k, v in values.items() if k not in ("tbl", "id")},
    )
    await db.execute(stmt)
    await db.execute(
        insert(changes).values(
            tbl=table, id=rec["id"], space_id=rec.get("space_id"), version=rec["version"], time=now_ms()
        )
    )


async def children_of(db: AsyncSession, table: str, parent_id: str) -> list[dict]:
    res = await db.execute(select(records.c.data).where(records.c.tbl == table, records.c.parent_id == parent_id))
    return list(res.scalars())


async def records_in_space(db: AsyncSession, table: str, space_id: str) -> list[dict]:
    res = await db.execute(select(records.c.data).where(records.c.tbl == table, records.c.space_id == space_id))
    return list(res.scalars())


async def current_lsn(db: AsyncSession) -> int:
    res = await db.execute(select(func.max(changes.c.lsn)))
    return res.scalar_one() or 0
