"""동시 편집에 안전한 텍스트 수정: 원본 frontend/packages/shared/src/textmerge.ts를 옮긴 것.

splice는 작성자가 본 평문(`base`)의 [start, end)를 `insert`로 바꾼다. 저장된 글이 그사이 바뀌었으면(다른 사람이
같은 블록에 입력) 글자 diff로 범위를 `base`에서 현재 글로 옮겨, 서로 다른 곳의 동시 수정이 둘 다 남게 한다.
위치는 모두 UTF-16 코드 단위다(diff도 코드 단위로 비교한다).
"""
from typing import Literal, TypedDict

from app.records.richtext import (
    _u16_len,
    _u16_slice,
    concat,
    delete_range,
    insert_rich,
    slice_rt,
    to_plain_text,
)

# 원본 myers()의 최대 편집 거리. 넘으면 "일치 없음"으로 처리한다.
_MAX_D = 2000

Segment = tuple[int, int, int]  # (from 시작, to 시작, 길이)


class TextSplice(TypedDict):
    base: str
    start: int
    end: int
    insert: list


def _units(s: str) -> list[str]:
    """문자열을 UTF-16 코드 단위 목록으로(BMP 밖 글자는 서로게이트 두 개). 원본이 s[i]로 비교하는 것과 같다."""
    out: list[str] = []
    for ch in s:
        n = _u16_len(ch)
        out.extend(_u16_slice(ch, i, i + 1) for i in range(n))
    return out


def _matches(src: str, dst: str) -> list[Segment]:
    """두 문자열 사이의 일치 구간들(앞뒤 공통 부분을 떼고 나머지는 Myers)."""
    a_all, b_all = _units(src), _units(dst)
    fl, tl = len(a_all), len(b_all)
    p = 0
    while p < fl and p < tl and a_all[p] == b_all[p]:
        p += 1
    s = 0
    while s < fl - p and s < tl - p and a_all[fl - 1 - s] == b_all[tl - 1 - s]:
        s += 1
    out: list[Segment] = []
    if p:
        out.append((0, 0, p))
    a = a_all[p : fl - s]
    b = b_all[p : tl - s]
    if a and b:
        for x, y, n in _myers(a, b):
            out.append((x + p, y + p, n))
    if s:
        out.append((fl - s, tl - s, s))
    return out


def _myers(a: list[str], b: list[str]) -> list[Segment]:
    """Myers O((N+M)·D) diff로 일치 구간을 돌려준다. D가 너무 커지면 일치 없음([])."""
    n = len(a)
    m = len(b)
    mx = min(n + m, _MAX_D)
    v: dict[int, int] = {1: 0}
    trace: list[dict[int, int]] = []
    found = False
    d = 0
    while d <= mx and not found:
        trace.append(dict(v))
        for k in range(-d, d + 1, 2):
            if k == -d or (k != d and v.get(k - 1, 0) < v.get(k + 1, 0)):
                x = v.get(k + 1, 0)
            else:
                x = v.get(k - 1, 0) + 1
            y = x - k
            while x < n and y < m and a[x] == b[y]:
                x += 1
                y += 1
            v[k] = x
            if x >= n and y >= m:
                found = True
                break
        d += 1
    if not found:
        return []
    # 뱀(snake)을 거꾸로 따라간다
    runs: list[Segment] = []
    x, y = n, m
    d = len(trace) - 1
    while d >= 0 and (x > 0 or y > 0):
        vd = trace[d]
        k = x - y
        if k == -d or (k != d and vd.get(k - 1, 0) < vd.get(k + 1, 0)):
            prev_k = k + 1
        else:
            prev_k = k - 1
        prev_x = vd.get(prev_k, 0)
        prev_y = prev_x - prev_k
        if d == 0:
            start_x = 0
        else:
            start_x = prev_x if prev_k == k + 1 else prev_x + 1
        start_y = start_x - k
        if x > start_x:
            runs.append((start_x, start_y, x - start_x))
        x = 0 if d == 0 else prev_x
        y = 0 if d == 0 else prev_y
        d -= 1
    runs.reverse()
    return runs


def _map_offset(segments: list[Segment], offset: int, from_length: int, to_length: int, side: str) -> int:
    """`from`의 위치를 `to`로 옮긴다. 동시에 바뀐 구간 안의 위치는 범위 시작·삽입 지점이면 바뀐 글자 뒤로("상대 것 뒤"),
    범위 끝이면 앞으로 붙인다. 그래서 옛 글자만 건드린 범위가 동시에 들어온 수정을 지우지 않는다."""
    prev_to = 0
    for fs, ts, n in [*segments, (from_length, to_length, 0)]:
        if offset < fs:
            return ts if side == "start" else prev_to
        if offset <= fs + n:
            return ts + (offset - fs)
        prev_to = ts + n
    return to_length


def splice_range(current, sp: TextSplice) -> tuple[int, int]:
    """splice가 `current`의 어디에 놓이는지(작성자의 base와 다르면 옮긴 위치)."""
    plain = to_plain_text(current)
    plain_len = _u16_len(plain)
    start, end = sp["start"], sp["end"]
    if plain != sp["base"]:
        seg = _matches(sp["base"], plain)
        base_len = _u16_len(sp["base"])
        collapsed = start == end
        start = _map_offset(seg, start, base_len, plain_len, "start")
        end = start if collapsed else max(start, _map_offset(seg, end, base_len, plain_len, "end"))
    start = max(0, min(start, plain_len))
    end = max(start, min(end, plain_len))
    return start, end


def apply_splice(current, sp: TextSplice) -> list:
    cur = current if current is not None else []
    insert = sp.get("insert") or []
    plain = to_plain_text(cur)
    if plain == sp["base"]:
        start, end = splice_range(cur, sp)
        return concat(slice_rt(cur, 0, start), insert, slice_rt(cur, end))
    # 글이 바뀌었다: [start, end) 중 아직 남아 있는 base 글자만 지우고(그 안에 남이 넣은 글자는 남김),
    # 옮긴 시작 위치에 넣는다.
    seg = _matches(sp["base"], plain)
    at = _map_offset(seg, sp["start"], _u16_len(sp["base"]), _u16_len(plain), "start")
    pieces: list[tuple[int, int]] = []
    for fs, ts, n in seg:
        a = max(fs, sp["start"])
        b = min(fs + n, sp["end"])
        if a < b:
            pieces.append((ts + (a - fs), ts + (b - fs)))
    out = cur
    removed_before = 0
    for a, b in pieces:
        removed_before += max(0, min(b, at) - a)
    for a, b in reversed(pieces):
        out = delete_range(out, a, b)
    return insert_rich(out, max(0, at - removed_before), insert)


def map_text_offset(src: str, dst: str, offset: int, side: Literal["start", "end"] = "start") -> int:
    """캐럿·선택 위치를 한 버전의 글에서 다른 버전으로 옮긴다(같은 글자 옆에 머물게)."""
    if src == dst:
        return offset
    return _map_offset(_matches(src, dst), offset, _u16_len(src), _u16_len(dst), side)
