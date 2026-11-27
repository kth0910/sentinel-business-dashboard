// 업무 화면 RPC (POST /api/rpc/biz*). 로그인만 확인하고 권한은 따로 두지 않는다(설계 11.2).
// 매출 데이터를 넣는 RPC는 없다: 서버 명령(scripts/biz-import.ts)·API 동기화만 biz/importer.ts로 넣는다.
import { monthlyConfirmed, openPipeline, summarize, type Targets } from '@nc/biz';
import type { SpaceRecord } from '@nc/shared/records.ts';
import { getRecord } from '../../db.ts';
import { ensureDailyPage, type DailyKind } from '../../biz/pages.ts';
import * as custom from '../../biz/customBlocks.ts';
import * as store from '../../biz/store.ts';
import { ApiError, type Ctx } from '../handlers.ts';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

function requireUser(ctx: Ctx): string {
  if (!ctx.userId) throw new ApiError('Unauthorized', 401);
  return ctx.userId;
}

/** 이 사람이 멤버인 워크스페이스(아니면 404). */
function memberSpace(uid: string, spaceId: unknown): SpaceRecord {
  const space = getRecord<SpaceRecord>('space', String(spaceId ?? ''));
  if (!space || !space.permissions?.some((p) => p.user_id === uid && p.role !== 'none')) throw new ApiError('Not found', 404);
  return space;
}

function memberCustom(uid: string, id: unknown): custom.CustomBlock {
  const c = custom.getCustomBlock(String(id ?? ''));
  if (!c) throw new ApiError('Not found', 404);
  memberSpace(uid, c.spaceId);
  return c;
}

function dateArg(v: unknown): string {
  if (typeof v !== 'string' || !DATE_RE.test(v)) throw new ApiError('날짜 형식은 YYYY-MM-DD입니다', 400);
  return v;
}

function badRequest<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError((e as Error).message, 400);
  }
}

export const handlers = {
  async bizSalesView(ctx: Ctx, body: { date?: unknown }) {
    requireUser(ctx);
    const date = dateArg(body.date);
    const has = store.hasSnapshot(date);
    const basis = store.latestSnapshotOnOrBefore(date);
    const rows = (basis && store.snapshotRows(basis)) || [];
    const year = Number(date.slice(0, 4));
    const prevDate = store.prevSnapshotDate(date);
    const changes = has ? store.changesFor(date) : [];
    return {
      date, basisDate: basis, prevDate, hasSnapshot: has, baseline: has && prevDate === null,
      summary: summarize(rows, store.getTargets(year), date),
      dayDelta: has ? store.dayDelta(date) : 0,
      changes, categories: store.listCategories(), options: store.listOptions(rows),
      monthly: monthlyConfirmed(rows, year), monthTargets: store.getTargets(year).months,
      pipeline: openPipeline(rows),
    };
  },

  /** 직접 수정: value가 null이면 받아온 값으로 되돌린다. date(보고 있는 날짜)부터 적용 */
  async bizSetOverride(ctx: Ctx, body: { date?: unknown; key?: unknown; field?: unknown; value?: unknown }) {
    const uid = requireUser(ctx);
    const date = dateArg(body.date);
    const key = String(body.key ?? '');
    if (!key) throw new ApiError('영업 건이 없습니다', 400);
    if (body.value === null) store.clearOverride(key, String(body.field ?? ''));
    else badRequest(() => store.setOverride(key, String(body.field ?? ''), body.value, date, uid));
    return { ok: true };
  },

  /** 수정 창 저장: 칸 여러 개(fields, null이면 받아온 값)·구분(categoryId 또는 새 이름 categoryLabel)·증감액(delta, null이면 계산값) */
  async bizEditSale(ctx: Ctx, body: { date?: unknown; key?: unknown; fields?: unknown; categoryId?: unknown; categoryLabel?: unknown; delta?: unknown }) {
    const uid = requireUser(ctx);
    const date = dateArg(body.date);
    const key = String(body.key ?? '');
    if (!key) throw new ApiError('영업 건이 없습니다', 400);
    const fields = body.fields && typeof body.fields === 'object' ? (body.fields as store.SaleEdit['fields']) : undefined;
    const edit: store.SaleEdit = {
      fields,
      categoryId: typeof body.categoryId === 'string' ? body.categoryId : undefined,
      categoryLabel: typeof body.categoryLabel === 'string' ? body.categoryLabel : undefined,
      delta: body.delta === undefined ? undefined : (body.delta as number | null),
    };
    badRequest(() => store.editSale(date, key, edit, uid));
    return { ok: true };
  },

  async bizRemoveOption(ctx: Ctx, body: { field?: unknown; value?: unknown }) {
    requireUser(ctx);
    badRequest(() => store.removeOption(String(body.field ?? ''), String(body.value ?? '')));
    return { ok: true };
  },

  async bizCalendar(ctx: Ctx, body: { month?: unknown }) {
    requireUser(ctx);
    if (typeof body.month !== 'string' || !MONTH_RE.test(body.month)) throw new ApiError('월 형식은 YYYY-MM입니다', 400);
    const [y, m] = body.month.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const snaps = new Set(store.snapshotDaysBetween(`${body.month}-01`, `${body.month}-${String(last).padStart(2, '0')}`));
    const days = Array.from({ length: last }, (_, i) => {
      const date = `${body.month}-${String(i + 1).padStart(2, '0')}`;
      const hasSnapshot = snaps.has(date);
      return {
        date, hasSnapshot, dayDelta: hasSnapshot ? store.dayDelta(date) : 0,
        reportPageId: store.dailyPageId(date, 'report'), salesPageId: store.dailyPageId(date, 'sales'),
      };
    });
    return { days };
  },

  async bizEnsureDailyPage(ctx: Ctx, body: { spaceId?: unknown; date?: unknown; kind?: unknown }) {
    const uid = requireUser(ctx);
    const date = dateArg(body.date);
    if (body.kind !== 'report' && body.kind !== 'sales') throw new ApiError('kind는 report 또는 sales입니다', 400);
    const space = getRecord<SpaceRecord>('space', String(body.spaceId ?? ''));
    if (!space || !space.permissions?.some((p) => p.user_id === uid && p.role !== 'none')) throw new ApiError('Not found', 404);
    return { pageId: badRequest(() => ensureDailyPage(uid, space.id, date, body.kind as DailyKind)) };
  },

  async bizPageDate(ctx: Ctx, body: { pageId?: unknown }) {
    requireUser(ctx);
    const hit = store.dailyPageLookup(String(body.pageId ?? ''));
    return hit ? { date: hit.date, kind: hit.kind } : { date: null, kind: null };
  },

  async bizCategories(ctx: Ctx) {
    requireUser(ctx);
    return { categories: store.listCategories() };
  },

  async bizSaveCategory(ctx: Ctx, body: { id?: string; label?: unknown }) {
    requireUser(ctx);
    if (typeof body.label !== 'string') throw new ApiError('구분 이름이 필요합니다', 400);
    const category = badRequest(() => store.saveCategory({ id: body.id, label: body.label as string }));
    return { category, categories: store.listCategories() };
  },

  async bizDeleteCategory(ctx: Ctx, body: { id?: unknown }) {
    requireUser(ctx);
    badRequest(() => store.deleteCategory(String(body.id)));
    return { categories: store.listCategories() };
  },

  async bizSetChangeCategory(ctx: Ctx, body: { date?: unknown; key?: unknown; categoryId?: unknown }) {
    requireUser(ctx);
    const date = dateArg(body.date);
    badRequest(() => store.setChangeCategory(date, String(body.key), String(body.categoryId)));
    return { ok: true };
  },

  async bizGetTargets(ctx: Ctx, body: { year?: unknown }) {
    requireUser(ctx);
    return { targets: store.getTargets(Number(body.year)) };
  },

  // 사용자 정의 업무 블록(biz/customBlocks.ts): 워크스페이스 멤버만
  async bizCustomBlocks(ctx: Ctx, body: { spaceId?: unknown }) {
    const uid = requireUser(ctx);
    const space = memberSpace(uid, body.spaceId);
    return { blocks: custom.listCustomBlocks(space.id) };
  },

  async bizSaveCustomBlock(ctx: Ctx, body: { spaceId?: unknown; name?: unknown; blockIds?: unknown }) {
    const uid = requireUser(ctx);
    const space = memberSpace(uid, body.spaceId);
    const ids = Array.isArray(body.blockIds) ? body.blockIds.map(String) : [];
    return { block: badRequest(() => custom.saveCustomBlock(uid, space.id, String(body.name ?? ''), ids)) };
  },

  async bizRenameCustomBlock(ctx: Ctx, body: { id?: unknown; name?: unknown }) {
    const uid = requireUser(ctx);
    const c = memberCustom(uid, body.id);
    return { block: badRequest(() => custom.renameCustomBlock(c.id, String(body.name ?? ''))) };
  },

  async bizDeleteCustomBlock(ctx: Ctx, body: { id?: unknown }) {
    const uid = requireUser(ctx);
    const c = memberCustom(uid, body.id);
    custom.deleteCustomBlock(c.id);
    return { ok: true };
  },

  async bizInsertCustomBlock(ctx: Ctx, body: { id?: unknown; afterBlockId?: unknown }) {
    const uid = requireUser(ctx);
    const c = memberCustom(uid, body.id);
    return { ids: badRequest(() => custom.insertCustomBlock(uid, c.id, String(body.afterBlockId ?? ''))) };
  },

  async bizSetTargets(ctx: Ctx, body: Targets) {
    requireUser(ctx);
    const ok = Number.isInteger(body?.year) && Array.isArray(body.quarters) && body.quarters.length === 4 && Array.isArray(body.months) && body.months.length === 12;
    if (!ok) throw new ApiError('목표 형식이 올바르지 않습니다', 400);
    const t: Targets = { year: body.year, annual: Number(body.annual) || 0, quarters: body.quarters.map((v) => Number(v) || 0) as Targets['quarters'], months: body.months.map((v) => Number(v) || 0) };
    store.setTargets(t);
    return { targets: t };
  },
};
