import subprocess
import sys

from sqlalchemy import create_engine, inspect, select

from app.config import get_settings
from app.records.store import (
    changes,
    children_of,
    current_lsn,
    get_record,
    get_records,
    put_record,
    records_in_space,
)


def _block(id: str, **extra) -> dict:
    return {
        "id": id,
        "version": 1,
        "type": "text",
        "space_id": "s1",
        "parent_id": "p1",
        "parent_table": "block",
        "alive": True,
        **extra,
    }


async def test_put_and_get_round_trip(db):
    rec = _block("b1", properties={"title": [["안녕 😀"]]})
    await put_record(db, "block", rec)
    assert await get_record(db, "block", "b1") == rec
    assert await get_record(db, "block", "없음") is None


async def test_put_record_appends_change(db):
    assert await current_lsn(db) == 0
    await put_record(db, "block", _block("b1"))
    await put_record(db, "block", _block("b1", version=2))
    assert await current_lsn(db) == 2
    assert (await get_record(db, "block", "b1"))["version"] == 2


async def test_children_and_space_queries(db):
    await put_record(db, "block", _block("b1"))
    await put_record(db, "block", _block("b2", parent_id="p2", space_id="s2"))
    await put_record(db, "space", {"id": "b1", "version": 1, "space_id": "s1"})
    assert [r["id"] for r in await children_of(db, "block", "p1")] == ["b1"]
    assert [r["id"] for r in await records_in_space(db, "block", "s2")] == ["b2"]
    assert [r["id"] for r in await records_in_space(db, "block", "s1")] == ["b1"]


async def test_space_record_belongs_to_itself(db):
    # 원본 putRecord처럼 space 레코드의 space_id는 자기 id다(변경 로그로 공간 이름 변경 등을 찾을 수 있게)
    await put_record(db, "space", {"id": "s9", "version": 1, "name": "영업팀"})
    assert [r["id"] for r in await records_in_space(db, "space", "s9")] == ["s9"]
    row = (await db.execute(select(changes.c.space_id).where(changes.c.id == "s9"))).scalar_one()
    assert row == "s9"


async def test_get_records_skips_missing(db):
    await put_record(db, "block", _block("b1"))
    got = await get_records(db, "block", ["b1", "nope"])
    assert list(got) == ["b1"]
    assert await get_records(db, "block", []) == {}


def test_migration_creates_record_tables(test_database_url_env):
    r = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        env=test_database_url_env, capture_output=True, text=True,
    )
    assert r.returncode == 0, r.stderr
    engine = create_engine(get_settings().test_database_url)
    try:
        names = set(inspect(engine).get_table_names())
    finally:
        engine.dispose()
    assert {"records", "changes", "applied_tx"} <= names
