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
  // 아래 셋은 지금 엑셀에 없고 업무관리시스템 API로 받을 값. 없으면 null(예전 스냅샷은 키 자체가 없을 수 있음).
  /** 가중치 (예: 'High(100%)', '미반영') */
  weight?: string | null;
  /** 매출 구분 (예: '과업매출', '기반매출') */
  revenueType?: string | null;
  /** 매출일정 YYYY-MM-DD */
  revenueDate?: string | null;
  /** 직접 수정한 칸: 필드 → 받아온(원래) 값. 읽을 때 채워진다(서버 biz_override) */
  edited?: Record<string, string | number | null>;
}

/** 화면에서 직접 고칠 수 있는 칸과 값 종류. 영업코드·구분(본 영업 여부)은 식별·집계 기준이라 뺀다. */
export const EDITABLE_FIELDS = {
  customer: 'text', product: 'text', contractor: 'text', rep: 'text', progress: 'text', probability: 'text',
  weight: 'text', revenueType: 'text', amount: 'number', contractDate: 'date', startDate: 'date', revenueDate: 'date',
} as const;
export type EditableField = keyof typeof EDITABLE_FIELDS;

/** 고를 값 목록이 있는 칸(데이터에 있는 값 + 사람이 추가한 값). 새 값을 넣으면 목록에 들어간다. */
export const OPTION_FIELDS = ['product', 'probability', 'weight', 'revenueType', 'progress'] as const;
export type OptionField = (typeof OPTION_FIELDS)[number];
/** 값 이름 바꾸기·지우기까지 되는 칸. 바꾸면 그 값을 쓰는 모든 건(모든 날짜, 나중에 받는 데이터 포함)에 적용된다.
 *  확도·진행사항은 분류 규칙(확정·하·보류…)에 쓰이고 가중치는 요청 범위 밖이라 뺀다. */
export const MANAGED_OPTION_FIELDS = ['product', 'revenueType'] as const satisfies readonly OptionField[];
export interface OptionItem {
  value: string;
  /** 지금 데이터에서 이 값을 쓰는 건 수 */
  count: number;
  /** 이름을 바꿀 수 있다 */
  editable: boolean;
  /** 목록에서 지울 수 있다(편집 칸은 언제나, 그 밖은 추가했고 안 쓰는 값만) */
  removable: boolean;
}

export type ChangeKind = 'new' | 'confirm' | 'exclude' | 'raise' | 'advance' | 'unclassified';

export interface FieldDiff {
  field: 'amount' | 'probability' | 'progress' | 'contractDate' | 'weight' | 'revenueType' | 'revenueDate';
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

/** 직접 입력할 수 있는 실적 기간 */
export const ACTUAL_PERIODS = ['annual', 'quarter', 'month'] as const;
export type ActualPeriod = (typeof ACTUAL_PERIODS)[number];

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
  /** 직접 입력한 실적이 있으면 기간 → 계산값 */
  edited?: Partial<Record<ActualPeriod, number>>;
}

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

/** 클라우드 제품: 제품 이름에 '(cloud)'(대소문자 무관)가 있으면. 화면 태그용 */
export function isCloudProduct(product: string | null | undefined): boolean {
  return /\(cloud\)/i.test(product ?? '');
}

export function isMain(r: SalesRow): boolean {
  return r.division === MAIN_DIVISION;
}

export function isOpen(r: SalesRow): boolean {
  return OPEN_PROGRESS.includes(r.progress);
}

export function isConfirmed(r: SalesRow): boolean {
  return r.probability === CONFIRMED;
}
