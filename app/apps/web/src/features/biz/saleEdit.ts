// 영업 건 수정 창의 저장 규칙(화면과 무관한 순수 함수). 바뀐 칸만 서버(bizEditSale)로 보낸다.
import type { Category } from '@nc/biz';

export type FieldKind = 'text' | 'number' | 'date' | 'option' | 'category' | 'delta';

export interface FieldState {
  field: string;
  kind: FieldKind;
  /** 창을 열 때 값(문자열) */
  initial: string;
  /** 지금 입력한 값 */
  draft: string;
  /** '원래 값으로'(받아온 값·계산값으로 되돌림)를 눌렀다 */
  reset: boolean;
}

export interface SaleEditPayload {
  fields?: Record<string, string | number | null>;
  categoryId?: string;
  categoryLabel?: string;
  delta?: number | null;
}

/** '1,500,000원'·'−20,000' 같은 입력을 정수로. 못 읽거나(signed가 아니면) 음수면 null. */
export function parseAmount(text: string, signed = false): number | null {
  const t = text.replace(/[,원\s]/g, '').replace(/^[−–]/, '-');
  if (!t || !/^[+-]?\d+(\.\d+)?$/.test(t)) return null;
  const n = Math.round(Number(t));
  if (!signed && n < 0) return null;
  return n;
}

export function buildSaleEdit(states: FieldState[], categories: Category[]): { edit: SaleEditPayload; error?: string } {
  const edit: SaleEditPayload = {};
  const fields: Record<string, string | number | null> = {};
  for (const s of states) {
    const changed = s.draft.trim() !== s.initial.trim();
    if (s.kind === 'category') {
      if (!changed) continue;
      const label = s.draft.trim();
      if (!label) return { edit, error: '구분을 고르거나 이름을 넣으세요' };
      const hit = categories.find((c) => c.label === label);
      if (hit) edit.categoryId = hit.id;
      else edit.categoryLabel = label;
    } else if (s.kind === 'delta') {
      if (s.reset) { edit.delta = null; continue; }
      if (!changed) continue;
      const n = parseAmount(s.draft, true);
      if (n === null) return { edit, error: '증감액은 숫자로 넣으세요 (예: -20,000)' };
      edit.delta = n;
    } else if (s.reset) {
      fields[s.field] = null;
    } else if (changed) {
      if (s.kind === 'number') {
        const n = parseAmount(s.draft);
        if (n === null) return { edit, error: '금액은 0 이상의 숫자로 넣으세요' };
        fields[s.field] = n;
      } else {
        fields[s.field] = s.draft.trim();
      }
    }
  }
  if (Object.keys(fields).length) edit.fields = fields;
  return { edit };
}
