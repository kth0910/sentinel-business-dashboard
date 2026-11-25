// 매출 데이터 가져오기: 업무관리시스템 엑셀(.xlsx) → 날짜별 스냅샷. 화면의 업로드 기능은 없다.
// 지금은 서버 명령(scripts/biz-import.ts)으로 넣고, 업무관리시스템 API가 붙으면 그 동기화 작업이 이 함수를 쓴다.
import { isMain, normalizeRows, SalesImportError } from '@nc/biz';
import { readFirstSheet } from './excel.ts';
import { fillMockExtras } from './mock.ts';
import * as store from './store.ts';

/** 직전 데이터의 본 영업 건 중 이 비율보다 많이 빠지면 force 없이는 넣지 않는다(필터된 엑셀 방지, 리뷰 #4). */
const MISSING_LIMIT = 0.2;
/** 몇 건 안 빠졌으면(작은 데이터) 막지 않는다. */
const MISSING_MIN = 10;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** status: 400 잘못된 입력, 409 직전 데이터보다 너무 많이 빠짐(force로 넣을 수 있음). */
export class ImportError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'ImportError';
    this.status = status;
  }
}

export interface ImportResult {
  date: string;
  rowCount: number;
  missingCount: number;
  changeCount: number;
  baseline: boolean;
  warnings: string[];
}

export async function importSalesFile(date: string, file: Buffer, opts: { force?: boolean } = {}): Promise<ImportResult> {
  if (!DATE_RE.test(date)) throw new ImportError('날짜 형식은 YYYY-MM-DD입니다');
  let table: unknown[][];
  try {
    table = await readFirstSheet(file);
  } catch {
    throw new ImportError('엑셀 파일을 읽을 수 없습니다(.xlsx만 지원)');
  }
  let parsed: ReturnType<typeof normalizeRows>;
  try {
    parsed = normalizeRows(table);
  } catch (e) {
    if (e instanceof SalesImportError) throw new ImportError(e.message);
    throw e;
  }
  if (!parsed.rows.length) throw new ImportError('엑셀에 데이터 행이 없습니다');
  // 목업: 가중치·매출 구분·매출일정(업무관리시스템 API가 붙으면 지운다, biz/mock.ts)
  const rows = fillMockExtras(parsed.rows);
  const prevDate = store.prevSnapshotDate(date);
  const prevMain = prevDate ? (store.snapshotRows(prevDate) ?? []).filter(isMain).map((r) => r.key) : [];
  const keys = new Set(rows.map((r) => r.key));
  const missingCount = prevMain.filter((k) => !keys.has(k)).length;
  if (missingCount >= MISSING_MIN && missingCount / prevMain.length > MISSING_LIMIT && !opts.force) {
    throw new ImportError(
      `직전 데이터(${prevDate})의 본 영업 ${prevMain.length.toLocaleString('ko-KR')}건 중 ${missingCount.toLocaleString('ko-KR')}건이 이 파일에 없습니다. 필터 없이 전체를 내려받은 파일인지 확인하세요.`,
      409,
    );
  }
  const res = store.importSnapshot(date, rows);
  return { date, rowCount: rows.length, missingCount, ...res, warnings: parsed.warnings };
}
