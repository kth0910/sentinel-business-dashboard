// 업무 데이터 타입과 규칙 상수. 프레임워크와 무관한 순수 TS — 나중에 Python으로 옮길 때 기준.

export interface SalesRow {
  /** `${code}::${product}` */
  key: string;
  /** 영업코드 */
  code: number;
  /** 제품/서비스 */
  product: string;
  /** 구분 ('본 영업' | '기획영업' | …) */
  division: string;
  /** 영업대표 */
  rep: string;
  /** 사용고객 */
  customer: string;
  /** 계약사 */
  contractor: string;
  /** 공급가 */
  amount: number;
  /** 영업진행사항 */
  progress: string;
  /** 계약일 YYYY-MM-DD */
  contractDate: string | null;
  /** 영업개시일 YYYY-MM-DD */
  startDate: string | null;
  /** 최종영업확도 ('' 허용) */
  probability: string;
  isCloud: boolean;
}

export type ChangeKind = 'new' | 'confirm' | 'exclude' | 'raise' | 'unclassified';

export interface FieldDiff {
  field: 'amount' | 'probability' | 'progress' | 'contractDate';
  before: string | number | null;
  after: string | number | null;
}

export interface Change {
  key: string;
  kind: ChangeKind;
  delta: number;
  before: SalesRow | null;
  after: SalesRow | null;
  diffs: FieldDiff[];
}

export interface Category {
  id: string;
  label: string;
  position: number;
  system: boolean;
}

export interface Targets {
  year: number;
  annual: number;
  quarters: [number, number, number, number];
  /** length 12 */
  months: number[];
}

export interface Summary {
  date: string;
  year: number;
  quarter: 1 | 2 | 3 | 4;
  month: number;
  annualActual: number;
  quarterActual: number;
  monthActual: number;
  annualTarget: number;
  quarterTarget: number;
  monthTarget: number;
}

export const REQUIRED_COLUMNS = ['구분', '영업대표', '영업코드', '사용고객', '계약사', '제품/서비스', '공급가', '영업진행사항', '계약일', '영업개시일', '최종영업확도'] as const;
export const MAIN_DIVISION = '본 영업';
export const OPEN_PROGRESS = ['진행', '장기관리'];
export const CONFIRMED = '확정';
export const LOW_PROBABILITY = ['하', '매우낮음'];
export const EXCLUDE_PROGRESS = ['보류', '실패'];

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'raise', label: '목표매출 상향', position: 1, system: false },
  { id: 'new', label: '신규매출', position: 2, system: false },
  { id: 'advance', label: '매출일정 앞당김', position: 3, system: false },
  { id: 'exclude', label: '목표매출 제외', position: 4, system: false },
  { id: 'confirm', label: '확정 전환', position: 5, system: false },
  { id: 'unclassified', label: '미분류', position: 99, system: true },
];

export function isMain(r: SalesRow): boolean {
  return r.division === MAIN_DIVISION;
}

export function isOpen(r: SalesRow): boolean {
  return OPEN_PROGRESS.includes(r.progress);
}

export function isConfirmed(r: SalesRow): boolean {
  return r.probability === CONFIRMED;
}
