// 값 목록 편집: 제품·매출 구분은 값 이름을 바꾸거나 지울 수 있고, 그 값을 쓰는 모든 건(모든 날짜)에 적용된다.
// 구분(변동 분류)은 이름 바꾸기·지우기, '미분류'는 못 바꾼다.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SalesRow } from '@nc/biz';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-biz-option-edit-test-'));
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
const rows = (date: string) => store.snapshotRows(date)!;
const opts = (date: string) => store.listOptions(rows(date));

beforeAll(async () => {
  store = await import('../src/biz/store.ts');
  biz = await import('../src/api/modules/biz.ts');
  store.importSnapshot('2026-11-24', [r(), r({ key: '2::B', code: 2, product: 'B', revenueType: '기반매출' })]);
  store.importSnapshot('2026-11-25', [r({ amount: 150 }), r({ key: '2::B', code: 2, product: 'B', revenueType: '기반매출' })]);
});

describe('rename a value', () => {
  it('renames it on every row of every date, without making fake changes', () => {
    store.renameOption('revenueType', '과업매출', '과업 매출');
    expect(rows('2026-11-24').find((x) => x.key === '1::A')!.revenueType).toBe('과업 매출');
    expect(rows('2026-11-25').find((x) => x.key === '1::A')!.revenueType).toBe('과업 매출');
    // 이름만 바뀐 것이라 변동 칸으로 잡히지 않는다
    expect(store.changesFor('2026-11-25').find((x) => x.key === '1::A')!.diffs.map((d) => d.field)).toEqual(['amount']);
    expect(opts('2026-11-25').revenueType.map((o) => o.value)).toEqual(['과업 매출', '기반매출']);
  });

  it('keeps applying to data received later', () => {
    store.importSnapshot('2026-11-26', [r({ amount: 150 }), r({ key: '2::B', code: 2, product: 'B', revenueType: '기반매출' })]);
    expect(rows('2026-11-26').find((x) => x.key === '1::A')!.revenueType).toBe('과업 매출');
  });

  it('a chain of renames ends at the last name; renaming back works', () => {
    store.renameOption('revenueType', '과업 매출', '과업');
    expect(rows('2026-11-26').find((x) => x.key === '1::A')!.revenueType).toBe('과업');
    store.renameOption('revenueType', '과업', '과업매출');
    expect(rows('2026-11-26').find((x) => x.key === '1::A')!.revenueType).toBe('과업매출');
  });

  it('renaming onto an existing value merges them', () => {
    store.renameOption('product', 'B', 'A');
    expect(opts('2026-11-25').product.map((o) => o.value)).toEqual(['A']);
    expect(opts('2026-11-25').product[0].count).toBe(2);
    store.renameOption('product', 'A', '제품 A');
    expect(rows('2026-11-25').map((x) => x.product)).toEqual(['제품 A', '제품 A']);
  });

  it('also renames values set by a direct edit', () => {
    store.setOverride('2::B', 'revenueType', '유지보수', '2026-11-25', 'u1');
    store.renameOption('revenueType', '유지보수', '유지보수매출');
    expect(rows('2026-11-25').find((x) => x.key === '2::B')!.revenueType).toBe('유지보수매출');
    store.clearOverride('2::B', 'revenueType');
  });

  it('rejects empty names and fields without editable lists', () => {
    expect(() => store.renameOption('revenueType', '기반매출', '  ')).toThrow();
    expect(() => store.renameOption('probability', '중A', '중')).toThrow();
  });
});

describe('delete a value', () => {
  it('empties it on every row that uses it and drops it from the list', () => {
    store.deleteOptionValue('revenueType', '기반매출');
    expect(rows('2026-11-25').find((x) => x.key === '2::B')!.revenueType).toBe('');
    expect(rows('2026-11-24').find((x) => x.key === '2::B')!.revenueType).toBe('');
    expect(opts('2026-11-25').revenueType.some((o) => o.value === '기반매출')).toBe(false);
  });

  it('values of editable lists can always be renamed and removed; others only when added and unused', () => {
    const o = opts('2026-11-25');
    expect(o.product[0]).toMatchObject({ editable: true, removable: true });
    expect(o.probability.find((x) => x.value === '중A')).toMatchObject({ editable: false, removable: false });
  });
});

describe('클라우드 태그', () => {
  it('follows the product name after direct edits and renames', () => {
    store.importSnapshot('2026-11-27', [r({ key: '5::C', code: 5, product: '서비스 C(Cloud)', isCloud: true })]);
    const c5 = () => rows('2026-11-27').find((x) => x.key === '5::C')!;
    expect(c5().isCloud).toBe(true);
    // 직접 고쳐 (Cloud)를 빼면 태그도 빠진다
    store.setOverride('5::C', 'product', '서비스 C', '2026-11-27', 'u1');
    expect(c5().isCloud).toBe(false);
    store.clearOverride('5::C', 'product');
    expect(c5().isCloud).toBe(true);
    // 목록에서 이름을 바꿔도 같다
    store.renameOption('product', '서비스 C(Cloud)', '서비스 C');
    expect(c5().isCloud).toBe(false);
    store.renameOption('product', '서비스 C', '서비스 C (cloud)');
    expect(c5().isCloud).toBe(true);
  });
});

describe('구분', () => {
  it('rename keeps the id; a duplicate name or 미분류 is refused', () => {
    store.saveCategory({ id: 'raise', label: '목표 상향' });
    expect(store.listCategories().find((c) => c.id === 'raise')!.label).toBe('목표 상향');
    expect(() => store.saveCategory({ id: 'raise', label: '신규매출' })).toThrow();
    expect(() => store.saveCategory({ id: 'unclassified', label: '기타' })).toThrow();
  });
});

describe('rpc', () => {
  it('bizRenameOption and bizRemoveOption need login and check input', async () => {
    await expect(biz.handlers.bizRenameOption({ userId: null, setCookie() {} } as any, { field: 'product', from: 'x', to: 'y' })).rejects.toMatchObject({ status: 401 });
    await expect(biz.handlers.bizRenameOption(ctx, { field: 'product', from: '제품 A', to: '' })).rejects.toMatchObject({ status: 400 });
    await biz.handlers.bizRenameOption(ctx, { field: 'product', from: '제품 A', to: '제품 가' });
    expect(rows('2026-11-25')[0].product).toBe('제품 가');
    await biz.handlers.bizRemoveOption(ctx, { field: 'product', value: '제품 가' });
    expect(rows('2026-11-25')[0].product).toBe('');
  });
});
