// 채용 현황: '현황'은 직군별 지원자 수(숫자)이고, 지원자는 그 합계(자동, 직접 입력 불가).
// 예전에 글자로 적은 현황("해당자 없음", "해당자 3명 · 전화면접 예정")도 숫자로 읽고, 숫자 말고 남는 글자는 비고로 옮긴다.

export interface HiringRow { id?: string; role: string; status: number | string; note: string }

const EDGE = /^[\s·,:;\-–—()[\]]+|[\s·,:;\-–—()[\]]+$/g;

/** 현황 값 → 숫자와 숫자 말고 남는 글자 */
export function splitStatus(status: unknown): { count: number; rest: string } {
  if (typeof status === 'number') return { count: Number.isFinite(status) ? Math.max(0, Math.round(status)) : 0, rest: '' };
  const s = String(status ?? '').trim();
  if (!s || /^해당자\s*없음$/.test(s)) return { count: 0, rest: '' };
  const m = /(\d[\d,]*)\s*명?/.exec(s);
  const count = m ? Number(m[1].replace(/,/g, '')) || 0 : 0;
  const left = m ? s.slice(0, m.index) + s.slice(m.index + m[0].length) : s;
  const rest = left.replace(/해당자\s*(없음)?/, '').replace(EDGE, '').trim();
  return { count, rest };
}

/** 숫자 현황으로 바꾼 행. 남는 글자는 비고 앞에 붙인다 */
export function normalizeRow<T extends HiringRow>(row: T): T & { status: number } {
  const { count, rest } = splitStatus(row.status);
  const note = rest ? (row.note?.trim() ? `${rest} · ${row.note.trim()}` : rest) : (row.note ?? '');
  return { ...row, status: count, note };
}

export const isLegacyRow = (row: HiringRow): boolean => typeof row.status !== 'number';

export const applicantTotal = (rows: HiringRow[]): number => rows.reduce((sum, r) => sum + splitStatus(r.status).count, 0);
