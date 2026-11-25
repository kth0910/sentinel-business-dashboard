// 날짜별 업무보고·매출 페이지. 업무보고는 직전 날짜 페이지를 복사(전일 내용 반영), 없으면 양식으로 만든다.
import { newId } from '@nc/shared/ids.ts';
import type { BlockRecord, BlockType, ParentTable, SpaceRecord } from '@nc/shared/records.ts';
import type { RichText } from '@nc/shared/richtext.ts';
import { getRecord } from '../db.ts';
import { TreeCopier } from '../dbcopy.ts';
import { applyTransactions } from '../records.ts';
import * as store from './store.ts';

export type DailyKind = 'report' | 'sales';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const PARENT_TITLE: Record<DailyKind, string> = { report: '일일 업무보고', sales: '본영업 목표매출 관리 현황' };
const PAGE_PREFIX: Record<DailyKind, string> = { report: '업무보고', sales: '본영업 목표매출' };
const DEFAULT_HIRING_ROLES = ['전략기획실', '엔지니어', '경리 및 총무', '경영지원', '병역일터'];

export function dailyTitle(date: string, kind: DailyKind): string {
  return `${PAGE_PREFIX[kind]} ${date}(${WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]})`;
}

interface Spec { type: BlockType; title?: string; format?: Record<string, unknown> }

function reportTemplate(): Spec[] {
  return [
    { type: 'header', title: '인사 관리' },
    { type: 'biz_hiring', format: { biz: { sites: '', rows: DEFAULT_HIRING_ROLES.map((role) => ({ id: newId(), role, status: '해당자 없음', note: '' })), applicants: null } } },
    { type: 'header', title: '주요 보고' },
    { type: 'numbered_list' },
    { type: 'header', title: '당일 일정' },
    { type: 'biz_schedule', format: { biz: { items: [] } } },
  ];
}

function salesTemplate(date: string): Spec[] {
  return (['biz_sales_summary', 'biz_changes', 'biz_monthly_chart', 'biz_pipeline'] as BlockType[]).map((type) => ({ type, format: { biz: { date } } }));
}

type Op = { pointer: { table: string; id: string; spaceId: string }; path: string[]; command: string; args: any };

function block(type: BlockType, parentId: string, parentTable: ParentTable, spaceId: string, uid: string, extra: Partial<BlockRecord> = {}): BlockRecord {
  const now = Date.now();
  return {
    id: newId(), version: 0, type, properties: {}, parent_id: parentId, parent_table: parentTable, space_id: spaceId, alive: true,
    created_time: now, created_by_id: uid, created_by_table: 'lit_user', last_edited_time: now, last_edited_by_id: uid, last_edited_by_table: 'lit_user',
    ...extra,
  } as BlockRecord;
}

const rt = (s: string): RichText => [[s]];
const setOp = (table: string, record: { id: string }, spaceId: string): Op => ({ pointer: { table, id: record.id, spaceId }, path: [], command: 'set', args: record });

function pageWithContent(title: string, specs: Spec[], parentId: string, parentTable: ParentTable, spaceId: string, uid: string, fullWidth = false): { id: string; ops: Op[] } {
  const page = block('page', parentId, parentTable, spaceId, uid, { properties: { title: rt(title) }, ...(fullWidth ? { format: { page_full_width: true } as any } : {}) });
  const kids = specs.map((s) => block(s.type, page.id, 'block', spaceId, uid, { properties: s.title ? { title: rt(s.title) } : {}, ...(s.format ? { format: s.format as any } : {}) }));
  page.content = kids.map((k) => k.id);
  return { id: page.id, ops: [setOp('block', page, spaceId), ...kids.map((k) => setOp('block', k, spaceId))] };
}

function commit(uid: string, spaceId: string, ops: Op[]) {
  applyTransactions(uid, [{ id: newId(), spaceId, debug: { userAction: 'bizDailyPage' }, operations: ops } as any]);
}

const alive = (id: string | null): id is string => !!id && getRecord<BlockRecord>('block', id)?.alive === true;

function ensureParent(uid: string, spaceId: string, kind: DailyKind): string {
  const kvKey = `parent:${kind}:${spaceId}`;
  const existing = store.kvGet(kvKey);
  if (alive(existing)) return existing;
  const space = getRecord<SpaceRecord>('space', spaceId);
  const teamId = space?.default_team_ids?.[0];
  if (!teamId) throw new Error('기본 팀이 없는 워크스페이스입니다');
  const { id, ops } = pageWithContent(PARENT_TITLE[kind], [], teamId, 'team', spaceId, uid);
  ops.push({ pointer: { table: 'team', id: teamId, spaceId }, path: ['team_pages'], command: 'listAfter', args: { id } });
  commit(uid, spaceId, ops);
  store.kvSet(kvKey, id);
  return id;
}

export function ensureDailyPage(uid: string, spaceId: string, date: string, kind: DailyKind): string {
  const existing = store.dailyPageId(date, kind);
  if (alive(existing)) return existing;
  const parentId = ensureParent(uid, spaceId, kind);
  const title = dailyTitle(date, kind);
  let id: string;
  let ops: Op[];
  const prev = kind === 'report' ? store.latestDailyPageBefore(date, kind) : null;
  if (prev && alive(prev.pageId)) {
    const copier = new TreeCopier(uid, spaceId, { rows: true });
    id = copier.block(getRecord<BlockRecord>('block', prev.pageId) as BlockRecord, parentId, 'block');
    ops = [...copier.finish().values()].map((e) => setOp(e.table, e.record as { id: string }, spaceId));
    const top = ops.find((o) => o.args.id === id);
    if (top) top.args.properties = { ...top.args.properties, title: rt(title) };
    // 일정은 그날 것만: 복사한 일정 블록은 비운다 (설계 5.2, 리뷰 #6)
    for (const o of ops) if (o.args.type === 'biz_schedule') o.args.format = { ...o.args.format, biz: { items: [] } };
  } else {
    ({ id, ops } = pageWithContent(title, kind === 'report' ? reportTemplate() : salesTemplate(date), parentId, 'block', spaceId, uid, kind === 'sales'));
  }
  ops.push({ pointer: { table: 'block', id: parentId, spaceId }, path: ['content'], command: 'listAfter', args: { id } });
  commit(uid, spaceId, ops);
  store.setDailyPage(date, kind, id);
  return id;
}
