// 날짜별 업무보고·매출 페이지 생성: 양식, 전일 복사, 건너뛴 날짜, 멱등성, 매출 블록 날짜.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { BlockRecord, TeamRecord } from '@nc/shared/records.ts';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-biz-pages-test-'));
process.env.NC_SCHEDULER = '0';

let pages: typeof import('../src/biz/pages.ts');
let db: typeof import('../src/db.ts');
let biz: typeof import('../src/api/modules/biz.ts');
let uid = '';
let spaceId = '';

const children = (id: string) => (db.getRecord<BlockRecord>('block', id)?.content ?? []).map((c) => db.getRecord<BlockRecord>('block', c) as BlockRecord);
const title = (id: string) => (db.getRecord<BlockRecord>('block', id)?.properties?.title ?? []).map((s) => s[0]).join('');

beforeAll(async () => {
  db = await import('../src/db.ts');
  const seed = await import('../src/seed.ts');
  pages = await import('../src/biz/pages.ts');
  biz = await import('../src/api/modules/biz.ts');
  uid = 'u-hong';
  seed.createUser(uid, 'hong@demo.test', '홍길동');
  spaceId = seed.createWorkspace(uid, '데모 회사').space.id;
});

describe('ensureDailyPage', () => {
  it('first report page uses template', () => {
    const id = pages.ensureDailyPage(uid, spaceId, '2026-11-20', 'report');
    expect(title(id)).toBe('업무보고 2026-11-20(금)');
    expect(children(id).map((b) => b.type)).toEqual(['header', 'biz_hiring', 'header', 'numbered_list', 'header', 'biz_schedule']);
    expect(children(id).filter((b) => b.type === 'header').map((b) => b.properties?.title?.[0]?.[0])).toEqual(['인사 관리', '주요 보고', '당일 일정']);
  });

  it('parent page lives in the default team', () => {
    const id = pages.ensureDailyPage(uid, spaceId, '2026-11-20', 'report');
    const parent = db.getRecord<BlockRecord>('block', db.getRecord<BlockRecord>('block', id)!.parent_id)!;
    expect(title(parent.id)).toBe('일일 업무보고');
    const team = db.getRecord<TeamRecord>('team', parent.parent_id)!;
    expect(team.team_pages).toContain(parent.id);
  });

  it('ensure is idempotent', () => {
    expect(pages.ensureDailyPage(uid, spaceId, '2026-11-20', 'report')).toBe(pages.ensureDailyPage(uid, spaceId, '2026-11-20', 'report'));
  });

  it('next day copies previous report and skips gaps', () => {
    const first = pages.ensureDailyPage(uid, spaceId, '2026-11-20', 'report');
    const hiring = children(first).find((b) => b.type === 'biz_hiring')!;
    db.putRecord('block', { ...hiring, version: hiring.version + 1, format: { biz: { sites: '사람인', rows: [{ role: '경영지원', status: 3, note: '전화면접 예정' }, { role: '엔지니어', status: 11, note: '' }], applicants: 14 } } } as any);
    const next = pages.ensureDailyPage(uid, spaceId, '2026-11-23', 'report');
    expect(next).not.toBe(first);
    expect(title(next)).toBe('업무보고 2026-11-23(월)');
    const copied = children(next).find((b) => b.type === 'biz_hiring')!;
    expect(copied.id).not.toBe(hiring.id);
    expect((copied.format as any).biz.applicants).toBe(14);
  });

  // 리뷰 #6: 일정은 그날 것만 (설계 5.2: 이어받는 건 직접 입력하는 채용 현황·주요 보고)
  it('next day starts with an empty schedule', () => {
    const prev = pages.ensureDailyPage(uid, spaceId, '2026-11-23', 'report');
    const sched = children(prev).find((b) => b.type === 'biz_schedule')!;
    db.putRecord('block', { ...sched, version: sched.version + 1, format: { biz: { items: [{ time: '10:00', title: '고객 미팅' }] } } } as any);
    const next = pages.ensureDailyPage(uid, spaceId, '2026-11-24', 'report');
    expect((children(next).find((b) => b.type === 'biz_schedule')!.format as any).biz).toEqual({ items: [] });
    expect((db.getRecord<BlockRecord>('block', sched.id)!.format as any).biz.items).toHaveLength(1);
  });

  it('sales blocks carry date', () => {
    const id = pages.ensureDailyPage(uid, spaceId, '2026-11-25', 'sales');
    expect(title(id)).toBe('본영업 목표매출 2026-11-25(수)');
    const kids = children(id);
    expect(kids.map((b) => b.type)).toEqual(['biz_sales_summary', 'biz_changes', 'biz_monthly_chart', 'biz_pipeline']);
    expect(kids.every((b) => (b.format as any).biz.date === '2026-11-25')).toBe(true);
    expect((db.getRecord<BlockRecord>('block', id)!.format as any).page_full_width).toBe(true);
  });

  it('rpc ensures page and reports page date', async () => {
    const ctx = { userId: uid, setCookie() {} } as any;
    const { pageId } = await biz.handlers.bizEnsureDailyPage(ctx, { spaceId, date: '2026-11-26', kind: 'report' });
    expect(await biz.handlers.bizPageDate(ctx, { pageId })).toEqual({ date: '2026-11-26', kind: 'report' });
    expect(await biz.handlers.bizPageDate(ctx, { pageId: 'nope' })).toEqual({ date: null, kind: null });
    await expect(biz.handlers.bizEnsureDailyPage(ctx, { spaceId, date: '2026-11-26', kind: 'other' })).rejects.toMatchObject({ status: 400 });
    await expect(biz.handlers.bizEnsureDailyPage({ userId: 'stranger', setCookie() {} } as any, { spaceId, date: '2026-11-26', kind: 'report' })).rejects.toMatchObject({ status: 404 });
  });
});
