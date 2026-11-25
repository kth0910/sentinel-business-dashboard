// 업무 블록의 목록(채용 행, 일정 항목)을 id로 고친다 (리뷰 #5).
// 번호로 고치면 다른 사람이 앞 행을 지웠을 때 엉뚱한 행에 저장된다.
import { newId } from '@nc/shared/ids.ts';

export type WithId<T> = T & { id: string };

/** id가 없던 예전 행은 자리 번호로 id를 붙인다(i0, i1…). */
export function keyed<T extends object>(rows: T[]): WithId<T>[] {
  return rows.map((r, i) => ({ ...r, id: (r as { id?: string }).id ?? `i${i}` }));
}

export function patchRow<T extends object>(rows: T[], id: string, patch: Partial<T>): WithId<T>[] {
  return keyed(rows).map((r) => (r.id === id ? { ...r, ...patch } : r));
}

export function removeRow<T extends object>(rows: T[], id: string): WithId<T>[] {
  return keyed(rows).filter((r) => r.id !== id);
}

export function addRow<T extends object>(rows: T[], row: Omit<T, 'id'>): WithId<T>[] {
  return [...keyed(rows), { ...row, id: newId() } as WithId<T>];
}
