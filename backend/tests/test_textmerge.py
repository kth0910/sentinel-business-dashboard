# frontend/packages/shared/test/textmerge.test.ts를 옮긴 테스트.
# 건너뛴 케이스(서버에 옮기지 않는 diffSplice·invertSplice·invertOperation이 검사 대상):
#   - diffSplice finds the minimal single splice (chars and annotations)
#   - inverse splice undoes even after a concurrent edit
#   - works as a record operation with invert 의 되돌리기(invertOperation) 부분 (앞부분인 적용 결과만 옮김)
# 나머지 케이스는 원본이 diffSplice로 만들던 splice를 원본 diffSplice가 실제로 내는 값(Node로 계산) 그대로
# 리터럴로 적어 같은 입력·같은 기대값을 확인한다.
import re

from app.records.ops import apply_operation
from app.records.richtext import to_plain_text
from app.records.textmerge import apply_splice, map_text_offset, splice_range


def text(s):
    return [[s]] if s else []


def plain(rt):
    return to_plain_text(rt)


# diffSplice(text("Hello world"), text("Hello big world"))
BIG = {"base": "Hello world", "start": 6, "end": 6, "insert": [["big "]]}


def test_applies_directly_when_the_text_is_unchanged():
    assert plain(apply_splice(text("Hello world"), BIG)) == "Hello big world"


def test_keeps_a_concurrent_edit_elsewhere_in_the_block():
    assert plain(apply_splice(text("Hello world!"), BIG)) == "Hello big world!"
    assert plain(apply_splice(text("Oh, Hello world"), BIG)) == "Oh, Hello big world"


def test_two_users_typing_at_different_places_both_survive_in_either_order():
    base = text("The quick fox")
    a = {"base": "The quick fox", "start": 10, "end": 10, "insert": [["brown "]]}
    b = {"base": "The quick fox", "start": 4, "end": 4, "insert": [["very "]]}
    ab = apply_splice(apply_splice(base, a), b)
    ba = apply_splice(apply_splice(base, b), a)
    assert plain(ab) == "The very quick brown fox"
    assert plain(ba) == "The very quick brown fox"


def test_typing_at_the_same_point_keeps_both_insertions():
    base = text("ab")
    a = {"base": "ab", "start": 1, "end": 1, "insert": [["X"]]}
    b = {"base": "ab", "start": 1, "end": 1, "insert": [["Y"]]}
    merged = plain(apply_splice(apply_splice(base, a), b))
    assert len(merged) == 4
    assert re.fullmatch(r"a(XY|YX)b", merged)


def test_a_deletion_does_not_remove_text_another_user_inserted_inside_the_deleted_range():
    base = text("one two three")
    delete = {"base": "one two three", "start": 5, "end": 9, "insert": []}  # "two " 삭제
    theirs = apply_splice(base, {"base": "one two three", "start": 7, "end": 7, "insert": [["NEW"]]})
    merged = plain(apply_splice(theirs, delete))
    # 삭제한 base 글자는 사라지고, 그사이 다른 사람이 넣은 글자는 남는다.
    assert "NEW" in merged
    assert len(merged) == len("one three") + len("NEW")


def test_works_as_a_record_operation():
    rec = {"id": "b1", "version": 3, "properties": {"title": [["Hi there"]]}}
    pointer = {"table": "block", "id": "b1", "spaceId": "s"}
    splice = {"base": "Hi there", "start": 0, "end": 3, "insert": [["Hi ", [["b"]]]]}
    o = {"pointer": pointer, "path": ["properties", "title"], "command": "spliceText", "args": splice}
    nxt = apply_operation(rec, o)
    assert nxt["properties"]["title"] == [["Hi ", [["b"]]], ["there"]]
    assert rec["properties"]["title"] == [["Hi there"]]  # 입력은 그대로


def test_handles_atoms_mentions_as_single_characters():
    sp = {"base": "See ‣ now", "start": 6, "end": 6, "insert": [["right "]]}
    out = apply_splice([["Please see "], ["‣", [["p", "page1"]]], [" now"]], sp)
    assert out == [["Please see "], ["‣", [["p", "page1"]]], [" right now"]]


# --- 이 저장소에서 추가한 케이스 (기대값은 원본 TS를 Node로 돌려 확인한 값) ---


def test_splice_counts_utf16_units():
    assert apply_splice([["😀abc"]], {"base": "😀abc", "start": 3, "end": 3, "insert": [["X"]]}) == [["😀aXbc"]]


def test_concurrent_inserts_both_survive():
    # base "Hello"를 보고 맨 앞에 ">"를 넣었는데, 그사이 다른 사람이 " world"를 붙였다.
    out = apply_splice([["Hello world"]], {"base": "Hello", "start": 0, "end": 0, "insert": [[">"]]})
    assert out == [[">Hello world"]]


def test_concurrent_edit_maps_offsets_in_utf16_units():
    out = apply_splice([["😀 hi 😀"]], {"base": "😀 hi", "start": 3, "end": 5, "insert": [["yo"]]})
    assert out == [["😀 yo 😀"]]
    assert splice_range([["ab😀cd"]], {"base": "abcd", "start": 1, "end": 3, "insert": []}) == (1, 5)


def test_map_text_offset():
    assert map_text_offset("same", "same", 2) == 2
    assert map_text_offset("Hello world", "Oh, Hello world", 6) == 10
    # 동시에 바뀐 구간 안의 위치: 시작 쪽은 바뀐 글자 뒤로, 끝 쪽은 앞으로 붙는다.
    assert map_text_offset("abcdef", "abXYef", 3, "start") == 4
    assert map_text_offset("abcdef", "abXYef", 3, "end") == 2
