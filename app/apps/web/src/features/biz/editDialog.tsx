// 영업 건 수정 창: 표의 행을 누르면 뜬다. 칸을 고치고 저장하면 한 번에 서버(bizEditSale)로 간다.
// 구분·제품·확도·가중치·매출 구분·진행사항은 목록에서 고르거나, 없는 값을 입력해 바로 추가한다.
import { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Category, EditableField, OptionField, OptionItem, SalesRow } from '@nc/biz';
import { api } from '../../lib/api.ts';
import { biz } from './api.ts';
import { refreshSales } from './sales.ts';
import { buildSaleEdit, type FieldKind, type FieldState } from './saleEdit.ts';
import './biz.css';

export interface Choice { value: string; removable: boolean; /** 구분이면 id */ id?: string }

export interface EditSpec {
  field: string;
  label: string;
  kind: FieldKind;
  /** 지금 값(문자열) */
  value: string;
  /** 직접 고친 칸이면 받아온 값·계산값(보여 줄 글자) */
  original?: string;
  disabled?: boolean;
  choices?: Choice[];
}

interface Props {
  title: string;
  subtitle?: string;
  date: string;
  saleKey: string;
  specs: EditSpec[];
  categories: Category[];
  note?: string;
  onDone: () => void;
}

/** 목록에서 고르거나 새 값을 입력하는 칸. ↑↓로 고르고 Enter, Esc는 목록만 닫는다. */
function Picker({ value, choices, onChange, onRemove, ariaLabel, autoFocus, disabled }: {
  value: string; choices: Choice[]; onChange: (v: string) => void; onRemove: (c: Choice) => void; ariaLabel: string; autoFocus?: boolean; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false);
  const [active, setActive] = useState(0);
  const [up, setUp] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const q = value.trim();
  const exact = choices.some((c) => c.value === q);
  const list = useMemo(() => (typed && q && !exact ? choices.filter((c) => c.value.toLowerCase().includes(q.toLowerCase())) : choices), [choices, typed, q, exact]);
  // 맞는 값이 있으면 그 값들 먼저, 새로 추가는 맨 아래
  const addItem = q && !exact ? [{ add: true as const, value: q }] : [];
  const items: ({ add: true; value: string } | (Choice & { add?: false }))[] = list.length && typed ? [...list, ...addItem] : [...addItem, ...list];

  const show = () => {
    const r = input.current?.getBoundingClientRect();
    setUp(!!r && r.bottom + 240 > window.innerHeight);
    setOpen(true);
  };
  const pick = (v: string) => { onChange(v); setOpen(false); setTyped(false); };

  return (
    <div className="biz-combo">
      <input
        ref={input} className="biz-input" value={value} aria-label={ariaLabel} autoFocus={autoFocus} disabled={disabled}
        role="combobox" aria-expanded={open} aria-autocomplete="list" placeholder="고르거나 입력"
        onFocus={show} onClick={show}
        onBlur={() => { setOpen(false); setTyped(false); }}
        onChange={(e) => { onChange(e.target.value); setTyped(true); setActive(0); show(); }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) show(); setActive((i) => Math.min(i + 1, items.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          else if (e.key === 'Enter' && open && items[active]) { e.preventDefault(); pick(items[active].value); }
          else if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); }
        }}
      />
      {open && items.length > 0 && (
        <div className={`biz-combo-list ${up ? 'up' : ''}`} role="listbox" onMouseDown={(e) => e.preventDefault()}>
          {items.map((it, i) => (
            <div
              key={(it.add ? '+' : '') + it.value} role="option" aria-selected={!it.add && it.value === q}
              className={`biz-combo-item ${i === active ? 'active' : ''} ${!it.add && it.value === q ? 'selected' : ''}`}
              onMouseEnter={() => setActive(i)} onClick={() => pick(it.value)}
            >
              {it.add ? <span className="biz-combo-value biz-combo-add">새로 추가: <b>{it.value}</b></span> : <span className="biz-combo-value">{it.value}</span>}
              {!it.add && it.removable && (
                <button type="button" className="biz-combo-x" aria-label={`${it.value} 목록에서 지우기`} title="목록에서 지우기"
                  onClick={(e) => { e.stopPropagation(); onRemove(it); }}>×</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EditDialog({ title, subtitle, date, saleKey, specs, categories, note, onDone }: Props) {
  const [states, setStates] = useState<FieldState[]>(() => specs.map((s) => ({ field: s.field, kind: s.kind, initial: s.value, draft: s.value, reset: false })));
  const [choices, setChoices] = useState<Record<string, Choice[]>>(() => Object.fromEntries(specs.map((s) => [s.field, s.choices ?? []])));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (i: number, patch: Partial<FieldState>) => setStates((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const remove = async (field: string, c: Choice) => {
    try {
      if (field === 'category') {
        if (!c.id || !confirm(`'${c.value}' 구분을 목록에서 지울까요? 이 구분이 붙은 변동은 미분류로 옮겨집니다.`)) return;
        await biz.deleteCategory(c.id);
      } else {
        await biz.removeOption(field, c.value);
      }
      setChoices((m) => ({ ...m, [field]: (m[field] ?? []).filter((x) => x.value !== c.value) }));
      refreshSales();
    } catch (e: any) {
      setError(e?.message ?? '지우지 못했습니다');
    }
  };

  const save = async () => {
    const { edit, error: err } = buildSaleEdit(states, categories);
    if (err) { setError(err); return; }
    if (!Object.keys(edit).length) { onDone(); return; }
    setSaving(true);
    try {
      await api('bizEditSale', { date, key: saleKey, ...edit });
      refreshSales();
      onDone();
    } catch (e: any) {
      setError(e?.message ?? '저장하지 못했습니다');
      setSaving(false);
    }
  };

  const firstEnabled = specs.findIndex((s) => !s.disabled);
  return (
    <div className="biz-dialog-backdrop top" onMouseDown={(e) => { if (e.target === e.currentTarget) onDone(); }}>
      <form
        className="biz-dialog wide" role="dialog" aria-modal="true" aria-label={title}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onDone(); }}
        onSubmit={(e) => { e.preventDefault(); void save(); }}
      >
        <div>
          <h3>{title}</h3>
          {subtitle && <p className="biz-note biz-dialog-sub">{subtitle}</p>}
        </div>
        {note && <p className="biz-note">{note}</p>}
        <div className="biz-form">
          {specs.map((s, i) => {
            const st = states[i];
            const id = `biz-edit-${s.field}`;
            const edited = s.original !== undefined && !st.reset;
            return (
              <div key={s.field} className="biz-form-row">
                <label htmlFor={id}>{s.label}</label>
                <div className="biz-form-ctl">
                  {s.kind === 'option' || s.kind === 'category'
                    ? <Picker value={st.draft} choices={choices[s.field] ?? []} ariaLabel={s.label} autoFocus={i === firstEnabled} disabled={s.disabled}
                        onChange={(v) => set(i, { draft: v, reset: false })} onRemove={(c) => void remove(s.field, c)} />
                    : (
                      <input
                        id={id} className="biz-input" aria-label={s.label} autoFocus={i === firstEnabled} disabled={s.disabled}
                        type={s.kind === 'date' ? 'date' : 'text'} inputMode={s.kind === 'number' || s.kind === 'delta' ? 'numeric' : undefined}
                        value={st.draft} onChange={(e) => set(i, { draft: e.target.value, reset: false })}
                      />
                    )}
                  {edited && (
                    <span className="biz-form-hint">
                      {s.kind === 'delta' ? `직접 입력함 · 계산값 ${s.original}원` : `직접 고침 · 원래 값 ${s.original || '-'}`}
                      <button type="button" className="biz-link" onClick={() => set(i, { reset: true, draft: s.original ?? '' })}>
                        {s.kind === 'delta' ? '계산값으로' : '원래 값으로'}
                      </button>
                    </span>
                  )}
                  {s.original !== undefined && st.reset && <span className="biz-form-hint">저장하면 {s.kind === 'delta' ? '계산값으로' : '원래 값으로'} 돌아갑니다</span>}
                </div>
              </div>
            );
          })}
        </div>
        {error && <p className="biz-form-error" role="alert">{error}</p>}
        <div className="biz-dialog-actions">
          <button type="button" className="biz-btn" onClick={onDone}>취소</button>
          <button type="submit" className="biz-btn biz-btn-primary" disabled={saving}>{saving ? '저장 중…' : '저장'}</button>
        </div>
      </form>
    </div>
  );
}

export function openSaleEditor(props: Omit<Props, 'onDone'>) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const back = document.activeElement as HTMLElement | null;
  const done = () => {
    setTimeout(() => { root.unmount(); host.remove(); back?.focus?.(); }, 0);
  };
  root.render(<EditDialog {...props} onDone={done} />);
}

// ---------- 표에서 쓰는 도우미 ----------
const text = (v: unknown) => (v === null || v === undefined ? '' : String(v));
export const amountText = (v: unknown) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('ko-KR'));

/** 영업 건 칸 하나의 수정 창 항목. 직접 고친 칸이면 원래 값을 같이 넣는다. */
export function rowSpec(row: SalesRow, field: EditableField, label: string, kind: FieldKind, options?: Partial<Record<OptionField, OptionItem[]>>, disabled?: boolean): EditSpec {
  const fmt = kind === 'number' ? amountText : text;
  const edited = row.edited && field in row.edited;
  return {
    field, label, kind, disabled,
    value: fmt((row as any)[field]),
    original: edited ? fmt(row.edited![field]) : undefined,
    choices: kind === 'option' ? (options?.[field as OptionField] ?? []).map((o) => ({ value: o.value, removable: o.removable })) : undefined,
  };
}

/** 표 칸에 값을 보여 준다. 직접 고친 값이면 점선 밑줄과 원래 값 안내. */
export function Shown({ row, field, fmt = (v) => (v === null || v === undefined || v === '' ? '-' : String(v)), children }: {
  row: SalesRow | null; field: string; fmt?: (v: unknown) => string; children?: React.ReactNode;
}) {
  if (!row) return null;
  const edited = row.edited && field in row.edited;
  return (
    <span className={edited ? 'biz-edited' : undefined} title={edited ? `직접 고침 · 원래 값: ${fmt(row.edited![field])}` : undefined}>
      {children ?? fmt((row as any)[field])}
    </span>
  );
}

/** 행을 누르거나 Enter로 수정 창을 여는 tr 속성. 글자를 드래그해 고른 중이면 열지 않는다. */
export function openRowProps(readOnly: boolean | undefined, open: () => void) {
  if (readOnly) return {};
  return {
    className: 'biz-row-open',
    tabIndex: 0,
    title: '눌러서 수정',
    onClick: () => { if (!window.getSelection()?.toString()) open(); },
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); open(); } },
  };
}

