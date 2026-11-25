// 사용자 정의 업무 블록: 페이지의 블록을 이름 붙여 저장하고, '/' 업무 묶음에서 어디든 새로 복사해 넣는다.
// 저장한 내용은 기본 팀 아래 숨김 페이지('업무 블록 보관함', 사이드바·팀 목록에 넣지 않음)에 실제 블록으로 둔다.
// 저장·넣기 모두 litpage TreeCopier로 복사 → 데이터베이스·표·하위 블록까지 그대로, 원본을 고쳐도 저장본은 안 바뀐다.
import { newId } from '@nc/shared/ids.ts';
import type { BlockRecord, SpaceRecord } from '@nc/shared/records.ts';
import { db, getRecord } from '../db.ts';
import { TreeCopier } from '../dbcopy.ts';
import { applyTransactions, blockRole } from '../records.ts';
import * as store from './store.ts';

db.exec(`
CREATE TABLE IF NOT EXISTS biz_custom_block (
  id TEXT PRIMARY KEY, space_id TEXT NOT NULL, name TEXT NOT NULL, source_page_id TEXT NOT NULL,
  created_by TEXT NOT NULL, created_time INTEGER NOT NULL
);
`);

export interface CustomBlock { id: string; spaceId: string; name: string; sourcePageId: string; createdTime: number }

type Op = { pointer: { table: string; id: string; spaceId: string }; path: string[]; command: string; args: any };
const setOp = (table: string, record: { id: string }, spaceId: string): Op => ({ pointer: { table, id: record.id, spaceId }, path: [], command: 'set', args: record });

function commit(uid: string, spaceId: string, ops: Op[]) {
  applyTransactions(uid, [{ id: newId(), spaceId, debug: { userAction: 'bizCustomBlock' }, operations: ops } as any]);
}

function pageRecord(title: string, parentId: string, parentTable: string, spaceId: string, uid: string): BlockRecord {
  const now = Date.now();
  return {
    id: newId(), version: 0, type: 'page', properties: { title: [[title]] }, parent_id: parentId, parent_table: parentTable, space_id: spaceId, alive: true,
    created_time: now, created_by_id: uid, created_by_table: 'lit_user', last_edited_time: now, last_edited_by_id: uid, last_edited_by_table: 'lit_user',
  } as unknown as BlockRecord;
}

const alive = (id: string | null): id is string => !!id && getRecord<BlockRecord>('block', id)?.alive === true;

/** 보관함 페이지: 기본 팀 아래에 두되 팀 페이지 목록(team_pages)에는 넣지 않는다 → 사이드바에 안 보임. */
function container(uid: string, spaceId: string): string {
  const key = `custom_container:${spaceId}`;
  const existing = store.kvGet(key);
  if (alive(existing)) return existing;
  const teamId = getRecord<SpaceRecord>('space', spaceId)?.default_team_ids?.[0];
  if (!teamId) throw new Error('기본 팀이 없는 워크스페이스입니다');
  const page = pageRecord('업무 블록 보관함', teamId, 'team', spaceId, uid);
  commit(uid, spaceId, [setOp('block', page, spaceId)]);
  store.kvSet(key, page.id);
  return page.id;
}

const row = (r: any): CustomBlock => ({ id: r.id, spaceId: r.space_id, name: r.name, sourcePageId: r.source_page_id, createdTime: r.created_time });

export function listCustomBlocks(spaceId: string): CustomBlock[] {
  return (db.prepare('SELECT * FROM biz_custom_block WHERE space_id = ? ORDER BY created_time, rowid').all(spaceId) as any[])
    .filter((r) => alive(r.source_page_id))
    .map(row);
}

export function getCustomBlock(id: string): CustomBlock | null {
  const r = db.prepare('SELECT * FROM biz_custom_block WHERE id = ?').get(id);
  return r ? row(r) : null;
}

function cleanName(name: string): string {
  const n = (name ?? '').trim();
  if (!n) throw new Error('블록 이름이 필요합니다');
  if (n.length > 60) throw new Error('블록 이름은 60자까지입니다');
  return n;
}

export function saveCustomBlock(uid: string, spaceId: string, name: string, blockIds: string[]): CustomBlock {
  const label = cleanName(name);
  if (!blockIds?.length) throw new Error('저장할 블록이 없습니다');
  const blocks = blockIds.map((id) => getRecord<BlockRecord>('block', id));
  if (blocks.some((b) => !b || b.alive === false || b.space_id !== spaceId || blockRole(b.id, uid) === 'none')) throw new Error('저장할 수 없는 블록이 있습니다');
  const parent = container(uid, spaceId);
  const page = pageRecord(`업무 블록: ${label}`, parent, 'block', spaceId, uid);
  const copier = new TreeCopier(uid, spaceId, { rows: true });
  page.content = (blocks as BlockRecord[]).map((b) => copier.block(b, page.id, 'block'));
  const ops: Op[] = [setOp('block', page, spaceId), ...[...copier.finish().values()].map((e) => setOp(e.table, e.record as { id: string }, spaceId))];
  ops.push({ pointer: { table: 'block', id: parent, spaceId }, path: ['content'], command: 'listAfter', args: { id: page.id } });
  commit(uid, spaceId, ops);
  const id = newId();
  db.prepare('INSERT INTO biz_custom_block (id, space_id, name, source_page_id, created_by, created_time) VALUES (?, ?, ?, ?, ?, ?)').run(id, spaceId, label, page.id, uid, Date.now());
  return getCustomBlock(id)!;
}

export function renameCustomBlock(id: string, name: string): CustomBlock {
  const label = cleanName(name);
  if (!db.prepare('UPDATE biz_custom_block SET name = ? WHERE id = ?').run(label, id).changes) throw new Error('없는 블록입니다');
  return getCustomBlock(id)!;
}

/** 목록에서만 지운다(보관함의 저장본은 남아 있어도 보이지 않는다). */
export function deleteCustomBlock(id: string): void {
  db.prepare('DELETE FROM biz_custom_block WHERE id = ?').run(id);
}

/** 저장한 블록들을 targetBlockId 바로 뒤에 새로 복사해 넣고, 새 블록 id를 순서대로 돌려준다. */
export function insertCustomBlock(uid: string, id: string, targetBlockId: string): string[] {
  const c = getCustomBlock(id);
  if (!c || !alive(c.sourcePageId)) throw new Error('없는 블록입니다');
  const target = getRecord<BlockRecord>('block', targetBlockId);
  if (!target || target.alive === false || target.parent_table !== 'block' || target.space_id !== c.spaceId) throw new Error('여기에는 넣을 수 없습니다');
  const sources = (getRecord<BlockRecord>('block', c.sourcePageId)?.content ?? [])
    .map((k) => getRecord<BlockRecord>('block', k))
    .filter((b): b is BlockRecord => !!b && b.alive !== false);
  const copier = new TreeCopier(uid, c.spaceId, { rows: true });
  const ids = sources.map((b) => copier.block(b, target.parent_id, 'block'));
  const ops: Op[] = [...copier.finish().values()].map((e) => setOp(e.table, e.record as { id: string }, c.spaceId));
  let after = target.id;
  for (const nid of ids) {
    ops.push({ pointer: { table: 'block', id: target.parent_id, spaceId: c.spaceId }, path: ['content'], command: 'listAfter', args: { after, id: nid } });
    after = nid;
  }
  commit(uid, c.spaceId, ops);
  return ids;
}
