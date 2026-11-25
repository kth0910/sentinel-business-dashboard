// 받아온 매출 데이터(엑셀·API) 칸을 화면에서 직접 고친다. 누르면 입력칸, Enter·바깥 클릭으로 저장, Esc 취소.
// 고친 값은 서버 biz_override에 따로 저장돼 다음 날 데이터를 받아도 유지된다. 고친 칸은 점 표시, ↺로 원래 값.
import { useState, type ReactNode } from 'react';
import { EDITABLE_FIELDS, type EditableField, type SalesRow } from '@nc/biz';
import { api } from '../../lib/api.ts';
import { useUI } from '../../lib/store/ui.ts';
import { isolate } from './fields.tsx';
import { refreshSales } from './sales.ts';

const show = (v: unknown) => (v === null || v === undefined || v === '' ? '-' : String(v));

async function save(date: string, key: string, field: EditableField, value: unknown) {
  try {
    await api('bizSetOverride', { date, key, field, value });
    refreshSales();
  } catch (e: any) {
    useUI.getState().toast(e?.message ?? '고치지 못했습니다');
  }
}

export function EditCell({ date, row, field, readOnly, fmt = show, children }: {
  date: string; row: SalesRow; field: EditableField; readOnly?: boolean; fmt?: (v: unknown) => string; children?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const kind = EDITABLE_FIELDS[field];
  const value = (row as any)[field] as string | number | null | undefined;
  const edited = !!row.edited && field in row.edited;
  const original = edited ? row.edited![field] : undefined;

  if (editing && !readOnly) {
    const initial = value === null || value === undefined ? '' : String(value);
    const commit = (text: string) => {
      setEditing(false);
      const next = kind === 'number' ? text.replace(/[,원\s]/g, '') : text.trim();
      if (next === initial) return;
      if (kind === 'number' && next === '') return;
      void save(date, row.key, field, kind === 'number' ? Number(next) : next);
    };
    return (
      <input
        {...isolate}
        autoFocus
        className="biz-input biz-cell-input"
        type={kind === 'date' ? 'date' : 'text'}
        inputMode={kind === 'number' ? 'numeric' : undefined}
        defaultValue={initial}
        aria-label={`${field} 수정`}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  }

  return (
    <span className="biz-cell">
      <span
        className={`biz-cell-value ${readOnly ? '' : 'editable'} ${edited ? 'edited' : ''}`}
        title={edited ? `직접 수정함 · 원래 값: ${fmt(original)}` : readOnly ? undefined : '눌러서 수정'}
        onClick={(e) => { if (!readOnly) { e.stopPropagation(); setEditing(true); } }}
      >
        {children ?? fmt(value)}
      </span>
      {edited && !readOnly && (
        <button {...isolate} type="button" className="biz-cell-reset" title={`원래 값으로(${fmt(original)})`} aria-label="원래 값으로" onClick={(e) => { e.stopPropagation(); void save(date, row.key, field, null); }}>↺</button>
      )}
    </span>
  );
}
