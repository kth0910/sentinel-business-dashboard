// 업무관리시스템 엑셀(첫 시트, 첫 행이 헤더)을 SalesRow[]로 바꾼다.
import { REQUIRED_COLUMNS, type SalesRow } from './types.ts';

export class SalesImportError extends Error {
  missing: string[];
  constructor(missing: string[]) {
    super(`엑셀에 필요한 열이 없습니다: ${missing.join(', ')}`);
    this.name = 'SalesImportError';
    this.missing = missing;
  }
}

const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

const date = (v: unknown): string | null => {
  const s = text(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

const num = (v: unknown): number => {
  const n = Number(text(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export function normalizeRows(table: unknown[][]): { rows: SalesRow[]; warnings: string[] } {
  const head = (table[0] ?? []).map(text);
  const missing = REQUIRED_COLUMNS.filter((c) => !head.includes(c));
  if (missing.length) throw new SalesImportError([...missing]);
  const col = Object.fromEntries(REQUIRED_COLUMNS.map((c) => [c, head.indexOf(c)])) as Record<(typeof REQUIRED_COLUMNS)[number], number>;

  // 선택 열(업무관리시스템 API로 받을 값): 있으면 읽는다
  const opt = (...names: string[]) => names.map((n) => head.indexOf(n)).find((i) => i >= 0) ?? -1;
  const optCol = { weight: opt('가중치'), revenueType: opt('매출 구분', '매출구분'), revenueDate: opt('매출일정', '매출 일정') };
  const optText = (raw: unknown[], i: number) => (i < 0 ? null : text(raw?.[i]) || null);

  const byKey = new Map<string, SalesRow>();
  const warnings: string[] = [];
  for (const raw of table.slice(1)) {
    const cell = (c: (typeof REQUIRED_COLUMNS)[number]) => raw?.[col[c]];
    if (!text(cell('영업코드'))) continue;
    const code = num(cell('영업코드'));
    const product = text(cell('제품/서비스'));
    const row: SalesRow = {
      key: `${code}::${product}`,
      code,
      product,
      division: text(cell('구분')),
      rep: text(cell('영업대표')),
      customer: text(cell('사용고객')),
      contractor: text(cell('계약사')),
      amount: num(cell('공급가')),
      progress: text(cell('영업진행사항')),
      contractDate: date(cell('계약일')),
      startDate: date(cell('영업개시일')),
      probability: text(cell('최종영업확도')),
      isCloud: /\(cloud\)/i.test(product),
      weight: optText(raw, optCol.weight),
      revenueType: optText(raw, optCol.revenueType),
      revenueDate: optCol.revenueDate < 0 ? null : date(raw?.[optCol.revenueDate]),
    };
    const prev = byKey.get(row.key);
    if (prev) {
      prev.amount += row.amount;
      warnings.push(`같은 영업코드·제품이 두 번 나와 공급가를 합쳤습니다: ${row.key}`);
    } else {
      byKey.set(row.key, row);
    }
  }
  return { rows: [...byKey.values()], warnings };
}
