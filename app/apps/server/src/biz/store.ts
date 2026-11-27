// 업무 데이터 저장소(SQLite, litpage와 같은 DB 파일). 스냅샷·변동·구분·목표·날짜별 페이지.
import { ACTUAL_PERIODS, DEFAULT_CATEGORIES, diffSnapshots, EDITABLE_FIELDS, emptyTargets, isCloudProduct, MAIN_DIVISION, MANAGED_OPTION_FIELDS, OPTION_FIELDS, type ActualPeriod, type Category, type Change, type ChangeKind, type EditableField, type OptionField, type OptionItem, type SalesRow, type Summary, type Targets } from '@nc/biz';
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
CREATE TABLE IF NOT EXISTS biz_override (
  key TEXT NOT NULL, field TEXT NOT NULL, value_json TEXT NOT NULL, from_date TEXT NOT NULL,
  edited_by TEXT, edited_time INTEGER NOT NULL, PRIMARY KEY (key, field)
);
CREATE TABLE IF NOT EXISTS biz_delta_edit (date TEXT NOT NULL, key TEXT NOT NULL, delta INTEGER NOT NULL, edited_by TEXT, edited_time INTEGER NOT NULL, PRIMARY KEY (date, key));
CREATE TABLE IF NOT EXISTS biz_option (field TEXT NOT NULL, value TEXT NOT NULL, added_time INTEGER NOT NULL, PRIMARY KEY (field, value));
-- 값 이름 바꾸기·지우기: 받아온 값(from_value)을 to_value로 보여 준다('' = 지움). to_value는 늘 최종 이름
-- 직접 적은 변동 행(받아온 데이터와 무관). data_json은 영업 건 칸 일부
CREATE TABLE IF NOT EXISTS biz_manual_change (id TEXT PRIMARY KEY, date TEXT NOT NULL, position INTEGER NOT NULL, data_json TEXT NOT NULL, category_id TEXT NOT NULL, delta INTEGER NOT NULL DEFAULT 0, created_by TEXT, created_time INTEGER NOT NULL);
-- 표에서 지운 받아온 변동(다시 받아도 숨김)
CREATE TABLE IF NOT EXISTS biz_change_hidden (date TEXT NOT NULL, key TEXT NOT NULL, hidden_by TEXT, hidden_time INTEGER NOT NULL, PRIMARY KEY (date, key));
-- 직접 입력한 실적: 그 날짜부터 같은 기간(연·분기·월) 끝까지 적용. value NULL = 그 날짜부터 계산값
CREATE TABLE IF NOT EXISTS biz_actual_edit (date TEXT NOT NULL, period TEXT NOT NULL, value INTEGER, edited_by TEXT, edited_time INTEGER NOT NULL, PRIMARY KEY (date, period));
CREATE TABLE IF NOT EXISTS biz_value_map (field TEXT NOT NULL, from_value TEXT NOT NULL, to_value TEXT NOT NULL, PRIMARY KEY (field, from_value));
`);

if (!(db.prepare('SELECT COUNT(*) AS n FROM biz_category').get() as { n: number }).n) {
  const ins = db.prepare('INSERT INTO biz_category (id, label, position, system) VALUES (?, ?, ?, ?)');
  for (const c of DEFAULT_CATEGORIES) ins.run(c.id, c.label, c.position, c.system ? 1 : 0);
}

const KIND_CATEGORY: Record<ChangeKind, string> = { new: 'new', confirm: 'confirm', exclude: 'exclude', raise: 'raise', advance: 'advance', unclassified: 'unclassified' };

/** delta는 실제로 쓰는 값(직접 넣었으면 그 값). 직접 넣었을 때만 autoDelta에 계산값이 있다. entry = 직접 적은 행 */
export type StoredChange = Change & { categoryId: string; manual: boolean; autoDelta?: number; entry?: boolean };

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

/** 값 이름 바꾸기·지우기를 받아온 행에 적용한다. */
function applyValueMap(rows: SalesRow[]): SalesRow[] {
  const maps = db.prepare('SELECT field, from_value, to_value FROM biz_value_map').all() as { field: string; from_value: string; to_value: string }[];
  if (!maps.length) return rows;
  const byField = new Map<string, Map<string, string>>();
  for (const m of maps) byField.set(m.field, (byField.get(m.field) ?? new Map()).set(m.from_value, m.to_value));
  return rows.map((row) => {
    let out: SalesRow | null = null;
    for (const [field, map] of byField) {
      const v = (row as any)[field];
      if (typeof v === 'string' && map.has(v)) (out ??= { ...row } as any)[field] = map.get(v);
    }
    return out ?? row;
  });
}

/** 그 날짜 데이터(값 이름 바꾸기와 직접 수정한 값을 적용한 것). 원래 값은 row.edited에 남긴다.
 *  클라우드 태그는 최종 제품 이름으로 다시 판단한다. */
export function snapshotRows(date: string): SalesRow[] | null {
  const rows = editedRows(date);
  return rows && rows.map((r) => (r.isCloud === isCloudProduct(r.product) ? r : { ...r, isCloud: !r.isCloud }));
}

function editedRows(date: string): SalesRow[] | null {
  if (!hasSnapshot(date)) return null;
  const rows = applyValueMap((db.prepare('SELECT row_json FROM biz_snapshot WHERE date = ?').all(date) as { row_json: string }[]).map((r) => JSON.parse(r.row_json) as SalesRow));
  const ov = db.prepare('SELECT key, field, value_json FROM biz_override WHERE from_date <= ?').all(date) as { key: string; field: string; value_json: string }[];
  if (!ov.length) return rows;
  const byKey = new Map<string, { field: string; value: unknown }[]>();
  for (const o of ov) byKey.set(o.key, [...(byKey.get(o.key) ?? []), { field: o.field, value: JSON.parse(o.value_json) }]);
  return rows.map((row) => {
    const list = byKey.get(row.key);
    if (!list) return row;
    const out: any = { ...row, edited: {} };
    for (const { field, value } of list) {
      out.edited[field] = (row as any)[field] ?? null;
      out[field] = value;
    }
    return out as SalesRow;
  });
}

// ---------- 직접 수정 ---------
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function checkOverride(field: string, value: unknown): string | number | null {
  const kind = (EDITABLE_FIELDS as Record<string, string>)[field];
  if (!kind) throw new Error('고칠 수 없는 칸입니다');
  if (kind === 'number') {
    const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[,원\s]/g, ''));
    if (!Number.isFinite(n) || n < 0) throw new Error('0 이상의 숫자를 넣으세요');
    return Math.round(n);
  }
  const s = String(value ?? '').trim();
  if (kind === 'date') {
    if (!s) return null;
    if (!DATE_ONLY.test(s)) throw new Error('날짜는 YYYY-MM-DD로 넣으세요');
    return s;
  }
  if (s.length > 200) throw new Error('200자까지 넣을 수 있습니다');
  return s;
}

/** fromDate와 그 뒤 모든 날짜의 변동을 다시 계산한다(수정값이 양쪽 날짜에 들어가거나 빠지므로). */
function recomputeFrom(fromDate: string) {
  const first = latestSnapshotOnOrBefore(fromDate) ?? fromDate;
  for (const d of (db.prepare('SELECT date FROM biz_snapshot_day WHERE date >= ? ORDER BY date').all(first) as { date: string }[])) recompute(d.date);
}

/** 수정값 하나를 쓰고, 다시 계산을 시작할 날짜를 돌려준다(이전 수정이 더 이른 날짜부터였으면 그 날짜). */
function writeOverride(key: string, field: string, v: string | number | null, fromDate: string, uid: string | null): string {
  const old = db.prepare('SELECT from_date FROM biz_override WHERE key = ? AND field = ?').get(key, field) as { from_date: string } | undefined;
  db.prepare(`INSERT INTO biz_override (key, field, value_json, from_date, edited_by, edited_time) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(key, field) DO UPDATE SET value_json = excluded.value_json, from_date = excluded.from_date, edited_by = excluded.edited_by, edited_time = excluded.edited_time`)
    .run(key, field, JSON.stringify(v), fromDate, uid, Date.now());
  if (typeof v === 'string' && v && (OPTION_FIELDS as readonly string[]).includes(field)) addOption(field as OptionField, v);
  return old && old.from_date < fromDate ? old.from_date : fromDate;
}

function deleteOverride(key: string, field: string): string | null {
  const old = db.prepare('SELECT from_date FROM biz_override WHERE key = ? AND field = ?').get(key, field) as { from_date: string } | undefined;
  if (!old) return null;
  db.prepare('DELETE FROM biz_override WHERE key = ? AND field = ?').run(key, field);
  return old.from_date;
}

export function setOverride(key: string, field: EditableField | string, value: unknown, fromDate: string, uid: string | null): void {
  const v = checkOverride(field, value);
  tx(() => recomputeFrom(writeOverride(key, field, v, fromDate, uid)));
}

export function clearOverride(key: string, field: string): void {
  tx(() => {
    const from = deleteOverride(key, field);
    if (from) recomputeFrom(from);
  });
}

export interface SaleEdit {
  /** 칸 → 새 값(null이면 받아온 값으로) */
  fields?: Partial<Record<EditableField, string | number | null>>;
  /** 있는 구분 id */
  categoryId?: string;
  /** 새 구분 이름(같은 이름이 있으면 그 구분) */
  categoryLabel?: string;
  /** 직접 넣는 증감액(null이면 계산값으로) */
  delta?: number | null;
}

function parseFields(edit: SaleEdit) {
  return Object.entries(edit.fields ?? {}).map(([f, v]) => {
    if (!(f in EDITABLE_FIELDS)) throw new Error('고칠 수 없는 칸입니다');
    return [f as EditableField, v === null ? null : checkOverride(f, v)] as const;
  });
}

function parseDelta(delta: unknown): number | null | undefined {
  if (delta === undefined || delta === null) return delta as null | undefined;
  const n = typeof delta === 'number' ? delta : Number(String(delta).replace(/[,원\s]/g, ''));
  if (!Number.isFinite(n)) throw new Error('증감액은 숫자로 넣으세요');
  return Math.round(n);
}

/** 구분 id(새 이름이면 만든다). 정하지 않았으면 undefined */
function resolveCategory(edit: SaleEdit): string | undefined {
  if (edit.categoryLabel !== undefined) {
    const label = edit.categoryLabel.trim();
    return listCategories().find((c) => c.label === label)?.id ?? saveCategory({ label }).id;
  }
  if (edit.categoryId !== undefined) {
    if (!db.prepare('SELECT 1 FROM biz_category WHERE id = ?').get(edit.categoryId)) throw new Error('없는 구분입니다');
    return edit.categoryId;
  }
  return undefined;
}

/** 수정 창 저장: 칸 여러 개·구분·증감액을 한 번에(하나라도 잘못되면 아무것도 바꾸지 않는다). 직접 적은 행(m:…)도 같은 입구. */
export function editSale(date: string, key: string, edit: SaleEdit, uid: string | null): void {
  if (key.startsWith(MANUAL_PREFIX)) return editManualChange(date, key, edit);
  const fields = parseFields(edit);
  const delta = parseDelta(edit.delta);
  tx(() => {
    if (fields.length) {
      if (!(snapshotRows(date) ?? []).some((r) => r.key === key)) throw new Error('이 날짜 데이터에 없는 건이라 값을 고칠 수 없습니다');
      let from: string | null = null;
      for (const [f, v] of fields) {
        const d = v === null ? deleteOverride(key, f) : writeOverride(key, f, v, date, uid);
        if (d && (!from || d < from)) from = d;
      }
      if (from) recomputeFrom(from);
    }
    const cat = resolveCategory(edit);
    if (cat) setChangeCategory(date, key, cat);
    if (delta === null) db.prepare('DELETE FROM biz_delta_edit WHERE date = ? AND key = ?').run(date, key);
    else if (delta !== undefined) {
      if (!db.prepare('SELECT 1 FROM biz_change WHERE date = ? AND key = ?').get(date, key)) throw new Error('해당 변동이 없습니다');
      db.prepare(`INSERT INTO biz_delta_edit (date, key, delta, edited_by, edited_time) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(date, key) DO UPDATE SET delta = excluded.delta, edited_by = excluded.edited_by, edited_time = excluded.edited_time`).run(date, key, delta, uid, Date.now());
    }
  });
}

// ---------- 값 목록 ----------
function optionField(field: string): OptionField {
  if (!(OPTION_FIELDS as readonly string[]).includes(field)) throw new Error('값 목록이 없는 칸입니다');
  return field as OptionField;
}

export function addOption(field: OptionField, value: string): void {
  const v = value.trim();
  if (v) db.prepare('INSERT OR IGNORE INTO biz_option (field, value, added_time) VALUES (?, ?, ?)').run(optionField(field), v, Date.now());
}

/** 목록에서 지우기. 편집 칸(제품·매출 구분)은 그 값을 쓰는 건에서도 값을 비운다. */
export function removeOption(field: string, value: string): void {
  if ((MANAGED_OPTION_FIELDS as readonly string[]).includes(field)) return deleteOptionValue(field, value);
  db.prepare('DELETE FROM biz_option WHERE field = ? AND value = ?').run(optionField(field), value);
}

function managedField(field: string): OptionField {
  if (!(MANAGED_OPTION_FIELDS as readonly string[]).includes(field)) throw new Error('이름을 바꿀 수 없는 칸입니다');
  return field as OptionField;
}

/** from을 to로 바꾼다(받아온 값·직접 고친 값·목록 모두). to가 ''이면 지움. 모든 날짜의 변동을 다시 계산한다. */
function remapValue(field: OptionField, from: string, to: string): void {
  tx(() => {
    db.prepare('UPDATE biz_value_map SET to_value = ? WHERE field = ? AND to_value = ?').run(to, field, from);
    db.prepare('INSERT INTO biz_value_map (field, from_value, to_value) VALUES (?, ?, ?) ON CONFLICT(field, from_value) DO UPDATE SET to_value = excluded.to_value').run(field, from, to);
    db.prepare('DELETE FROM biz_value_map WHERE field = ? AND from_value = to_value').run(field);
    db.prepare('UPDATE biz_override SET value_json = ? WHERE field = ? AND value_json = ?').run(JSON.stringify(to), field, JSON.stringify(from));
    const listed = db.prepare('DELETE FROM biz_option WHERE field = ? AND value = ?').run(field, from).changes > 0;
    if (listed && to) addOption(field, to);
    for (const m of db.prepare('SELECT id, data_json FROM biz_manual_change').all() as { id: string; data_json: string }[]) {
      const data = JSON.parse(m.data_json);
      if (data[field] === from) db.prepare('UPDATE biz_manual_change SET data_json = ? WHERE id = ?').run(JSON.stringify({ ...data, [field]: to }), m.id);
    }
    const first = (db.prepare('SELECT MIN(date) AS d FROM biz_snapshot_day').get() as { d: string | null }).d;
    if (first) recomputeFrom(first);
  });
}

export function renameOption(field: string, from: string, to: string): void {
  const f = managedField(field);
  const name = to.trim();
  if (!name) throw new Error('이름이 비어 있습니다');
  if (name.length > 200) throw new Error('200자까지 넣을 수 있습니다');
  if (name !== from) remapValue(f, from, name);
}

export function deleteOptionValue(field: string, value: string): void {
  remapValue(managedField(field), value, '');
}

/** 칸마다 고를 값: 데이터에 있는 값 + 추가한 값(가나다순). */
export function listOptions(rows: SalesRow[]): Record<OptionField, OptionItem[]> {
  const added = db.prepare('SELECT field, value FROM biz_option').all() as { field: string; value: string }[];
  const out = {} as Record<OptionField, OptionItem[]>;
  for (const f of OPTION_FIELDS) {
    const managed = (MANAGED_OPTION_FIELDS as readonly string[]).includes(f);
    const counts = new Map<string, number>();
    for (const r of rows) {
      const v = r[f];
      if (typeof v === 'string' && v.trim() !== '') counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const extra = added.filter((a) => a.field === f && !counts.has(a.value)).map((a) => a.value);
    out[f] = [
      ...[...counts].map(([value, count]) => ({ value, count, editable: managed, removable: managed })),
      ...extra.map((value) => ({ value, count: 0, editable: managed, removable: true })),
    ].sort((a, b) => a.value.localeCompare(b.value, 'ko'));
  }
  return out;
}

function recompute(date: string) {
  const prev = prevSnapshotDate(date);
  const changes = diffSnapshots(prev ? snapshotRows(prev) : null, snapshotRows(date) ?? []);
  const manual = new Map(
    (db.prepare('SELECT key, category_id FROM biz_change WHERE date = ? AND manual = 1').all(date) as { key: string; category_id: string }[]).map((r) => [r.key, r.category_id]),
  );
  db.prepare('DELETE FROM biz_change WHERE date = ?').run(date);
  const ins = db.prepare('INSERT INTO biz_change (date, key, kind, category_id, manual, delta, change_json) VALUES (?, ?, ?, ?, ?, ?, ?)');
  // 구분 관리에서 지운 구분이면 미분류로 (리뷰 #2)
  const exists = new Set((db.prepare('SELECT id FROM biz_category').all() as { id: string }[]).map((r) => r.id));
  const valid = (id: string | undefined) => (id && exists.has(id) ? id : 'unclassified');
  for (const c of changes) {
    const kept = manual.get(c.key);
    ins.run(date, c.key, c.kind, valid(kept ?? KIND_CATEGORY[c.kind]), kept ? 1 : 0, Math.round(c.delta), JSON.stringify(c));
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
  const rows = db.prepare(`SELECT c.category_id, c.manual, c.delta AS auto, e.delta AS edited, c.change_json FROM biz_change c
    LEFT JOIN biz_delta_edit e ON e.date = c.date AND e.key = c.key
    WHERE c.date = ? AND NOT EXISTS (SELECT 1 FROM biz_change_hidden h WHERE h.date = c.date AND h.key = c.key)
    ORDER BY ABS(COALESCE(e.delta, c.delta)) DESC, c.key`).all(date) as {
    category_id: string; manual: number; auto: number; edited: number | null; change_json: string;
  }[];
  return rows.map((r) => {
    const c: StoredChange = { ...(JSON.parse(r.change_json) as Change), categoryId: r.category_id, manual: r.manual === 1 };
    if (r.edited !== null) { c.autoDelta = r.auto; c.delta = r.edited; }
    return c;
  });
}

/** 본영업 매출 당일 증감액: 변동사항 증감액의 합(받아온 변동 — 직접 넣은 증감액 우선, 지운 것 제외 — + 직접 적은 행). */
export function dayDelta(date: string): number {
  const auto = (db.prepare(`SELECT COALESCE(SUM(COALESCE(e.delta, c.delta)), 0) AS s FROM biz_change c
    LEFT JOIN biz_delta_edit e ON e.date = c.date AND e.key = c.key
    WHERE c.date = ? AND NOT EXISTS (SELECT 1 FROM biz_change_hidden h WHERE h.date = c.date AND h.key = c.key)`).get(date) as { s: number }).s;
  const manual = (db.prepare('SELECT COALESCE(SUM(delta), 0) AS s FROM biz_manual_change WHERE date = ?').get(date) as { s: number }).s;
  return auto + manual;
}

// ---------- 직접 적은 변동 행 ----------
const MANUAL_PREFIX = 'm:';
type ManualData = Partial<Record<EditableField, string | number | null>>;

function manualRow(key: string, data: ManualData): SalesRow {
  const s = (f: EditableField) => (typeof data[f] === 'string' ? (data[f] as string) : '');
  const d = (f: EditableField) => (typeof data[f] === 'string' && data[f] ? (data[f] as string) : null);
  return {
    key, code: 0, product: s('product'), division: MAIN_DIVISION, rep: s('rep'), customer: s('customer'), contractor: s('contractor'),
    amount: typeof data.amount === 'number' ? data.amount : 0, progress: s('progress'), contractDate: d('contractDate'), startDate: d('startDate'),
    probability: s('probability'), isCloud: isCloudProduct(s('product')), weight: s('weight'), revenueType: s('revenueType'), revenueDate: d('revenueDate'),
  };
}

/** 칸 값을 적용한다(null이면 비움). 새 값은 값 목록에 넣는다. */
function applyManualFields(data: ManualData, fields: ReturnType<typeof parseFields>): ManualData {
  const out = { ...data };
  for (const [f, v] of fields) {
    out[f] = v ?? (EDITABLE_FIELDS[f] === 'number' ? 0 : EDITABLE_FIELDS[f] === 'date' ? null : '');
    if (typeof v === 'string' && v && (OPTION_FIELDS as readonly string[]).includes(f)) addOption(f as OptionField, v);
  }
  return out;
}

export function manualChanges(date: string): StoredChange[] {
  return (db.prepare('SELECT id, data_json, category_id, delta FROM biz_manual_change WHERE date = ? ORDER BY position, created_time').all(date) as {
    id: string; data_json: string; category_id: string; delta: number;
  }[]).map((m) => ({
    key: MANUAL_PREFIX + m.id, kind: 'unclassified', delta: m.delta, before: null, after: manualRow(MANUAL_PREFIX + m.id, JSON.parse(m.data_json)),
    diffs: [], categoryId: m.category_id, manual: true, entry: true,
  }));
}

/** 변동사항 표에 보일 전부: 받아온 변동(지운 것 제외) 다음에 직접 적은 행(적은 순서). */
export function allChangesFor(date: string): StoredChange[] {
  return [...changesFor(date), ...manualChanges(date)];
}

/** 행 추가. 고객명이나 제품 중 하나는 있어야 한다. 돌려주는 값은 행 키(m:…) */
export function addManualChange(date: string, edit: SaleEdit, uid: string | null): string {
  const fields = parseFields(edit);
  const delta = parseDelta(edit.delta) ?? 0;
  return tx(() => {
    const data = applyManualFields({}, fields);
    if (!String(data.customer ?? '').trim() && !String(data.product ?? '').trim()) throw new Error('고객명이나 제품을 넣으세요');
    const category = resolveCategory(edit) ?? 'unclassified';
    const pos = (db.prepare('SELECT COALESCE(MAX(position), 0) AS p FROM biz_manual_change WHERE date = ?').get(date) as { p: number }).p + 1;
    const id = newId();
    db.prepare('INSERT INTO biz_manual_change (id, date, position, data_json, category_id, delta, created_by, created_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, date, pos, JSON.stringify(data), category, delta, uid, Date.now());
    return MANUAL_PREFIX + id;
  });
}

function editManualChange(date: string, key: string, edit: SaleEdit): void {
  const id = key.slice(MANUAL_PREFIX.length);
  const fields = parseFields(edit);
  const delta = parseDelta(edit.delta);
  tx(() => {
    const row = db.prepare('SELECT data_json FROM biz_manual_change WHERE id = ? AND date = ?').get(id, date) as { data_json: string } | undefined;
    if (!row) throw new Error('해당 변동이 없습니다');
    if (fields.length) db.prepare('UPDATE biz_manual_change SET data_json = ? WHERE id = ?').run(JSON.stringify(applyManualFields(JSON.parse(row.data_json), fields)), id);
    const cat = resolveCategory(edit);
    if (cat) db.prepare('UPDATE biz_manual_change SET category_id = ? WHERE id = ?').run(cat, id);
    if (delta !== undefined) db.prepare('UPDATE biz_manual_change SET delta = ? WHERE id = ?').run(delta ?? 0, id);
  });
}

/** 표에서 행 지우기: 직접 적은 행은 지우고, 받아온 변동은 숨긴다(다시 받아도 숨김). */
export function deleteChange(date: string, key: string, uid: string | null = null): void {
  if (key.startsWith(MANUAL_PREFIX)) {
    if (!db.prepare('DELETE FROM biz_manual_change WHERE id = ? AND date = ?').run(key.slice(MANUAL_PREFIX.length), date).changes) throw new Error('해당 변동이 없습니다');
    return;
  }
  if (!db.prepare('SELECT 1 FROM biz_change WHERE date = ? AND key = ?').get(date, key)) throw new Error('해당 변동이 없습니다');
  db.prepare('INSERT OR IGNORE INTO biz_change_hidden (date, key, hidden_by, hidden_time) VALUES (?, ?, ?, ?)').run(date, key, uid, Date.now());
}

// ---------- 실적 직접 입력 ----------
/** 그 날짜부터 같은 기간 끝까지 적용. null이면 그 날짜부터 계산값. */
export function setActual(date: string, period: ActualPeriod, value: number | null): void {
  if (!(ACTUAL_PERIODS as readonly string[]).includes(period)) throw new Error('기간은 annual·quarter·month입니다');
  let v: number | null = null;
  if (value !== null) {
    const n = typeof value === 'number' ? value : Number(String(value).replace(/[,원\s]/g, ''));
    if (!Number.isFinite(n) || n < 0) throw new Error('실적은 0 이상의 숫자로 넣으세요');
    v = Math.round(n);
  }
  db.prepare(`INSERT INTO biz_actual_edit (date, period, value, edited_by, edited_time) VALUES (?, ?, ?, NULL, ?)
    ON CONFLICT(date, period) DO UPDATE SET value = excluded.value, edited_time = excluded.edited_time`).run(date, period, v, Date.now());
}

/** 기간이 시작하는 날짜(YYYY-MM-DD) */
function periodStart(date: string, period: ActualPeriod): string {
  const y = date.slice(0, 4);
  const m = Number(date.slice(5, 7));
  if (period === 'annual') return `${y}-01-01`;
  if (period === 'quarter') return `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
  return `${date.slice(0, 7)}-01`;
}

/** 요약에 직접 입력한 실적을 적용한다. 바꾼 기간은 edited에 계산값을 남긴다. */
export function applyActuals(s: Summary, date: string): Summary {
  const key = { annual: 'annualActual', quarter: 'quarterActual', month: 'monthActual' } as const;
  const out: Summary = { ...s };
  for (const p of ACTUAL_PERIODS) {
    const row = db.prepare('SELECT value FROM biz_actual_edit WHERE period = ? AND date >= ? AND date <= ? ORDER BY date DESC LIMIT 1')
      .get(p, periodStart(date, p), date) as { value: number | null } | undefined;
    if (row && row.value !== null) {
      out.edited = { ...out.edited, [p]: s[key[p]] };
      out[key[p]] = row.value;
    }
  }
  return out;
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
  if (c.id === 'unclassified') throw new Error('미분류는 이름을 바꿀 수 없습니다');
  if (db.prepare('SELECT 1 FROM biz_category WHERE label = ? AND id <> ?').get(label, c.id ?? '')) throw new Error('같은 이름의 구분이 있습니다');
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
    db.prepare("UPDATE biz_manual_change SET category_id = 'unclassified' WHERE category_id = ?").run(id);
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

export function latestDailyPageBefore(date: string, kind: 'report' | 'sales'): { date: string; pageId: string } | null {
  const row = db.prepare('SELECT date, page_id FROM biz_daily_page WHERE kind = ? AND date < ? ORDER BY date DESC LIMIT 1').get(kind, date) as { date: string; page_id: string } | undefined;
  return row ? { date: row.date, pageId: row.page_id } : null;
}

export function dailyPageLookup(pageId: string): { date: string; kind: 'report' | 'sales' } | null {
  return (db.prepare('SELECT date, kind FROM biz_daily_page WHERE page_id = ?').get(pageId) as { date: string; kind: 'report' | 'sales' } | undefined) ?? null;
}

export function setDailyPage(date: string, kind: 'report' | 'sales', pageId: string): void {
  db.prepare('INSERT INTO biz_daily_page (date, kind, page_id) VALUES (?, ?, ?) ON CONFLICT(date, kind) DO UPDATE SET page_id = excluded.page_id').run(date, kind, pageId);
}
