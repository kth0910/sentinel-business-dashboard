"""레코드 연산: 원본 frontend/packages/shared/src/ops.ts의 applyOperation을 옮긴 것.

연산 모양은 원본 applyChanges와 같다: {"pointer": {"table", "id", "spaceId"}, "path": [...], "command", "args"}.
JS의 `undefined`는 "키가 없음"으로 본다(JSON으로 오면 키가 빠진다). 다만 클라이언트(transactions.ts의
wireTransaction)는 `update`에서 지우려는 키(undefined)를 null로 보내므로, `update`의 None 값은 키를 지운다.
"""
import copy
from typing import Any

from app.records.textmerge import apply_splice

COMMANDS = frozenset({"set", "update", "listAfter", "listBefore", "listRemove", "spliceText"})

# 경로나 update 키로 쓰이면 Object.prototype을 건드리는 키(원본의 프로토타입 오염 방지). 서버에서도 똑같이 거절한다.
UNSAFE_KEYS = frozenset({"__proto__", "constructor", "prototype"})

_MISSING = object()  # JS undefined(키 없음)


class OperationError(ValueError):
    """적용할 수 없는 연산(위험한 키, 알 수 없는 명령, 잘못된 모양)."""


def _clone(v):
    return copy.deepcopy(v)


def _safe_key(k) -> str:
    if not isinstance(k, str) or k in UNSAFE_KEYS:
        raise OperationError(f"Invalid operation key {k}")
    return k


def get_at_path(obj, path: list[str]):
    cur = obj
    for p in path:
        if cur is None:
            return None
        if isinstance(cur, dict):
            cur = cur.get(p)
        elif isinstance(cur, list) and isinstance(p, str) and p.isdigit() and int(p) < len(cur):
            cur = cur[int(p)]  # JS의 arr["1"]
        else:
            return None
    return cur


def _ensure_path(obj: dict, path: list[str]) -> dict:
    cur = obj
    for p in path:
        _safe_key(p)
        if not isinstance(cur, dict):
            # 원본은 배열 안에도 키를 만들지만, 배열을 객체처럼 다루는 경로는 레코드에서 쓰지 않으므로 거절한다.
            raise OperationError(f"Invalid operation path {path}")
        if not isinstance(cur.get(p), (dict, list)):
            cur[p] = {}
        cur = cur[p]
    if not isinstance(cur, dict):
        raise OperationError(f"Invalid operation path {path}")
    return cur


def _set_at_path(obj: dict, path: list[str], value):
    if not path:
        return None if value is _MISSING else _clone(value)
    parent = _ensure_path(obj, path[:-1])
    last = _safe_key(path[-1])
    if value is _MISSING:
        parent.pop(last, None)
    else:
        parent[last] = _clone(value)
    return obj


def apply_operation(record: dict | None, op: dict) -> dict | None:
    """연산 하나를 레코드 값에 적용해 새 객체를 돌려준다(입력은 바꾸지 않음).
    `record`는 path []의 `set`(레코드 생성)이면 None일 수 있다."""
    pointer_id = op["pointer"]["id"]
    path: list[str] = op.get("path") or []
    command = op.get("command")
    args: Any = op.get("args", _MISSING)
    base: dict = _clone(record) if record is not None else {"id": pointer_id}

    if command == "set":
        if not path:
            nxt = {} if args is _MISSING or args is None else _clone(args)
            if not isinstance(nxt, dict):
                raise OperationError("set at the record root expects an object")
            nxt["id"] = pointer_id
            if "version" in base and "version" not in nxt:
                nxt["version"] = base["version"]
            return nxt
        return _set_at_path(base, path, args)

    if command == "update":
        target = _ensure_path(base, path) if path else base
        items = {} if args is _MISSING or args is None else args
        if not isinstance(items, dict):
            raise OperationError("update expects an object")
        for k, v in items.items():
            _safe_key(k)
            if v is None:
                target.pop(k, None)
            else:
                target[k] = _clone(v)
        return base

    if command in ("listAfter", "listBefore", "listRemove"):
        if not path:
            raise OperationError("list operations need a path")
        if not isinstance(args, dict):
            raise OperationError("Invalid list arguments")
        parent = _ensure_path(base, path[:-1]) if len(path) > 1 else base
        key = _safe_key(path[-1])
        arr = list(parent[key]) if isinstance(parent.get(key), list) else []
        id_ = args.get("id")
        if id_ in arr:
            arr.remove(id_)
        if command != "listRemove":
            if command == "listAfter":
                after = args.get("after")
                if after and after in arr:
                    arr.insert(arr.index(after) + 1, id_)
                else:
                    arr.append(id_)
            else:
                before = args.get("before")
                if before and before in arr:
                    arr.insert(arr.index(before), id_)
                else:
                    arr.insert(0, id_)
        parent[key] = arr
        return base

    if command == "spliceText":
        if not path or not isinstance(args, dict):
            raise OperationError("Invalid splice")
        current = get_at_path(base, path)
        if current is not None and not isinstance(current, list):
            # 원본은 리치 텍스트가 아닌 값에서 TypeError로 멈춘다. 서버에서는 연산 오류로 거절한다.
            raise OperationError("spliceText expects rich text")
        nxt = apply_splice(current, args)
        return _set_at_path(base, path, nxt)

    raise OperationError(f"Unknown command {command}")
