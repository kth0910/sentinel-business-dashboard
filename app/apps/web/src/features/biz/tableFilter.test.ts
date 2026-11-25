// 업무 표 필터: 열마다 값 목록(체크) 또는 숫자 범위. 여러 열이면 모두 맞는 행만.
import { describe, expect, it } from 'vitest';
import { activeFilterCount, applyFilters, distinctValues, EMPTY_VALUE, type FilterCol } from './tableFilter.ts';

interface Row { customer: string; category: string; amount: number; date: string | null }
const rows: Row[] = [
  { customer: '가', category: '신규매출', amount: 15_000_000, date: '2026-11-24' },
  { customer: '나', category: '목표매출 상향', amount: 29_600_000, date: null },
  { customer: '다', category: '신규매출', amount: 2_000_000, date: '2026-12-01' },
];
const cols: FilterCol<Row>[] = [
  { key: 'customer', value: (r) => r.customer },
  { key: 'category', value: (r) => r.category },
  { key: 'amount', value: (r) => r.amount, num: true },
  { key: 'date', value: (r) => r.date },
];

describe('applyFilters', () => {
  it('keeps rows whose value is checked', () => {
    expect(applyFilters(rows, cols, { category: { values: ['신규매출'] } }).map((r) => r.customer)).toEqual(['가', '다']);
  });

  it('filters numbers by range, either end optional', () => {
    expect(applyFilters(rows, cols, { amount: { min: 10_000_000 } }).map((r) => r.customer)).toEqual(['가', '나']);
    expect(applyFilters(rows, cols, { amount: { min: 10_000_000, max: 20_000_000 } }).map((r) => r.customer)).toEqual(['가']);
  });

  it('combines columns with AND', () => {
    expect(applyFilters(rows, cols, { category: { values: ['신규매출'] }, amount: { max: 5_000_000 } }).map((r) => r.customer)).toEqual(['다']);
  });

  it('matches empty values with the empty marker', () => {
    expect(applyFilters(rows, cols, { date: { values: [EMPTY_VALUE] } }).map((r) => r.customer)).toEqual(['나']);
  });

  it('ignores filters for unknown columns and empty filters', () => {
    expect(applyFilters(rows, cols, { nope: { values: ['x'] }, category: {} })).toHaveLength(3);
  });
});

describe('distinctValues / activeFilterCount', () => {
  it('lists distinct values sorted, empty last', () => {
    expect(distinctValues(rows, cols[3])).toEqual(['2026-11-24', '2026-12-01', EMPTY_VALUE]);
    expect(distinctValues(rows, cols[1])).toEqual(['목표매출 상향', '신규매출']);
  });

  it('counts only filters that do something', () => {
    expect(activeFilterCount({ category: { values: ['신규매출'] }, amount: {}, date: { values: [] } })).toBe(1);
  });
});
