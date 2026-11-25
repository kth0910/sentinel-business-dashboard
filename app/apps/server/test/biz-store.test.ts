// 업무 데이터 저장소와 biz RPC: 스냅샷·변동 재계산, 구분 관리, 잘못된 엑셀 거부.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SalesRow } from '@nc/biz';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-biz-test-'));
process.env.NC_SCHEDULER = '0';

let store: typeof import('../src/biz/store.ts');
let biz: typeof import('../src/api/modules/biz.ts');
let importer: typeof import('../src/biz/importer.ts');

beforeAll(async () => {
  store = await import('../src/biz/store.ts');
  biz = await import('../src/api/modules/biz.ts');
  importer = await import('../src/biz/importer.ts');
});

function r(over: Partial<SalesRow> = {}): SalesRow {
  return {
    key: '1::A', code: 1, product: 'A', division: '본 영업', rep: '홍길동', customer: '고객사 A', contractor: '협력사 A',
    amount: 100, progress: '진행', contractDate: null, startDate: '2026-11-01', probability: '중A', isCloud: false, ...over,
  };
}

const ctx = { userId: 'u-test', setCookie() {} } as any;

describe('biz store', () => {
  it('first import is baseline', () => {
    expect(store.importSnapshot('2026-11-10', [r()])).toEqual({ changeCount: 0, baseline: true });
    expect(store.changesFor('2026-11-10')).toEqual([]);
  });

  it('second import produces changes', () => {
    expect(store.importSnapshot('2026-11-11', [r({ amount: 150 })])).toEqual({ changeCount: 1, baseline: false });
    const [c] = store.changesFor('2026-11-11');
    expect(c).toMatchObject({ key: '1::A', kind: 'raise', delta: 50, categoryId: 'raise', manual: false });
  });

  it('reimport same date keeps manual category', () => {
    store.setChangeCategory('2026-11-11', '1::A', 'advance');
    store.importSnapshot('2026-11-11', [r({ amount: 150 })]);
    const list = store.changesFor('2026-11-11');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ categoryId: 'advance', manual: true });
  });

  it('import between snapshots recomputes next date', () => {
    store.importSnapshot('2026-11-20', [r({ key: '9::X', amount: 100 })]);
    store.importSnapshot('2026-11-25', [r({ key: '9::X', amount: 300 })]);
    expect(store.changesFor('2026-11-25').find((c) => c.key === '9::X')?.delta).toBe(200);
    store.importSnapshot('2026-11-24', [r({ key: '9::X', amount: 250 })]);
    expect(store.changesFor('2026-11-25').find((c) => c.key === '9::X')?.delta).toBe(50);
  });

  it('monday compares to friday', () => {
    store.importSnapshot('2026-11-27', [r({ key: '7::M' })]);
    store.importSnapshot('2026-11-30', [r({ key: '7::M' })]);
    expect(store.prevSnapshotDate('2026-11-30')).toBe('2026-11-27');
    expect(store.prevSnapshotDate('2026-11-10')).toBeNull();
  });

  it('deleting category moves changes to unclassified', () => {
    const cat = store.saveCategory({ label: '임시 구분' });
    store.setChangeCategory('2026-11-11', '1::A', cat.id);
    store.deleteCategory(cat.id);
    expect(store.listCategories().some((c) => c.id === cat.id)).toBe(false);
    expect(store.changesFor('2026-11-11')[0].categoryId).toBe('unclassified');
  });

  it('system category cannot be deleted', () => {
    expect(() => store.deleteCategory('unclassified')).toThrow();
  });

  it('renames a category', () => {
    store.saveCategory({ id: 'advance', label: '매출일정 조정' });
    expect(store.listCategories().find((c) => c.id === 'advance')?.label).toBe('매출일정 조정');
  });

  it('targets round trip', () => {
    expect(store.getTargets(2031).annual).toBe(0);
    store.setTargets({ year: 2031, annual: 1200, quarters: [1, 2, 3, 4], months: Array(12).fill(7) });
    expect(store.getTargets(2031)).toEqual({ year: 2031, annual: 1200, quarters: [1, 2, 3, 4], months: Array(12).fill(7) });
  });
});

async function xlsx(rows: unknown[][]): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet0');
  for (const row of rows) ws.addRow(row);
  return Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
}

const HEAD = ['번호', '구분', '영업대표', '영업코드', '사용고객', '계약사', '제품/서비스', '공급가', '영업진행사항', '계약일', '로그수', '영업개시일', '마지막 로그일', '최종영업확도'];

describe('sales import and biz rpc', () => {
  it('import rejects bad file without writing', async () => {
    const fileBase64 = await xlsx([['번호', '구분'], [1, '본 영업']]);
    await expect(importer.importSalesFile('2026-12-01', Buffer.from(fileBase64, 'base64'))).rejects.toMatchObject({ status: 400 });
    expect(store.snapshotRows('2026-12-01')).toBeNull();
  });

  it('imports an xlsx and serves the sales view', async () => {
    const fileBase64 = await xlsx([HEAD, [1, '본 영업', '홍길동', 501, '고객사 B', '협력사 B', 'CF v4.0(Cloud)', 1000, '완료', '2026-12-02 00:00:00.0', 1, '2026-11-01', null, '확정']]);
    const res = await importer.importSalesFile('2026-12-02', Buffer.from(fileBase64, 'base64'));
    expect(res).toMatchObject({ date: '2026-12-02', rowCount: 1, baseline: false });
    const view = await biz.handlers.bizSalesView(ctx, { date: '2026-12-02' });
    expect(view.hasSnapshot).toBe(true);
    expect(view.prevDate).toBe('2026-11-30');
    expect(view.summary.monthActual).toBe(1000);
    expect(view.monthly[11]).toBe(1000);
    expect(view.categories.length).toBeGreaterThan(0);
  });

  it('rejects a malformed date', async () => {
    await expect(biz.handlers.bizSalesView(ctx, { date: '2026/12/02' })).rejects.toMatchObject({ status: 400 });
  });

  it('requires login', async () => {
    await expect(biz.handlers.bizCategories({ userId: null, setCookie() {} } as any, {})).rejects.toMatchObject({ status: 401 });
  });

  it('calendar lists snapshot days with delta', async () => {
    const { days } = await biz.handlers.bizCalendar(ctx, { month: '2026-11' });
    const d25 = days.find((d: any) => d.date === '2026-11-25');
    expect(d25).toMatchObject({ hasSnapshot: true, dayDelta: 50 });
    expect(days.find((d: any) => d.date === '2026-11-01')).toMatchObject({ hasSnapshot: false, dayDelta: 0 });
  });
});

// 리뷰 #4: 일부만 담긴(필터된) 엑셀이나 빈 엑셀이 '목표매출 제외'를 쏟아내지 않게
describe('partial export guard', () => {
  const row = (i: number) => [i, '본 영업', '홍길동', 800 + i, '고객사', '협력사', `제품 ${i}`, 1000, '진행', null, 1, '2026-11-01', null, '중A'];
  const many = (n: number) => Array.from({ length: n }, (_, i) => row(i));

  it('rejects a file with headers but no rows, writing nothing', async () => {
    const fileBase64 = await xlsx([HEAD]);
    await expect(importer.importSalesFile('2026-12-09', Buffer.from(fileBase64, 'base64'))).rejects.toMatchObject({ status: 400 });
    expect(store.snapshotRows('2026-12-09')).toBeNull();
  });

  it("asks before accepting a file missing many of yesterday's 본 영업 rows", async () => {
    await importer.importSalesFile('2026-12-10', Buffer.from(await xlsx([HEAD, ...many(50)]), 'base64'));
    const partial = await xlsx([HEAD, ...many(5)]);
    await expect(importer.importSalesFile('2026-12-11', Buffer.from(partial, 'base64'))).rejects.toMatchObject({ status: 409 });
    expect(store.snapshotRows('2026-12-11')).toBeNull();
    const res = await importer.importSalesFile('2026-12-11', Buffer.from(partial, 'base64'), { force: true });
    expect(res).toMatchObject({ rowCount: 5, missingCount: 45, changeCount: 45 });
  });

  it('a few missing rows go through without asking', async () => {
    await importer.importSalesFile('2026-12-12', Buffer.from(await xlsx([HEAD, ...many(50)]), 'base64'));
    const res = await importer.importSalesFile('2026-12-13', Buffer.from(await xlsx([HEAD, ...many(50).slice(1)]), 'base64'));
    expect(res).toMatchObject({ rowCount: 49, missingCount: 1 });
  });
});

// 리뷰 #2: 지운 기본 구분을 가리키는 변동이 생기지 않는다 (파일 맨 끝: 다른 테스트에 영향 없게)
describe('deleted default category', () => {
  it('later auto-classified changes fall back to unclassified', () => {
    store.importSnapshot('2027-01-04', [r({ key: '7::Z', amount: 100 })]);
    store.deleteCategory('raise');
    store.importSnapshot('2027-01-05', [r({ key: '7::Z', amount: 200 })]);
    const [c] = store.changesFor('2027-01-05');
    expect(c.kind).toBe('raise');
    expect(c.categoryId).toBe('unclassified');
  });
});

// 목업: 엑셀에 없는 가중치·매출 구분·매출일정은 올릴 때 채워지고, 같은 파일을 다음 날 올려도 변동이 생기지 않는다
describe('mock extras on upload', () => {
  it('fills weight, revenue type and date, and the same file the next day has no changes', async () => {
    const file = await xlsx([HEAD, [1, '본 영업', '홍길동', 9001, '고객사', '협력사', '목업 제품', 1000, '진행', null, 1, '2026-11-01', null, '중A']]);
    await importer.importSalesFile('2027-02-01', Buffer.from(file, 'base64'));
    const [row] = store.snapshotRows('2027-02-01')!;
    expect(row.weight).toBeTruthy();
    expect(row.revenueType).toBeTruthy();
    expect(row.revenueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const res = await importer.importSalesFile('2027-02-02', Buffer.from(file, 'base64'));
    expect(res.changeCount).toBe(0);
  });
});

// 엑셀 업로드 화면 기능은 뺐다: 업로드 RPC가 없어야 로그인한 아무나 매출 데이터를 덮어쓰지 못한다
describe('no upload rpc', () => {
  it('bizImportSales is gone', () => {
    expect('bizImportSales' in biz.handlers).toBe(false);
  });
});
