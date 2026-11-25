import { describe, expect, it } from 'vitest';
import { emptyTargets, monthlyConfirmed, openPipeline, summarize } from '../src/summary.ts';
import type { SalesRow, Targets } from '../src/types.ts';

let n = 0;
function r(over: Partial<SalesRow> = {}): SalesRow {
  n += 1;
  return {
    key: `${n}::A`, code: n, product: 'A', division: '본 영업', rep: '홍길동', customer: '고객사', contractor: '협력사',
    amount: 100, progress: '완료', contractDate: null, startDate: null, probability: '확정', isCloud: false, ...over,
  };
}

describe('summarize', () => {
  it('confirmed in period only', () => {
    const rows = [
      r({ amount: 300, contractDate: '2026-11-03' }),
      r({ amount: 200, contractDate: '2026-08-01' }),
      r({ amount: 999, contractDate: '2025-12-01' }),
      r({ amount: 500, contractDate: '2026-11-10', probability: '중A' }),
      r({ amount: 700, contractDate: '2026-11-11', division: '기획영업' }),
    ];
    const s = summarize(rows, null, '2026-11-25');
    expect(s).toMatchObject({ year: 2026, quarter: 4, month: 11, annualActual: 500, quarterActual: 300, monthActual: 300 });
    expect(s).toMatchObject({ annualTarget: 0, quarterTarget: 0, monthTarget: 0 });
  });

  it('cloud rows count as main', () => {
    expect(summarize([r({ amount: 40, contractDate: '2026-11-01', isCloud: true, product: 'CF(Cloud)' })], null, '2026-11-25').monthActual).toBe(40);
  });

  it('no contract date excluded', () => {
    expect(summarize([r({ amount: 40, contractDate: null })], null, '2026-11-25').annualActual).toBe(0);
  });

  it('targets copied', () => {
    const t: Targets = { ...emptyTargets(2026), annual: 1200, quarters: [0, 0, 0, 540] };
    t.months[10] = 140;
    expect(summarize([], t, '2026-11-25')).toMatchObject({ annualTarget: 1200, quarterTarget: 540, monthTarget: 140 });
  });
});

describe('monthlyConfirmed', () => {
  it('puts amounts in month slots', () => {
    const m = monthlyConfirmed([r({ amount: 10, contractDate: '2026-01-05' }), r({ amount: 20, contractDate: '2026-01-20' }), r({ amount: 5, contractDate: '2026-12-31' }), r({ amount: 99, contractDate: '2025-01-01' })], 2026);
    expect(m).toHaveLength(12);
    expect(m[0]).toBe(30);
    expect(m[11]).toBe(5);
    expect(m.reduce((a, b) => a + b, 0)).toBe(35);
  });
});

describe('openPipeline', () => {
  it('filters and sorts', () => {
    const rows = [
      r({ key: 'old', progress: '진행', probability: '중A', startDate: '2026-01-01' }),
      r({ key: 'none', progress: '장기관리', probability: '하', startDate: null }),
      r({ key: 'new', progress: '진행', probability: '상', startDate: '2026-11-24' }),
      r({ key: 'done', progress: '완료' }),
      r({ key: 'plan', progress: '진행', division: '기획영업' }),
    ];
    expect(openPipeline(rows).map((x) => x.key)).toEqual(['new', 'old', 'none']);
  });
});

describe('emptyTargets', () => {
  it('has 12 zero months', () => {
    expect(emptyTargets(2026)).toEqual({ year: 2026, annual: 0, quarters: [0, 0, 0, 0], months: Array(12).fill(0) });
  });
});
