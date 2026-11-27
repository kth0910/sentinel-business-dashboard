# frontend/packages/shared/test/richtext.test.ts를 옮긴 테스트.
# 건너뛴 케이스(서버에 옮기지 않는 insertText·annotationsAt·addAnnotation·removeAnnotation·toggleAnnotation·hasAnnotation 사용):
#   - insert inherits annotations from the left run (typing at end of bold continues bold)
#   - typing after a link or code does not extend it
#   - add/remove/toggle annotations
#   - text and background colors are independent
# 바꿔 옮긴 케이스: normalize는 concat(하나만 넘기면 normalize와 같음)으로, splitAt은 slice_rt 두 번으로,
#   mention('p', id)는 같은 값의 리터럴 [["‣", [["p", id]]]]로 확인한다.
from app.records.richtext import (
    _u16_len,
    _u16_slice,
    annotations_of,
    concat,
    delete_range,
    insert_rich,
    length,
    slice_rt,
    to_plain_text,
)

RT = [["Hello "], ["bold", [["b"]]], [" world"]]


def test_plain_text_and_length():
    assert to_plain_text(RT) == "Hello bold world"
    assert length(RT) == 16


def test_normalize_merges_equal_runs_and_drops_empties():
    assert concat([["a"], ["b"], ["", [["b"]]], ["c", [["b"]]], ["d", [["b"]]]]) == [["ab"], ["cd", [["b"]]]]


def test_slice_keeps_annotations():
    assert slice_rt(RT, 4, 9) == [["o "], ["bol", [["b"]]]]


def test_split_at_offset():
    a, b = slice_rt(RT, 0, 8), slice_rt(RT, 8)
    assert to_plain_text(a) == "Hello bo"
    assert to_plain_text(b) == "ld world"
    assert b[0] == ["ld", [["b"]]]


def test_delete_range_across_runs():
    assert delete_range(RT, 3, 13) == [["Helrld"]]


def test_mentions_are_atoms_of_length_1_and_never_merge():
    v = concat([["see "]], [["‣", [["p", "abc"]]]], [["‣", [["p", "def"]]]])
    assert length(v) == 6
    assert len(v) == 3


def test_annotations_of_defaults_to_empty():
    assert annotations_of(["x"]) == []
    assert annotations_of(["x", [["b"]]]) == [["b"]]


def test_insert_rich_at_offset():
    assert insert_rich(RT, 6, [["very ", [["i"]]]]) == [["Hello "], ["very ", [["i"]]], ["bold", [["b"]]], [" world"]]


def test_lengths_and_slices_count_utf16_units():
    # 이모지는 BMP 밖 글자라 UTF-16으로 2단위다(브라우저의 String.length와 같음).
    assert _u16_len("😀a") == 3
    assert length([["😀a"], ["b"]]) == 4
    assert _u16_slice("😀abc", 2, 4) == "ab"
    # 서로게이트 쌍 가운데를 잘라도 원본(JS)처럼 그대로 자른다.
    assert _u16_slice("😀a", 0, 1) == "\ud83d"
    assert slice_rt([["x😀y"]], 1, 3) == [["😀"]]


def test_split_surrogate_halves_rejoin_into_one_character():
    # 이모지 가운데에서 잘랐다가 다시 붙이면 Python에서도 원래 글자 하나("😀")가 되어야 한다.
    assert insert_rich([["ac 😀"]], 4, [[""]]) == [["ac 😀"]]
    assert delete_range([["a😀b"]], 2, 2) == [["a😀b"]]
    assert to_plain_text([["a\ud83d"], ["\ude00", [["b"]]]]) == "a😀"
