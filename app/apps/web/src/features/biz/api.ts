// 업무 화면 RPC 래퍼. 응답 타입은 apps/server/src/api/modules/biz.ts와 같다.
import type { Category, Change, SalesRow, Summary, Targets } from '@nc/biz';
import { api } from '../../lib/api.ts';

export type DailyKind = 'report' | 'sales';
export type StoredChange = Change & { categoryId: string; manual: boolean };

export interface CalendarDay { date: string; hasSnapshot: boolean; dayDelta: number; reportPageId: string | null; salesPageId: string | null }

export interface SalesView {
  date: string; basisDate: string | null; prevDate: string | null; hasSnapshot: boolean; baseline: boolean;
  summary: Summary; dayDelta: number; changes: StoredChange[]; categories: Category[];
  monthly: number[]; monthTargets: number[]; pipeline: SalesRow[];
}

export interface ImportResult { date: string; rowCount: number; changeCount: number; baseline: boolean; warnings: string[] }

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export const biz = {
  calendar: (month: string) => api<{ days: CalendarDay[] }>('bizCalendar', { month }),
  ensurePage: (spaceId: string, date: string, kind: DailyKind) => api<{ pageId: string }>('bizEnsureDailyPage', { spaceId, date, kind }),
  pageDate: (pageId: string) => api<{ date: string | null; kind: DailyKind | null }>('bizPageDate', { pageId }),
  salesView: (date: string) => api<SalesView>('bizSalesView', { date }),
  importSales: async (date: string, file: File) => api<ImportResult>('bizImportSales', { date, fileBase64: await fileToBase64(file) }),
  categories: () => api<{ categories: Category[] }>('bizCategories', {}),
  saveCategory: (c: { id?: string; label: string }) => api<{ category: Category; categories: Category[] }>('bizSaveCategory', c),
  deleteCategory: (id: string) => api<{ categories: Category[] }>('bizDeleteCategory', { id }),
  setChangeCategory: (date: string, key: string, categoryId: string) => api<{ ok: true }>('bizSetChangeCategory', { date, key, categoryId }),
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
