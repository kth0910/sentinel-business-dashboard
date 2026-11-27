// 수동 작성: 변동사항 행을 직접 추가·수정·삭제(매출 데이터가 없는 날에도), 본영업 매출 실적 직접 입력.
// 당일 증감액은 변동사항(받아온 것 + 직접 적은 것) 증감액의 합.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SalesRow } from '@nc/biz';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-biz-manual-test-'));
process.env.NC_SCHEDULER = '0';

let store: typeof import('../src/biz/store.ts');
let biz: typeof import('../src/api/modules/biz.ts');
const ctx = { userId: 'u1', setCookie() {} } as any;
const anon = { userId: null, setCookie() {} } as any;

function r(over: Partial<SalesRow> = {}): SalesRow {
  return {
    key: '1::A', code: 1, product: 'A', division: '본 영업', rep: '홍길동', customer: '고객사', contractor: '협력사',
    amount: 100, progress: '진행', contractDate: null, startDate: '2026-11-01', probability: '중A', isCloud: false,
    weight: 'Low(10%)', revenueType: '과업매출', revenueDate: '2026-12-31', ...over,
  };
}
const list = (date: string) => store.allChangesFor(date);

beforeAll(async () => {
  store = await import('../src/biz/store.ts');
  biz = await import('../src/api/modules/biz.ts');
  store.importSnapshot('2026-11-24', [r()]);
  store.importSnapshot('2026-11-25', [r({ amount: 150 })]);
});

describe('직접 적는 변동 행', () => {
  let key = '';

  it('adds a row on a day without sales data; it counts in the day total', () => {
    key = store.addManualChange('2026-11-27', {
      fields: { customer: '새 고객', product: '서비스 X(Cloud)', amount: 3000, probability: '상', weight: 'High(100%)', revenueType: '신규 매출', revenueDate: '2026-12-15' },
      categoryLabel: '신규매출', delta: 3000,
    }, 'u1');
    expect(key).toMatch(/^m:/);
    const [c] = list('2026-11-27');
    expect(c).toMatchObject({ key, delta: 3000, before: null, diffs: [], entry: true });
    expect(c.after).toMatchObject({ customer: '새 고객', product: '서비스 X(Cloud)', amount: 3000, isCloud: true, revenueDate: '2026-12-15' });
    expect(store.listCategories().find((x) => x.id === c.categoryId)!.label).toBe('신규매출');
    expect(store.dayDelta('2026-11-27')).toBe(3000);
    // 새 값은 목록에 들어간다
    expect(store.listOptions([]).revenueType.map((o) => o.value)).toContain('신규 매출');
  });

  it('a new row needs a customer or product, and defaults to 미분류 and 증감액 0', () => {
    expect(() => store.addManualChange('2026-11-27', {}, 'u1')).toThrow();
    const k = store.addManualChange('2026-11-27', { fields: { customer: '빈 건' } }, 'u1');
    expect(list('2026-11-27').find((c) => c.key === k)).toMatchObject({ categoryId: 'unclassified', delta: 0 });
    store.deleteChange('2026-11-27', k);
  });

  it('edits go through editSale with the row key (null empties a field)', () => {
    store.editSale('2026-11-27', key, { fields: { amount: 5000, weight: null }, delta: 4000, categoryId: 'raise' }, 'u1');
    const c = list('2026-11-27').find((x) => x.key === key)!;
    expect(c).toMatchObject({ delta: 4000, categoryId: 'raise' });
    expect(c.after).toMatchObject({ amount: 5000, weight: '' });
    expect(c.after!.edited).toBeUndefined();
    expect(store.dayDelta('2026-11-27')).toBe(4000);
  });

  it('renaming a value in the list renames it in written rows too', () => {
    store.renameOption('product', '서비스 X(Cloud)', '서비스 X');
    expect(list('2026-11-27')[0].after).toMatchObject({ product: '서비스 X', isCloud: false });
  });

  it('deleting a 구분 moves written rows to 미분류', () => {
    const cat = store.saveCategory({ label: '임시' });
    store.editSale('2026-11-27', key, { categoryId: cat.id }, 'u1');
    store.deleteCategory(cat.id);
    expect(list('2026-11-27')[0].categoryId).toBe('unclassified');
  });

  it('rows are listed after received changes, in the order written', () => {
    const k2 = store.addManualChange('2026-11-25', { fields: { customer: '둘째' }, delta: -7 }, 'u1');
    const k3 = store.addManualChange('2026-11-25', { fields: { customer: '셋째' } }, 'u1');
    expect(list('2026-11-25').map((c) => c.key)).toEqual(['1::A', k2, k3]);
    expect(store.dayDelta('2026-11-25')).toBe(50 - 7);
  });

  it('deleting a written row removes it', () => {
    store.deleteChange('2026-11-27', key);
    expect(list('2026-11-27')).toEqual([]);
    expect(store.dayDelta('2026-11-27')).toBe(0);
    expect(() => store.deleteChange('2026-11-27', key)).toThrow();
  });

  it('deleting a received change hides it, also after reimport', () => {
    store.deleteChange('2026-11-25', '1::A');
    expect(list('2026-11-25').some((c) => c.key === '1::A')).toBe(false);
    expect(store.dayDelta('2026-11-25')).toBe(-7);
    store.importSnapshot('2026-11-25', [r({ amount: 150 })]);
    expect(list('2026-11-25').some((c) => c.key === '1::A')).toBe(false);
  });
});

describe('실적 직접 입력', () => {
  const view = async (date: string) => (await biz.handlers.bizSalesView(ctx, { date })).summary;

  it('a value applies from that date on within its period, then the computed value', async () => {
    store.setActual('2026-11-26', 'month', 777);
    store.setActual('2026-11-26', 'annual', 9000);
    expect((await view('2026-11-25')).monthActual).toBe(0);
    expect(await view('2026-11-26')).toMatchObject({ monthActual: 777, annualActual: 9000, edited: { month: 0, annual: 0 } });
    expect((await view('2026-11-30')).monthActual).toBe(777);
    // 다음 달은 월 실적만 계산값으로, 연 실적은 그대로
    expect(await view('2026-12-01')).toMatchObject({ monthActual: 0, annualActual: 9000 });
    expect((await view('2027-01-02')).annualActual).toBe(0);
  });

  it('a later entry wins; null goes back to the computed value from that date', async () => {
    store.setActual('2026-11-28', 'month', 888);
    expect((await view('2026-11-29')).monthActual).toBe(888);
    store.setActual('2026-11-29', 'month', null);
    expect((await view('2026-11-29')).monthActual).toBe(0);
    expect((await view('2026-11-29')).edited?.month).toBeUndefined();
    expect((await view('2026-11-28')).monthActual).toBe(888);
  });

  it('rejects bad input', () => {
    expect(() => store.setActual('2026-11-26', 'week' as any, 1)).toThrow();
    expect(() => store.setActual('2026-11-26', 'month', -1)).toThrow();
  });
});

describe('rpc', () => {
  it('bizAddChange / bizDeleteChange / bizSetActual need login and check input', async () => {
    await expect(biz.handlers.bizAddChange(anon, { date: '2026-11-27', fields: { customer: 'x' } })).rejects.toMatchObject({ status: 401 });
    await expect(biz.handlers.bizAddChange(ctx, { date: '2026-11-27' })).rejects.toMatchObject({ status: 400 });
    const { key } = await biz.handlers.bizAddChange(ctx, { date: '2026-11-27', fields: { customer: 'rpc 고객' }, delta: 10 });
    const v = await biz.handlers.bizSalesView(ctx, { date: '2026-11-27' });
    expect(v.changes.map((c) => c.key)).toEqual([key]);
    expect(v.dayDelta).toBe(10);
    await biz.handlers.bizDeleteChange(ctx, { date: '2026-11-27', key });
    await expect(biz.handlers.bizSetActual(anon, { date: '2026-11-27', period: 'month', value: 1 })).rejects.toMatchObject({ status: 401 });
    await expect(biz.handlers.bizSetActual(ctx, { date: '2026-11-27', period: 'month', value: 'abc' })).rejects.toMatchObject({ status: 400 });
    await biz.handlers.bizSetActual(ctx, { date: '2026-11-27', period: 'quarter', value: 5 });
    expect((await biz.handlers.bizSalesView(ctx, { date: '2026-11-27' })).summary.quarterActual).toBe(5);
  });

  it('calendar shows the day total of written rows on days without data', async () => {
    await biz.handlers.bizAddChange(ctx, { date: '2026-11-30', fields: { customer: '달력' }, delta: 12 });
    const { days } = await biz.handlers.bizCalendar(ctx, { month: '2026-11' });
    expect(days.find((d: any) => d.date === '2026-11-30')).toMatchObject({ hasSnapshot: false, dayDelta: 12 });
  });
});
