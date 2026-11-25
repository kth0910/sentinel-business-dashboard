// 목업: 가중치·매출 구분·매출일정. 지금 엑셀에는 이 열이 없고 업무관리시스템 API로 받을 예정이라,
// 그전까지 서버가 영업 건마다 정해진 값으로 채운다(같은 건은 항상 같은 값 → 날마다 가짜 변동이 생기지 않음).
// API가 붙으면 이 파일과 api/modules/biz.ts의 fillMockExtras 호출을 지운다.
import type { SalesRow } from '@nc/biz';

export const MOCK_WEIGHTS = ['High(100%)', 'Medium(50%)', 'Low(10%)', '미반영'] as const;
export const MOCK_REVENUE_TYPES = ['과업매출', '기반매출'] as const;
/** 진행 중인 건의 매출일정: 이 날짜부터 90일 안에서 건마다 하루를 고른다. */
const MOCK_DATE_BASE = Date.UTC(2026, 10, 20);

/** 영업 건 키 → 고정된 정수(FNV-1a). */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

const OPEN = new Set(['진행', '장기관리']);

export function fillMockExtras(rows: SalesRow[]): SalesRow[] {
  return rows.map((row) => {
    const h = hash(row.key);
    const revenueDate = OPEN.has(row.progress)
      ? new Date(MOCK_DATE_BASE + ((h >>> 8) % 90) * 86_400_000).toISOString().slice(0, 10)
      : row.contractDate;
    return {
      ...row,
      weight: row.weight ?? MOCK_WEIGHTS[h % MOCK_WEIGHTS.length],
      revenueType: row.revenueType ?? MOCK_REVENUE_TYPES[(h >>> 4) % MOCK_REVENUE_TYPES.length],
      revenueDate: row.revenueDate ?? revenueDate,
    };
  });
}
