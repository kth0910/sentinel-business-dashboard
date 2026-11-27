"""리치 텍스트: 원본 frontend/packages/shared/src/richtext.ts 중 서버에 필요한 함수만 옮긴 것.

모양은 원본과 같은 JSON `[[text], [text, [annotation, ...]], ...]`. 멘션("‣")·인라인 수식("⁍") 같은 아톰은
글자 하나이고 내용은 주석(annotation)에 들어 있다. 모든 위치와 길이는 브라우저처럼 UTF-16 코드 단위로 센다.
"""
import json

# 원본 ATOM_KEYS: 이 주석이 붙은 조각은 통째로 하나의 글자(아톰)다.
ATOM_KEYS = frozenset({"e", "p", "u", "d", "lm", "ce", "tv", "g"})


def _u16_len(s: str) -> int:
    """JS의 String.length: UTF-16 코드 단위 개수(BMP 밖 글자는 2)."""
    return len(s.encode("utf-16-le", "surrogatepass")) // 2


def _u16_slice(s: str, a: int, b: int | None = None) -> str:
    """JS의 String.slice(a, b)를 UTF-16 코드 단위로. 서로게이트 쌍 가운데를 잘라도 원본처럼 그대로 자른다.
    결과는 다시 디코딩하므로, 입력에 서로게이트 반쪽 두 개가 이어져 있으면 제대로 된 한 글자로 합쳐진다."""
    units = s.encode("utf-16-le", "surrogatepass")
    n = len(units) // 2
    a = max(0, n + a) if a < 0 else min(a, n)
    b = n if b is None else (max(0, n + b) if b < 0 else min(b, n))
    if a >= b:
        return ""
    return units[2 * a : 2 * b].decode("utf-16-le", "surrogatepass")


def annotations_of(d) -> list:
    return (d[1] if len(d) > 1 else None) or []


def _is_atom(d) -> bool:
    return any(a[0] in ATOM_KEYS for a in annotations_of(d))


def to_plain_text(rt) -> str:
    if not rt:
        return ""
    # 조각 경계에서 갈라진 서로게이트 쌍도 JS처럼 한 글자로 보이도록 UTF-16을 한 번 거친다.
    return _u16_slice("".join(d[0] for d in rt), 0)


def length(rt) -> int:
    if not rt:
        return 0
    return sum(_u16_len(d[0]) for d in rt)


def _ann_key(a) -> str:
    # 원본의 JSON.stringify와 같은 모양(공백 없음, 글자 그대로)
    return json.dumps(a, ensure_ascii=False, separators=(",", ":"))


def _same_annotations(a: list, b: list) -> bool:
    if len(a) != len(b):
        return False
    return sorted(map(_ann_key, a)) == sorted(map(_ann_key, b))


def _normalize(rt) -> list:
    """이웃한 같은 주석 조각을 합치고 빈 조각은 버린다. 아톰은 합치지 않는다."""
    out: list = []
    for d in rt:
        if not d[0]:
            continue
        anns = annotations_of(d)
        prev = out[-1] if out else None
        if prev is not None and not _is_atom(prev) and not _is_atom(d) and _same_annotations(annotations_of(prev), anns):
            merged = _u16_slice(prev[0] + d[0], 0)  # 이어 붙은 서로게이트 반쪽을 한 글자로 합친다
            out[-1] = [merged, anns] if anns else [merged]
        else:
            out.append([d[0], [list(a) for a in anns]] if anns else [d[0]])
    return out


def slice_rt(rt, start: int, end: int | None = None) -> list:
    """[start, end) 구간을 자른다(UTF-16 단위). 걸친 아톰은 통째로 남긴다. end가 None이면 끝까지."""
    out: list = []
    pos = 0
    for d in rt:
        n = _u16_len(d[0])
        s = max(start, pos)
        e = pos + n if end is None else min(end, pos + n)
        if s < e:
            piece = d[0] if _is_atom(d) else _u16_slice(d[0], s - pos, e - pos)
            anns = annotations_of(d)
            out.append([piece, anns] if anns else [piece])
        pos += n
        if end is not None and pos >= end:
            break
    return _normalize(out)


def concat(*parts) -> list:
    return _normalize([d for part in parts for d in part])


def insert_rich(rt, offset: int, ins) -> list:
    return concat(slice_rt(rt, 0, offset), ins, slice_rt(rt, offset))


def delete_range(rt, start: int, end: int):
    if end <= start:
        return rt
    return concat(slice_rt(rt, 0, start), slice_rt(rt, end))
