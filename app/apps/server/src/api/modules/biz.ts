// 업무 화면 RPC (POST /api/rpc/biz*). 로그인만 확인하고 권한은 따로 두지 않는다(설계 11.2).
import { monthlyConfirmed, normalizeRows, openPipeline, SalesImportError, summarize, type Targets } from '@nc/biz';
import { readFirstSheet } from '../../biz/excel.ts';
import * as store from '../../biz/store.ts';
import { ApiError, type Ctx } from '../handlers.ts';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

function requireUser(ctx: Ctx): string {
  if (!ctx.userId) throw new ApiError('Unauthorized', 401);
  return ctx.userId;
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
  async bizImportSales(ctx: Ctx, body: { date?: unknown; fileBase64?: unknown }) {
    requireUser(ctx);
    const date = dateArg(body.date);
    if (typeof body.fileBase64 !== 'string' || !body.fileBase64) throw new ApiError('엑셀 파일이 없습니다', 400);
    let table: unknown[][];
    try {
      table = await readFirstSheet(Buffer.from(body.fileBase64, 'base64'));
    } catch {
      throw new ApiError('엑셀 파일을 읽을 수 없습니다(.xlsx만 지원)', 400);
    }
    let parsed: ReturnType<typeof normalizeRows>;
    try {
      parsed = normalizeRows(table);
    } catch (e) {
      if (e instanceof SalesImportError) throw new ApiError(e.message, 400);
      throw e;
    }
    const res = store.importSnapshot(date, parsed.rows);
    return { date, rowCount: parsed.rows.length, ...res, warnings: parsed.warnings };
  },

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
      changes, categories: store.listCategories(),
      monthly: monthlyConfirmed(rows, year), monthTargets: store.getTargets(year).months,
      pipeline: openPipeline(rows),
    };
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

  async bizSetTargets(ctx: Ctx, body: Targets) {
    requireUser(ctx);
    const ok = Number.isInteger(body?.year) && Array.isArray(body.quarters) && body.quarters.length === 4 && Array.isArray(body.months) && body.months.length === 12;
    if (!ok) throw new ApiError('목표 형식이 올바르지 않습니다', 400);
    const t: Targets = { year: body.year, annual: Number(body.annual) || 0, quarters: body.quarters.map((v) => Number(v) || 0) as Targets['quarters'], months: body.months.map((v) => Number(v) || 0) };
    store.setTargets(t);
    return { targets: t };
  },
};
