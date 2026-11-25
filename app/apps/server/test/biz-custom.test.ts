// 사용자 정의 업무 블록: 페이지의 블록을 이름 붙여 저장 → '/' 업무 묶음에서 어디든 넣는다.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { BlockRecord, TeamRecord, SpaceRecord } from '@nc/shared/records.ts';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-biz-custom-test-'));
process.env.NC_SCHEDULER = '0';

let db: typeof import('../src/db.ts');
let pages: typeof import('../src/biz/pages.ts');
let custom: typeof import('../src/biz/customBlocks.ts');
let biz: typeof import('../src/api/modules/biz.ts');
const uid = 'u-hong';
let spaceId = '';
let report = '';
let sales = '';

const kids = (id: string) => (db.getRecord<BlockRecord>('block', id)?.content ?? []).map((c) => db.getRecord<BlockRecord>('block', c)!);
const ctx = (userId: string | null) => ({ userId, setCookie() {} }) as any;

beforeAll(async () => {
  db = await import('../src/db.ts');
  const seed = await import('../src/seed.ts');
  pages = await import('../src/biz/pages.ts');
  custom = await import('../src/biz/customBlocks.ts');
  biz = await import('../src/api/modules/biz.ts');
  seed.createUser(uid, 'hong@demo.test', '홍길동');
  seed.createUser('stranger', 'x@demo.test', '외부인');
  spaceId = seed.createWorkspace(uid, '회사').space.id;
  report = pages.ensureDailyPage(uid, spaceId, '2026-11-20', 'report');
  sales = pages.ensureDailyPage(uid, spaceId, '2026-11-20', 'sales');
});

describe('custom blocks', () => {
  it('saves blocks under a name and lists them', () => {
    const [header, hiring] = kids(report);
    const c = custom.saveCustomBlock(uid, spaceId, ' 채용 묶음 ', [header.id, hiring.id]);
    expect(c.name).toBe('채용 묶음');
    expect(custom.listCustomBlocks(spaceId).map((x) => x.name)).toContain('채용 묶음');
  });

  it('keeps the saved copy out of the sidebar and independent of later edits', () => {
    const [c] = custom.listCustomBlocks(spaceId);
    const team = db.getRecord<TeamRecord>('team', db.getRecord<SpaceRecord>('space', spaceId)!.default_team_ids![0])!;
    const tpl = db.getRecord<BlockRecord>('block', c.sourcePageId)!;
    const container = db.getRecord<BlockRecord>('block', tpl.parent_id)!;
    expect(team.team_pages).not.toContain(container.id);
    expect(team.team_pages).not.toContain(tpl.id);
    expect(kids(tpl.id).map((b) => b.type)).toEqual(['header', 'biz_hiring']);
    expect(kids(tpl.id)[0].id).not.toBe(kids(report)[0].id);
  });

  it('inserts a fresh copy right after the target block', () => {
    const [c] = custom.listCustomBlocks(spaceId);
    const target = kids(sales)[0];
    const ids = custom.insertCustomBlock(uid, c.id, target.id);
    expect(ids).toHaveLength(2);
    const after = kids(sales).map((b) => b.id);
    expect(after.slice(after.indexOf(target.id) + 1, after.indexOf(target.id) + 3)).toEqual(ids);
    const hiring = db.getRecord<BlockRecord>('block', ids[1])!;
    expect(hiring.type).toBe('biz_hiring');
    expect((hiring.format as any).biz.rows.length).toBe(5);
    expect(hiring.parent_id).toBe(sales);
  });

  it('renames and deletes', () => {
    const [c] = custom.listCustomBlocks(spaceId);
    custom.renameCustomBlock(c.id, '인사 블록');
    expect(custom.listCustomBlocks(spaceId)[0].name).toBe('인사 블록');
    custom.deleteCustomBlock(c.id);
    expect(custom.listCustomBlocks(spaceId).some((x) => x.id === c.id)).toBe(false);
  });

  it('rejects an empty name and missing blocks', () => {
    const [header] = kids(report);
    expect(() => custom.saveCustomBlock(uid, spaceId, '  ', [header.id])).toThrow(/이름/);
    expect(() => custom.saveCustomBlock(uid, spaceId, '없는 블록', ['nope'])).toThrow();
    expect(() => custom.saveCustomBlock(uid, spaceId, '빈 목록', [])).toThrow();
  });

  it('rpc: only workspace members can save, list or insert', async () => {
    const [header] = kids(report);
    await expect(biz.handlers.bizSaveCustomBlock(ctx('stranger'), { spaceId, name: '남의 것', blockIds: [header.id] })).rejects.toMatchObject({ status: 404 });
    await expect(biz.handlers.bizCustomBlocks(ctx('stranger'), { spaceId })).rejects.toMatchObject({ status: 404 });
    const { block } = await biz.handlers.bizSaveCustomBlock(ctx(uid), { spaceId, name: '제목 하나', blockIds: [header.id] });
    expect((await biz.handlers.bizCustomBlocks(ctx(uid), { spaceId })).blocks.map((b: any) => b.id)).toContain(block.id);
    await expect(biz.handlers.bizInsertCustomBlock(ctx('stranger'), { id: block.id, afterBlockId: kids(sales)[0].id })).rejects.toMatchObject({ status: 404 });
    const { ids } = await biz.handlers.bizInsertCustomBlock(ctx(uid), { id: block.id, afterBlockId: kids(sales)[0].id });
    expect(ids).toHaveLength(1);
  });
});
