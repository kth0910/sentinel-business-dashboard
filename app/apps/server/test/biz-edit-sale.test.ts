// 영업 건 수정 창: 여러 칸·구분·증감액을 한 번에 저장. 증감액은 본영업 매출 당일 증감액에 바로 반영된다.
// 제품·확도·가중치·매출 구분·진행사항은 고를 값 목록이 있고, 새 값을 넣으면 목록에 추가된다.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SalesRow } from '@nc/biz';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-biz-edit-sale-test-'));
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
const change = (date: string, key = '1::A') => store.changesFor(date).find((c) => c.key === key)!;

beforeAll(async () => {
  store = await import('../src/biz/store.ts');
  biz = await import('../src/api/modules/biz.ts');
  store.importSnapshot('2026-11-24', [r(), r({ key: '2::B', code: 2, product: 'B', amount: 40 })]);
  store.importSnapshot('2026-11-25', [r({ amount: 150 }), r({ key: '2::B', code: 2, product: 'B', amount: 70 })]);
});

describe('edit a sale in one go', () => {
  it('saves several fields with one recompute and keeps originals', () => {
    store.editSale('2026-11-25', '1::A', { fields: { customer: '새 고객', weight: 'High(100%)', amount: 180 } }, 'u1');
    const c = change('2026-11-25');
    expect(c.after).toMatchObject({ customer: '새 고객', weight: 'High(100%)', amount: 180 });
    expect(c.after!.edited).toEqual({ customer: '고객사', weight: 'Low(10%)', amount: 150 });
    expect(c.delta).toBe(80);
  });

  it('null in fields goes back to the received value', () => {
    store.editSale('2026-11-25', '1::A', { fields: { customer: null } }, 'u1');
    expect(change('2026-11-25').after!.customer).toBe('고객사');
  });

  it('category: an existing id, or a new name creates the 구분', () => {
    store.editSale('2026-11-25', '1::A', { categoryId: 'advance' }, 'u1');
    expect(change('2026-11-25')).toMatchObject({ categoryId: 'advance', manual: true });
    store.editSale('2026-11-25', '1::A', { categoryLabel: '단가 조정' }, 'u1');
    const cat = store.listCategories().find((x) => x.label === '단가 조정')!;
    expect(cat).toBeTruthy();
    expect(change('2026-11-25').categoryId).toBe(cat.id);
    // 같은 이름을 또 넣으면 새로 만들지 않는다
    store.editSale('2026-11-25', '2::B', { categoryLabel: ' 단가 조정 ' }, 'u1');
    expect(store.listCategories().filter((x) => x.label === '단가 조정')).toHaveLength(1);
    expect(change('2026-11-25', '2::B').categoryId).toBe(cat.id);
  });
});

describe('직접 넣은 증감액', () => {
  it('replaces the computed delta and the day total', () => {
    expect(store.dayDelta('2026-11-25')).toBe(80 + 30);
    store.editSale('2026-11-25', '1::A', { delta: -20 }, 'u1');
    expect(change('2026-11-25')).toMatchObject({ delta: -20, autoDelta: 80 });
    expect(store.dayDelta('2026-11-25')).toBe(-20 + 30);
  });

  it('survives a reimport and an amount edit', () => {
    store.importSnapshot('2026-11-25', [r({ amount: 150 }), r({ key: '2::B', code: 2, product: 'B', amount: 70 })]);
    store.editSale('2026-11-25', '1::A', { fields: { amount: 500 } }, 'u1');
    expect(change('2026-11-25')).toMatchObject({ delta: -20, autoDelta: 400 });
  });

  it('null clears it', () => {
    store.editSale('2026-11-25', '1::A', { delta: null }, 'u1');
    const c = change('2026-11-25');
    expect(c.delta).toBe(400);
    expect(c.autoDelta).toBeUndefined();
    expect(store.dayDelta('2026-11-25')).toBe(400 + 30);
  });

  it('rejects a non-number', () => {
    expect(() => store.editSale('2026-11-25', '1::A', { delta: 'abc' as any }, 'u1')).toThrow();
  });

  it('a removed deal (no row today) can still get 구분 and 증감액, but not fields', () => {
    store.importSnapshot('2026-11-26', [r({ amount: 500 })]);
    expect(change('2026-11-26', '2::B').after).toBeNull();
    store.editSale('2026-11-26', '2::B', { delta: -5 }, 'u1');
    expect(change('2026-11-26', '2::B').delta).toBe(-5);
    expect(() => store.editSale('2026-11-26', '2::B', { fields: { customer: 'x' } }, 'u1')).toThrow();
  });
});

describe('값 목록', () => {
  it('lists values in the data plus added ones; new values typed in are added', () => {
    let o = store.listOptions(store.snapshotRows('2026-11-25')!);
    expect(o.weight.map((x) => x.value)).toContain('High(100%)');
    expect(o.probability.find((x) => x.value === '중A')).toMatchObject({ removable: false });
    store.editSale('2026-11-25', '2::B', { fields: { revenueType: '유지보수매출' } }, 'u1');
    store.editSale('2026-11-25', '2::B', { fields: { revenueType: null } }, 'u1');
    o = store.listOptions(store.snapshotRows('2026-11-25')!);
    // 데이터에서는 빠졌지만 목록에는 남고, 지울 수 있다
    expect(o.revenueType.find((x) => x.value === '유지보수매출')).toMatchObject({ removable: true });
    store.removeOption('revenueType', '유지보수매출');
    expect(store.listOptions(store.snapshotRows('2026-11-25')!).revenueType.some((x) => x.value === '유지보수매출')).toBe(false);
  });

  it('only the listed fields have value lists', () => {
    expect(() => store.removeOption('customer', 'x')).toThrow();
  });
});

describe('rpc', () => {
  it('bizEditSale: login required, bad input is 400, sales view carries options', async () => {
    await expect(biz.handlers.bizEditSale({ userId: null, setCookie() {} } as any, { date: '2026-11-25', key: '1::A' })).rejects.toMatchObject({ status: 401 });
    await expect(biz.handlers.bizEditSale(ctx, { date: '2026-11-25', key: '1::A', fields: { division: 'x' } })).rejects.toMatchObject({ status: 400 });
    await biz.handlers.bizEditSale(ctx, { date: '2026-11-25', key: '1::A', fields: { rep: '김철수' }, delta: 7 });
    const v = await biz.handlers.bizSalesView(ctx, { date: '2026-11-25' });
    expect(v.changes.find((c) => c.key === '1::A')).toMatchObject({ delta: 7 });
    expect(v.dayDelta).toBe(7 + 30);
    expect(Object.keys(v.options).sort()).toEqual(['probability', 'product', 'progress', 'revenueType', 'weight']);
    await biz.handlers.bizRemoveOption(ctx, { field: 'weight', value: '없는 값' });
  });
});
