// 가중치·매출 구분·매출일정 목업: 업무관리시스템 API가 붙기 전까지 서버가 채운다.
// 같은 영업 건은 날마다 같은 값이어야 가짜 변동이 생기지 않는다.
import { describe, expect, it } from 'vitest';
import type { SalesRow } from '@nc/biz';
import { fillMockExtras, MOCK_REVENUE_TYPES, MOCK_WEIGHTS } from '../src/biz/mock.ts';

function r(over: Partial<SalesRow> = {}): SalesRow {
  return {
    key: '101::A', code: 101, product: 'A', division: '본 영업', rep: '홍길동', customer: '고객사', contractor: '협력사',
    amount: 100, progress: '진행', contractDate: null, startDate: '2026-11-01', probability: '중A', isCloud: false,
    weight: null, revenueType: null, revenueDate: null, ...over,
  };
}

describe('fillMockExtras', () => {
  it('fills the three fields with the same values for the same deal every time', () => {
    const [a] = fillMockExtras([r()]);
    const [b] = fillMockExtras([r({ amount: 999 })]);
    expect(MOCK_WEIGHTS).toContain(a.weight);
    expect(MOCK_REVENUE_TYPES).toContain(a.revenueType);
    expect(a.revenueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect([b.weight, b.revenueType, b.revenueDate]).toEqual([a.weight, a.revenueType, a.revenueDate]);
  });

  it('closed deals use the contract date as the revenue date', () => {
    const [c] = fillMockExtras([r({ progress: '완료', contractDate: '2026-03-02' })]);
    expect(c.revenueDate).toBe('2026-03-02');
  });

  it('keeps values that came from the source', () => {
    const [c] = fillMockExtras([r({ weight: 'High(100%)', revenueType: '기반매출', revenueDate: '2026-12-24' })]);
    expect(c).toMatchObject({ weight: 'High(100%)', revenueType: '기반매출', revenueDate: '2026-12-24' });
  });

  it('different deals get a spread of values', () => {
    const rows = fillMockExtras(Array.from({ length: 60 }, (_, i) => r({ key: `${i}::P${i}`, code: i })));
    expect(new Set(rows.map((x) => x.weight)).size).toBeGreaterThan(1);
    expect(new Set(rows.map((x) => x.revenueType)).size).toBe(2);
  });
});
