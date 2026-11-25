// 매출 집계: 실적 = '본 영업' + 확도 '확정' 건의 공급가, 계약일 기준 (설계 11.2).
import { isConfirmed, isMain, isOpen, type SalesRow, type Summary, type Targets } from './types.ts';

export function emptyTargets(year: number): Targets {
  return { year, annual: 0, quarters: [0, 0, 0, 0], months: Array(12).fill(0) };
}

const confirmedMain = (rows: SalesRow[]) => rows.filter((r) => isMain(r) && isConfirmed(r) && r.contractDate);

export function summarize(rows: SalesRow[], targets: Targets | null, date: string): Summary {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const quarter = (Math.floor((month - 1) / 3) + 1) as 1 | 2 | 3 | 4;
  const t = targets ?? emptyTargets(year);
  let annualActual = 0;
  let quarterActual = 0;
  let monthActual = 0;
  for (const r of confirmedMain(rows)) {
    const d = r.contractDate as string;
    if (Number(d.slice(0, 4)) !== year) continue;
    const m = Number(d.slice(5, 7));
    annualActual += r.amount;
    if (Math.floor((m - 1) / 3) + 1 === quarter) quarterActual += r.amount;
    if (m === month) monthActual += r.amount;
  }
  return {
    date, year, quarter, month, annualActual, quarterActual, monthActual,
    annualTarget: t.annual, quarterTarget: t.quarters[quarter - 1] ?? 0, monthTarget: t.months[month - 1] ?? 0,
  };
}

export function monthlyConfirmed(rows: SalesRow[], year: number): number[] {
  const out: number[] = Array(12).fill(0);
  for (const r of confirmedMain(rows)) {
    const d = r.contractDate as string;
    if (Number(d.slice(0, 4)) === year) out[Number(d.slice(5, 7)) - 1] += r.amount;
  }
  return out;
}

export function openPipeline(rows: SalesRow[]): SalesRow[] {
  return rows.filter((r) => isMain(r) && isOpen(r)).sort((a, b) => {
    if (a.startDate === b.startDate) return a.key.localeCompare(b.key);
    if (!a.startDate) return 1;
    if (!b.startDate) return -1;
    return b.startDate.localeCompare(a.startDate);
  });
}
