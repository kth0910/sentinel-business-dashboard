// 직접 수정: 받아온 값(엑셀·API)과 따로 저장해, 그 날짜부터 계속 적용한다. 변동·요약도 수정값으로 계산.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SalesRow } from '@nc/biz';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-biz-override-test-'));
process.env.NC_SCHEDULER = '0';

let store: typeof import('../src/biz/store.ts');
let biz: typeof import('../src/api/modules/biz.ts');
const ctx = { userId: 'u1', setCookie() {} } as any;

function r(over: Partial<SalesRow> = {}): SalesRow {
  return {
    key: '1::A', code: 1, product: 'A', division: '본 영업', rep: '홍길동', customer: '고객사', contractor: '협력사',
    amount: 100, progress: '진행', contractDate: null, startDate: '2026-11-01', probability: '중A', isCloud: false,
    weight: 'Low(10%)', revenueType: '과업매출', revenueDate: '2026-12-31', ...over,
  };
}
const row = (date: string, key = '1::A') => store.snapshotRows(date)!.find((x) => x.key === key)!;

beforeAll(async () => {
  store = await import('../src/biz/store.ts');
  biz = await import('../src/api/modules/biz.ts');
  store.importSnapshot('2026-11-24', [r(), r({ key: '2::B', code: 2, product: 'B' })]);
  store.importSnapshot('2026-11-25', [r(), r({ key: '2::B', code: 2, product: 'B' })]);
});

describe('manual edits', () => {
  it('applies from the edited date on, keeps the original value, and shows up as a change', () => {
    store.setOverride('1::A', 'weight', 'High(100%)', '2026-11-25', 'u1');
    expect(row('2026-11-24').weight).toBe('Low(10%)');
    expect(row('2026-11-25').weight).toBe('High(100%)');
    expect(row('2026-11-25').edited).toEqual({ weight: 'Low(10%)' });
    const c = store.changesFor('2026-11-25').find((x) => x.key === '1::A')!;
    expect(c.diffs).toEqual([{ field: 'weight', before: 'Low(10%)', after: 'High(100%)' }]);
  });

  it('survives the next upload of the same source data', () => {
    store.importSnapshot('2026-11-26', [r(), r({ key: '2::B', code: 2, product: 'B' })]);
    expect(row('2026-11-26').weight).toBe('High(100%)');
    expect(store.changesFor('2026-11-26')).toEqual([]);
  });

  it('an earlier revenue date edit counts as 매출일정 앞당김 and amount edits feed the change delta', () => {
    store.setOverride('2::B', 'revenueDate', '2026-11-30', '2026-11-25', 'u1');
    expect(store.changesFor('2026-11-25').find((x) => x.key === '2::B')!.kind).toBe('advance');
    store.setOverride('2::B', 'amount', 300, '2026-11-25', 'u1');
    expect(store.changesFor('2026-11-25').find((x) => x.key === '2::B')!).toMatchObject({ kind: 'raise', delta: 200 });
  });

  it('clearing goes back to the received value everywhere', () => {
    store.clearOverride('1::A', 'weight');
    expect(row('2026-11-25').weight).toBe('Low(10%)');
    expect(row('2026-11-25').edited).toBeUndefined();
    expect(store.changesFor('2026-11-25').some((x) => x.key === '1::A')).toBe(false);
  });

  it('rejects unknown fields and bad values', () => {
    expect(() => store.setOverride('1::A', 'code', 5, '2026-11-25', 'u1')).toThrow();
    expect(() => store.setOverride('1::A', 'amount', -1, '2026-11-25', 'u1')).toThrow();
    expect(() => store.setOverride('1::A', 'revenueDate', '12월 1일', '2026-11-25', 'u1')).toThrow();
  });

  it('rpc: login required, null clears', async () => {
    await expect(biz.handlers.bizSetOverride({ userId: null, setCookie() {} } as any, { date: '2026-11-25', key: '1::A', field: 'rep', value: '김철수' })).rejects.toMatchObject({ status: 401 });
    await biz.handlers.bizSetOverride(ctx, { date: '2026-11-25', key: '1::A', field: 'rep', value: '김철수' });
    expect(row('2026-11-25').rep).toBe('김철수');
    await biz.handlers.bizSetOverride(ctx, { date: '2026-11-25', key: '1::A', field: 'rep', value: null });
    expect(row('2026-11-25').rep).toBe('홍길동');
    await expect(biz.handlers.bizSetOverride(ctx, { date: '2026-11-25', key: '1::A', field: 'division', value: 'x' })).rejects.toMatchObject({ status: 400 });
  });
});
