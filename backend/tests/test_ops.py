# frontend/packages/shared/test/ops.test.ts를 옮긴 테스트.
# 건너뛴 케이스(서버에 옮기지 않는 invertOperation 사용):
#   - inverse operations restore the previous state
#   - inverse of creation marks the record dead
import pytest

from app.records.ops import COMMANDS, OperationError, apply_operation, get_at_path

PTR = {"table": "block", "id": "b1"}


def op(command, path, args):
    return {"pointer": PTR, "path": path, "command": command, "args": args}


def list_after(path, id_, after=None):
    return op("listAfter", path, {"id": id_, "after": after} if after else {"id": id_})


def list_before(path, id_, before=None):
    return op("listBefore", path, {"id": id_, "before": before} if before else {"id": id_})


def test_set_at_root_creates_a_record():
    r = apply_operation(None, op("set", [], {"type": "text", "alive": True}))
    assert r == {"id": "b1", "type": "text", "alive": True}


def test_set_at_path_and_update_merge():
    r = {"id": "b1", "version": 1, "properties": {"title": [["a"]]}}
    r = apply_operation(r, op("set", ["properties", "title"], [["b"]]))
    r = apply_operation(r, op("update", ["format"], {"page_icon": "🔥"}))
    assert r["properties"]["title"] == [["b"]]
    assert r["format"] == {"page_icon": "🔥"}


def test_list_ops_are_idempotent_and_position_aware_litpage_semantics():
    r = {"id": "p", "version": 1, "content": ["a", "b"]}
    r = apply_operation(r, list_after(["content"], "c", "a"))
    assert r["content"] == ["a", "c", "b"]
    r = apply_operation(r, list_after(["content"], "c", "a"))
    assert r["content"] == ["a", "c", "b"]
    r = apply_operation(r, list_before(["content"], "b"))
    assert r["content"] == ["b", "a", "c"]
    r = apply_operation(r, op("listRemove", ["content"], {"id": "a"}))
    assert r["content"] == ["b", "c"]
    r = apply_operation(r, list_after(["content"], "z"))
    assert r["content"] == ["b", "c", "z"]


# --- 이 저장소에서 추가한 케이스 ---


def test_apply_operation_rejects_proto_key():
    with pytest.raises(OperationError):
        apply_operation(
            {"id": "x"},
            {"pointer": {"table": "block", "id": "x"}, "path": ["__proto__"], "command": "set", "args": 1},
        )


def test_set_root_keeps_version():
    r = apply_operation({"id": "x", "version": 3}, {"pointer": {"table": "block", "id": "x"}, "path": [], "command": "set", "args": {"type": "text"}})
    assert r == {"type": "text", "id": "x", "version": 3}


def test_rejects_unsafe_update_keys_and_unknown_commands():
    with pytest.raises(OperationError):
        apply_operation({"id": "b1"}, op("update", [], {"constructor": 1}))
    with pytest.raises(OperationError):
        apply_operation({"id": "b1"}, op("update", ["prototype"], {"a": 1}))
    with pytest.raises(OperationError):
        apply_operation({"id": "b1"}, op("rename", [], {}))
    assert COMMANDS == {"set", "update", "listAfter", "listBefore", "listRemove", "spliceText"}


def test_input_is_not_mutated():
    rec = {"id": "b1", "version": 1, "format": {"a": 1}, "content": ["k"]}
    args = {"b": {"deep": [1]}}
    out = apply_operation(rec, op("update", ["format"], args))
    out = apply_operation(out, list_after(["content"], "m"))
    assert rec == {"id": "b1", "version": 1, "format": {"a": 1}, "content": ["k"]}
    out["format"]["b"]["deep"].append(2)
    assert args == {"b": {"deep": [1]}}


def test_update_none_value_deletes_key():
    # 클라이언트(transactions.ts wireTransaction)는 update에서 undefined(키 지우기)를 null로 보낸다.
    out = apply_operation({"id": "b1", "format": {"block_color": "red", "a": 1}}, op("update", ["format"], {"block_color": None}))
    assert out["format"] == {"a": 1}


def test_set_path_without_args_deletes_and_with_none_stores_null():
    rec = {"id": "b1", "format": {"a": 1, "b": 2}}
    # args 키가 없음 = 원본의 undefined → 지운다.
    out = apply_operation(rec, {"pointer": PTR, "path": ["format", "a"], "command": "set"})
    assert out["format"] == {"b": 2}
    out = apply_operation(rec, op("set", ["format", "a"], None))
    assert out["format"] == {"a": None, "b": 2}


def test_set_path_creates_missing_parents():
    out = apply_operation({"id": "b1", "format": "oops"}, op("set", ["format", "x", "y"], 1))
    assert out["format"] == {"x": {"y": 1}}


def test_splice_text_on_missing_property():
    sp = {"base": "", "start": 0, "end": 0, "insert": [["hi"]]}
    out = apply_operation({"id": "b1"}, op("spliceText", ["properties", "title"], sp))
    assert out["properties"]["title"] == [["hi"]]


def test_get_at_path():
    rec = {"a": {"b": [10, 20]}}
    assert get_at_path(rec, ["a", "b"]) == [10, 20]
    assert get_at_path(rec, ["a", "b", "1"]) == 20
    assert get_at_path(rec, ["a", "x", "y"]) is None
    assert get_at_path(None, ["a"]) is None
    assert get_at_path(rec, []) == rec
