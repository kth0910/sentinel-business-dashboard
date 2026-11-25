// 전일 스냅샷과 오늘 스냅샷을 비교해 변동을 만들고 자동 분류한다 (설계 11.4).
import { CONFIRMED, EXCLUDE_PROGRESS, isMain, LOW_PROBABILITY, type Change, type FieldDiff, type SalesRow } from './types.ts';

const FIELDS: FieldDiff['field'][] = ['amount', 'probability', 'progress', 'contractDate'];

function fieldDiffs(before: SalesRow, after: SalesRow): FieldDiff[] {
  return FIELDS.filter((f) => before[f] !== after[f]).map((f) => ({ field: f, before: before[f], after: after[f] }));
}

/** 목표에서 빠진 건: 확도 하·매우낮음 또는 진행사항 보류·실패. */
export function isExcluded(r: SalesRow): boolean {
  return LOW_PROBABILITY.includes(r.probability) || EXCLUDE_PROGRESS.includes(r.progress);
}

/** 목표에 들어가는 금액. 이미 빠진 건은 0이라 두 번 빼지 않는다. */
function counted(r: SalesRow | null): number {
  return r && !isExcluded(r) ? r.amount : 0;
}

function classify(before: SalesRow, after: SalesRow, diffs: FieldDiff[]): Change | null {
  if (!diffs.length) return null;
  const base = { key: after.key, before, after, diffs };
  const delta = counted(after) - counted(before);
  if (before.probability !== CONFIRMED && after.probability === CONFIRMED) return { ...base, kind: 'confirm', delta };
  if (!isExcluded(before) && isExcluded(after)) return { ...base, kind: 'exclude', delta };
  if (!isExcluded(before) && !isExcluded(after) && after.amount > before.amount) return { ...base, kind: 'raise', delta };
  return { ...base, kind: 'unclassified', delta };
}

/** prev가 null이면 첫 업로드(기준 데이터)라 변동 없음. 대상은 before 또는 after가 '본 영업'인 키. */
export function diffSnapshots(prev: SalesRow[] | null, curr: SalesRow[]): Change[] {
  if (prev === null) return [];
  const before = new Map(prev.map((r) => [r.key, r]));
  const after = new Map(curr.map((r) => [r.key, r]));
  const out: Change[] = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(key) ?? null;
    const a = after.get(key) ?? null;
    if (!(b && isMain(b)) && !(a && isMain(a))) continue;
    if (!b && a) out.push({ key, kind: 'new', delta: counted(a), before: null, after: a, diffs: [] });
    else if (b && !a) out.push({ key, kind: 'exclude', delta: 0 - counted(b), before: b, after: null, diffs: [] });
    else if (b && a) {
      const c = classify(b, a, fieldDiffs(b, a));
      if (c) out.push(c);
    }
  }
  return out.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta) || x.key.localeCompare(y.key));
}
