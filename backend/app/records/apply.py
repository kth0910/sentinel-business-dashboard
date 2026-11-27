"""클라이언트 편집 트랜잭션 적용: 원본 litpage-ref/apps/server/src/records.ts의 applyTransactions를 옮긴 것.

한 호출의 모든 연산을 하나의 DB 트랜잭션 안에서 적용한다. 전역 쓰기 잠금(pg_advisory_xact_lock)을 먼저 잡고
(원본 SQLite의 BEGIN IMMEDIATE와 같은 효과), 연산마다 권한을 검사한 뒤(guard.TxGuard) 끝에 한꺼번에 저장한다.
하나라도 거절되면 롤백해 아무것도 남지 않는다.

옮기지 않은 것: 검색 색인·스냅샷·활동 기록, 저장 직전 훅(onBeforePersist), 서버가 만드는 쓰기(client=False).
"""
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from sqlalchemy import delete, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.records.guard import TxGuard, bad_string, record_shape_problem, strip_server_owned, validate_op
from app.records.ops import apply_operation
from app.records.permissions import Lookup
from app.records.store import applied_tx, get_record, now_ms, put_record

logger = logging.getLogger(__name__)

# 전역 쓰기 잠금 번호(applyChanges끼리 한 번에 하나씩)
WRITE_LOCK_KEY = 7262001
MAX_TX_ID = 100
APPLIED_TX_TTL_MS = 2 * 86400_000
PRUNE_EVERY_MS = 3600_000
# space_id를 붙이지 않는 레코드(공간에 속하지 않음)
_NO_SPACE = ("space", "lit_user", "user_root", "user_settings")


@dataclass
class Change:
    table: str
    record: dict
    space_id: str | None


class TransactionError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


CommitHook = Callable[[list[Change], str | None], Awaitable[None]]
_commit_hooks: list[CommitHook] = []
_last_prune = 0


def on_commit(fn: CommitHook) -> None:
    """커밋에 성공한 applyChanges마다 (바뀐 레코드들, 보낸 클라이언트 ID)로 부를 함수를 등록한다(실시간 방송 등).
    훅이 실패해도 기록만 하고 쓰기를 되돌리거나 요청을 실패시키지 않는다."""
    _commit_hooks.append(fn)


def _validate(transactions: Any) -> None:
    """레코드를 건드리기 전에 모양부터 검사한다(위험한 경로, 모르는 테이블·명령 …)."""
    if not isinstance(transactions, list):
        raise TransactionError("Invalid transactions")
    for t in transactions:
        if not isinstance(t, dict) or not isinstance(t.get("operations"), list):
            raise TransactionError("Invalid transaction")
        if "id" in t and (not isinstance(t["id"], str) or len(t["id"]) > MAX_TX_ID or bad_string(t["id"])):
            raise TransactionError("Invalid transaction id")
        for op in t["operations"]:
            problem = validate_op(op)
            if problem:
                raise TransactionError(problem)
            strip_server_owned(op)


async def _tx_seen(db: AsyncSession, tx_id: str) -> bool:
    return (await db.execute(select(applied_tx.c.id).where(applied_tx.c.id == tx_id))).first() is not None


async def _apply_locked(db: AsyncSession, user_id: str, transactions: list[dict]) -> tuple[list[Change], list[Change]]:
    """잠금을 잡은 트랜잭션 안에서 적용한다. (저장한 변경, 이미 적용돼 현재 값만 돌려줄 레코드)."""
    global _last_prune
    lookup = Lookup(db)
    changed: dict[str, Change] = {}
    tx_ids_by_key: dict[str, list[str]] = {}
    replayed: dict[str, Change] = {}  # 이미 적용된(재시도한) 트랜잭션이 가리키는 레코드
    guard = TxGuard(lookup, user_id, changed)

    for t in transactions:
        tx_id = t.get("id") or None
        if tx_id and await _tx_seen(db, tx_id):
            # 같은 요청의 재시도: 클라이언트가 대기 중인 연산을 정리하도록 현재 값을 알려 준다
            for op in t["operations"]:
                table, rid = op["pointer"]["table"], op["pointer"]["id"]
                rec = await get_record(db, table, rid)
                if rec:
                    replayed[f"{table}:{rid}"] = Change(table, rec, rec.get("space_id"))
            continue
        for op in t["operations"]:
            table, rid = op["pointer"]["table"], op["pointer"]["id"]
            key = f"{table}:{rid}"
            if tx_id:
                tx_ids_by_key[key] = [*(x for x in tx_ids_by_key.get(key, []) if x != tx_id), tx_id]
            before = changed[key].record if key in changed else await lookup.get(table, rid)
            try:
                after = apply_operation(before, op)
            except (ValueError, TypeError, KeyError, IndexError, AttributeError) as e:
                # 연산 오류(OperationError는 ValueError)나 저장된 값이 잘못된 모양이라 적용할 수 없는 연산
                raise TransactionError(f"Cannot apply {op['command']} on {key}: {e!r}") from None
            if after is None:
                continue
            denied = await guard.check_op(op, before, after)
            if denied:
                raise TransactionError(f"Permission denied for {op['command']} on {key}: {denied}", 403)
            space_id = after.get("space_id")
            if space_id is None:
                space_id = after["id"] if table == "space" else op["pointer"].get("spaceId")
            if table not in _NO_SPACE and space_id and after.get("space_id") is None:
                after["space_id"] = space_id
            changed[key] = Change(table, after, space_id)
            # 이후 권한 계산(부모 따라가기 등)이 호출 안의 값을 보게 한다
            lookup.override(table, after)

    denied = await guard.finalize()
    if denied:
        raise TransactionError(f"Permission denied: {denied}", 403)
    for key, ch in changed.items():
        problem = record_shape_problem(ch.table, ch.record)
        if problem:
            raise TransactionError(f"Cannot store {key}: {problem}")

    now = now_ms()
    for t in transactions:
        if t.get("id"):
            await db.execute(insert(applied_tx).values(id=t["id"], at=now).on_conflict_do_nothing())
    if now - _last_prune > PRUNE_EVERY_MS:
        _last_prune = now
        await db.execute(delete(applied_tx).where(applied_tx.c.at < now - APPLIED_TX_TTL_MS))
    for key, ch in changed.items():
        prev = await get_record(db, ch.table, ch.record["id"]) or {}
        ch.record["version"] = (prev.get("version") or 0) + 1
        # 서버 관리: 이 레코드에 마지막으로 적용된 트랜잭션들(클라이언트가 같은 대기 연산을 지운다)
        prev_ids = [x for x in prev.get("applied_tx_ids") or [] if isinstance(x, str)]
        ch.record["applied_tx_ids"] = [*prev_ids, *tx_ids_by_key.get(key, [])][-8:]
        await put_record(db, ch.table, ch.record)
    return list(changed.values()), [ch for key, ch in replayed.items() if key not in changed]


async def apply_transactions(
    db: AsyncSession, user_id: str, transactions: list[dict], origin_client_id: str | None,
) -> list[Change]:
    """클라이언트 트랜잭션을 원자적으로 적용하고 커밋한다. 거절되면 TransactionError(400 또는 403)."""
    _validate(transactions)
    try:
        await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": WRITE_LOCK_KEY})
        out, replayed = await _apply_locked(db, user_id, transactions)
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    for fn in _commit_hooks:
        try:
            await fn(out, origin_client_id)
        except Exception:
            logger.exception("applyChanges 커밋 뒤 훅이 실패했습니다")
    return [*out, *replayed]
