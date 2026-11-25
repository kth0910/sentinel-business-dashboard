// 업무 데이터 저장소(SQLite, litpage와 같은 DB 파일). 스냅샷·변동·구분·목표·날짜별 페이지.
import { DEFAULT_CATEGORIES, diffSnapshots, emptyTargets, type Category, type Change, type ChangeKind, type SalesRow, type Targets } from '@nc/biz';
import { newId } from '@nc/shared/ids.ts';
import { db, tx } from '../db.ts';

db.exec(`
CREATE TABLE IF NOT EXISTS biz_snapshot_day (date TEXT PRIMARY KEY, row_count INTEGER NOT NULL, imported_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS biz_snapshot (date TEXT NOT NULL, key TEXT NOT NULL, row_json TEXT NOT NULL, PRIMARY KEY (date, key));
CREATE TABLE IF NOT EXISTS biz_change (
  date TEXT NOT NULL, key TEXT NOT NULL, kind TEXT NOT NULL, category_id TEXT NOT NULL, manual INTEGER NOT NULL DEFAULT 0,
  delta INTEGER NOT NULL, change_json TEXT NOT NULL, PRIMARY KEY (date, key)
);
CREATE TABLE IF NOT EXISTS biz_category (id TEXT PRIMARY KEY, label TEXT NOT NULL, position INTEGER NOT NULL, system INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS biz_target (year INTEGER PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS biz_daily_page (date TEXT NOT NULL, kind TEXT NOT NULL, page_id TEXT NOT NULL, PRIMARY KEY (date, kind));
CREATE TABLE IF NOT EXISTS biz_kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`);

if (!(db.prepare('SELECT COUNT(*) AS n FROM biz_category').get() as { n: number }).n) {
  const ins = db.prepare('INSERT INTO biz_category (id, label, position, system) VALUES (?, ?, ?, ?)');
  for (const c of DEFAULT_CATEGORIES) ins.run(c.id, c.label, c.position, c.system ? 1 : 0);
}

const KIND_CATEGORY: Record<ChangeKind, string> = { new: 'new', confirm: 'confirm', exclude: 'exclude', raise: 'raise', unclassified: 'unclassified' };

export type StoredChange = Change & { categoryId: string; manual: boolean };

export function hasSnapshot(date: string): boolean {
  return !!db.prepare('SELECT 1 FROM biz_snapshot_day WHERE date = ?').get(date);
}

export function prevSnapshotDate(date: string): string | null {
  return (db.prepare('SELECT MAX(date) AS d FROM biz_snapshot_day WHERE date < ?').get(date) as { d: string | null }).d;
}

export function nextSnapshotDate(date: string): string | null {
  return (db.prepare('SELECT MIN(date) AS d FROM biz_snapshot_day WHERE date > ?').get(date) as { d: string | null }).d;
}

/** 그 날짜 또는 그 이전 가장 최근 스냅샷 날짜. */
export function latestSnapshotOnOrBefore(date: string): string | null {
  return (db.prepare('SELECT MAX(date) AS d FROM biz_snapshot_day WHERE date <= ?').get(date) as { d: string | null }).d;
}

export function snapshotRows(date: string): SalesRow[] | null {
  if (!hasSnapshot(date)) return null;
  return (db.prepare('SELECT row_json FROM biz_snapshot WHERE date = ?').all(date) as { row_json: string }[]).map((r) => JSON.parse(r.row_json));
}

function recompute(date: string) {
  const prev = prevSnapshotDate(date);
  const changes = diffSnapshots(prev ? snapshotRows(prev) : null, snapshotRows(date) ?? []);
  const manual = new Map(
    (db.prepare('SELECT key, category_id FROM biz_change WHERE date = ? AND manual = 1').all(date) as { key: string; category_id: string }[]).map((r) => [r.key, r.category_id]),
  );
  db.prepare('DELETE FROM biz_change WHERE date = ?').run(date);
  const ins = db.prepare('INSERT INTO biz_change (date, key, kind, category_id, manual, delta, change_json) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const c of changes) {
    const kept = manual.get(c.key);
    ins.run(date, c.key, c.kind, kept ?? KIND_CATEGORY[c.kind], kept ? 1 : 0, Math.round(c.delta), JSON.stringify(c));
  }
  return changes.length;
}

/** 그 날짜 스냅샷을 교체하고, 그 날짜와 바로 다음 스냅샷 날짜의 변동을 다시 계산한다. */
export function importSnapshot(date: string, rows: SalesRow[]): { changeCount: number; baseline: boolean } {
  return tx(() => {
    db.prepare('DELETE FROM biz_snapshot WHERE date = ?').run(date);
    const ins = db.prepare('INSERT INTO biz_snapshot (date, key, row_json) VALUES (?, ?, ?)');
    for (const r of rows) ins.run(date, r.key, JSON.stringify(r));
    db.prepare('INSERT INTO biz_snapshot_day (date, row_count, imported_at) VALUES (?, ?, ?) ON CONFLICT(date) DO UPDATE SET row_count = excluded.row_count, imported_at = excluded.imported_at')
      .run(date, rows.length, Date.now());
    const changeCount = recompute(date);
    const next = nextSnapshotDate(date);
    if (next) recompute(next);
    return { changeCount, baseline: prevSnapshotDate(date) === null };
  });
}

export function changesFor(date: string): StoredChange[] {
  const rows = db.prepare('SELECT category_id, manual, change_json FROM biz_change WHERE date = ? ORDER BY ABS(delta) DESC, key').all(date) as {
    category_id: string; manual: number; change_json: string;
  }[];
  return rows.map((r) => ({ ...(JSON.parse(r.change_json) as Change), categoryId: r.category_id, manual: r.manual === 1 }));
}

export function dayDelta(date: string): number {
  return (db.prepare('SELECT COALESCE(SUM(delta), 0) AS s FROM biz_change WHERE date = ?').get(date) as { s: number }).s;
}

export function snapshotDaysBetween(from: string, to: string): string[] {
  return (db.prepare('SELECT date FROM biz_snapshot_day WHERE date >= ? AND date <= ? ORDER BY date').all(from, to) as { date: string }[]).map((r) => r.date);
}

export function listCategories(): Category[] {
  return (db.prepare('SELECT id, label, position, system FROM biz_category ORDER BY position, label').all() as { id: string; label: string; position: number; system: number }[])
    .map((c) => ({ id: c.id, label: c.label, position: c.position, system: c.system === 1 }));
}

export function saveCategory(c: { id?: string; label: string }): Category {
  const label = c.label.trim();
  if (!label) throw new Error('구분 이름이 비어 있습니다');
  if (c.id && db.prepare('SELECT 1 FROM biz_category WHERE id = ?').get(c.id)) {
    db.prepare('UPDATE biz_category SET label = ? WHERE id = ?').run(label, c.id);
  } else {
    const max = (db.prepare("SELECT COALESCE(MAX(position), 0) AS p FROM biz_category WHERE id <> 'unclassified'").get() as { p: number }).p;
    db.prepare('INSERT INTO biz_category (id, label, position, system) VALUES (?, ?, ?, 0)').run(c.id ?? newId(), label, max + 1);
  }
  return listCategories().find((x) => x.label === label && (!c.id || x.id === c.id)) as Category;
}

export function deleteCategory(id: string): void {
  const row = db.prepare('SELECT system FROM biz_category WHERE id = ?').get(id) as { system: number } | undefined;
  if (!row) throw new Error('없는 구분입니다');
  if (row.system === 1) throw new Error('기본 구분은 삭제할 수 없습니다');
  tx(() => {
    db.prepare("UPDATE biz_change SET category_id = 'unclassified', manual = 1 WHERE category_id = ?").run(id);
    db.prepare('DELETE FROM biz_category WHERE id = ?').run(id);
  });
}

export function setChangeCategory(date: string, key: string, categoryId: string): void {
  if (!db.prepare('SELECT 1 FROM biz_category WHERE id = ?').get(categoryId)) throw new Error('없는 구분입니다');
  const res = db.prepare('UPDATE biz_change SET category_id = ?, manual = 1 WHERE date = ? AND key = ?').run(categoryId, date, key);
  if (!res.changes) throw new Error('해당 변동이 없습니다');
}

export function getTargets(year: number): Targets {
  const row = db.prepare('SELECT json FROM biz_target WHERE year = ?').get(year) as { json: string } | undefined;
  return row ? JSON.parse(row.json) : emptyTargets(year);
}

export function setTargets(t: Targets): void {
  db.prepare('INSERT INTO biz_target (year, json) VALUES (?, ?) ON CONFLICT(year) DO UPDATE SET json = excluded.json').run(t.year, JSON.stringify(t));
}

export function kvGet(k: string): string | null {
  return (db.prepare('SELECT v FROM biz_kv WHERE k = ?').get(k) as { v: string } | undefined)?.v ?? null;
}

export function kvSet(k: string, v: string): void {
  db.prepare('INSERT INTO biz_kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, v);
}

export function dailyPageId(date: string, kind: 'report' | 'sales'): string | null {
  return (db.prepare('SELECT page_id FROM biz_daily_page WHERE date = ? AND kind = ?').get(date, kind) as { page_id: string } | undefined)?.page_id ?? null;
}

export function setDailyPage(date: string, kind: 'report' | 'sales', pageId: string): void {
  db.prepare('INSERT INTO biz_daily_page (date, kind, page_id) VALUES (?, ?, ?) ON CONFLICT(date, kind) DO UPDATE SET page_id = excluded.page_id').run(date, kind, pageId);
}
