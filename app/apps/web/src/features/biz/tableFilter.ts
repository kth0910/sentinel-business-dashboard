// 업무 표 필터(순수 함수): 열마다 값 목록(체크한 값만) 또는 숫자 범위(min·max). 여러 열이면 모두 맞는 행만 남긴다.
export const EMPTY_VALUE = '(비어 있음)';

export interface ColFilter {
  /** 이 값들만 보인다(비어 있으면 거르지 않음) */
  values?: string[];
  /** 숫자 열 범위(양 끝 포함, 한쪽만 있어도 됨) */
  min?: number | null;
  max?: number | null;
}
export type Filters = Record<string, ColFilter>;

export interface FilterCol<T> {
  key: string;
  value?: (row: T) => string | number | null | undefined;
  num?: boolean;
}

const asText = (v: unknown): string => (v === null || v === undefined || v === '' ? EMPTY_VALUE : String(v));
const isActive = (f: ColFilter | undefined) => !!f && (!!f.values?.length || f.min != null || f.max != null);

export function activeFilterCount(filters: Filters | undefined): number {
  return Object.values(filters ?? {}).filter(isActive).length;
}

export function applyFilters<T>(rows: T[], cols: FilterCol<T>[], filters: Filters | undefined): T[] {
  const checks = cols.filter((c) => c.value && isActive(filters?.[c.key])).map((c) => ({ c, f: filters![c.key] }));
  if (!checks.length) return rows;
  return rows.filter((row) => checks.every(({ c, f }) => {
    const v = c.value!(row);
    if (f.values?.length && !f.values.includes(asText(v))) return false;
    if (f.min != null || f.max != null) {
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) return false;
      if (f.min != null && n < f.min) return false;
      if (f.max != null && n > f.max) return false;
    }
    return true;
  }));
}

/** 열의 서로 다른 값(가나다순, 빈 값은 맨 뒤). */
export function distinctValues<T>(rows: T[], col: FilterCol<T>): string[] {
  if (!col.value) return [];
  const set = new Set(rows.map((r) => asText(col.value!(r))));
  const empty = set.delete(EMPTY_VALUE);
  return [...[...set].sort((a, b) => a.localeCompare(b, 'ko')), ...(empty ? [EMPTY_VALUE] : [])];
}
