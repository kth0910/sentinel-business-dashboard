// 업무 화면 RPC 래퍼. 응답 타입은 apps/server/src/api/modules/biz.ts와 같다.
import type { ActualPeriod, Category, Change, OptionField, OptionItem, SalesRow, Summary, Targets } from '@nc/biz';
import { api } from '../../lib/api.ts';

export type DailyKind = 'report' | 'sales';
/** delta는 실제로 쓰는 값. 직접 넣었으면 autoDelta에 계산값이 있다. */
export type StoredChange = Change & { categoryId: string; manual: boolean; autoDelta?: number; /** 직접 적은 행 */ entry?: boolean };

export interface CalendarDay { date: string; hasSnapshot: boolean; dayDelta: number; reportPageId: string | null; salesPageId: string | null }

export interface SalesView {
  date: string; basisDate: string | null; prevDate: string | null; hasSnapshot: boolean; baseline: boolean;
  summary: Summary; dayDelta: number; changes: StoredChange[]; categories: Category[]; options: Record<OptionField, OptionItem[]>;
  monthly: number[]; monthTargets: number[]; pipeline: SalesRow[];
}

export const biz = {
  calendar: (month: string) => api<{ days: CalendarDay[] }>('bizCalendar', { month }),
  ensurePage: (spaceId: string, date: string, kind: DailyKind) => api<{ pageId: string }>('bizEnsureDailyPage', { spaceId, date, kind }),
  pageDate: (pageId: string) => api<{ date: string | null; kind: DailyKind | null }>('bizPageDate', { pageId }),
  salesView: (date: string) => api<SalesView>('bizSalesView', { date }),
  categories: () => api<{ categories: Category[] }>('bizCategories', {}),
  saveCategory: (c: { id?: string; label: string }) => api<{ category: Category; categories: Category[] }>('bizSaveCategory', c),
  deleteCategory: (id: string) => api<{ categories: Category[] }>('bizDeleteCategory', { id }),
  removeOption: (field: string, value: string) => api<{ ok: true }>('bizRemoveOption', { field, value }),
  renameOption: (field: string, from: string, to: string) => api<{ ok: true }>('bizRenameOption', { field, from, to }),
  addChange: (date: string, edit: object) => api<{ key: string }>('bizAddChange', { date, ...edit }),
  deleteChange: (date: string, key: string) => api<{ ok: true }>('bizDeleteChange', { date, key }),
  setActual: (date: string, period: ActualPeriod, value: number | null) => api<{ ok: true }>('bizSetActual', { date, period, value }),
  getTargets: (year: number) => api<{ targets: Targets }>('bizGetTargets', { year }),
  setTargets: (t: Targets) => api<{ targets: Targets }>('bizSetTargets', t),
};

/** 로컬 시간 기준 YYYY-MM-DD */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;
export const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(Math.round(n)).toLocaleString('ko-KR')}`;
export const arrow = (n: number) => (n > 0 ? '▲' : n < 0 ? '▼' : '');
