// 업무 표 머리글의 필터 창: 값 목록(검색·체크) 또는 숫자 범위(최소·최대). 바깥을 누르거나 Esc로 닫힌다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ColFilter } from './tableFilter.ts';
import './biz.css';

interface Props {
  title: string;
  num: boolean;
  /** 값 목록(숫자 열이 아니면) */
  values: string[];
  counts: Record<string, number>;
  current: ColFilter | undefined;
  onChange: (f: ColFilter | null) => void;
  close: () => void;
}

const numText = (n: number | null | undefined) => (n == null ? '' : n.toLocaleString('ko-KR'));
const parseNum = (s: string): number | null => {
  const t = s.replace(/[,원\s]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

function Panel({ title, num, values, counts, current, onChange, close }: Props) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string[]>(current?.values ?? []);
  const [min, setMin] = useState(numText(current?.min));
  const [max, setMax] = useState(numText(current?.max));
  const shown = useMemo(() => values.filter((v) => v.toLowerCase().includes(q.trim().toLowerCase())), [values, q]);

  const toggle = (v: string) => {
    const next = sel.includes(v) ? sel.filter((x) => x !== v) : [...sel, v];
    setSel(next);
    onChange(next.length ? { values: next } : null);
  };
  const applyRange = () => {
    const a = parseNum(min);
    const b = parseNum(max);
    onChange(a == null && b == null ? null : { min: a, max: b });
    close();
  };

  return (
    <div className="biz-filter" role="dialog" aria-label={`${title} 필터`} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
      <div className="biz-filter-head">
        <strong>{title}</strong>
        {(sel.length > 0 || current?.min != null || current?.max != null) && (
          <button type="button" className="biz-link" onClick={() => { setSel([]); setMin(''); setMax(''); onChange(null); }}>해제</button>
        )}
      </div>
      {num ? (
        <>
          <label className="biz-filter-range">
            <span>최소</span>
            <input className="biz-input" inputMode="numeric" value={min} placeholder="예: 10,000,000" autoFocus onChange={(e) => setMin(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) applyRange(); }} />
          </label>
          <label className="biz-filter-range">
            <span>최대</span>
            <input className="biz-input" inputMode="numeric" value={max} placeholder="비워 두면 제한 없음" onChange={(e) => setMax(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) applyRange(); }} />
          </label>
          <div className="biz-dialog-actions"><button type="button" className="biz-btn biz-btn-primary" onClick={applyRange}>적용</button></div>
        </>
      ) : (
        <>
          {values.length > 8 && <input className="biz-input" value={q} placeholder="값 검색" autoFocus onChange={(e) => setQ(e.target.value)} />}
          <div className="biz-filter-list">
            {shown.map((v) => (
              <label key={v} className="biz-filter-item">
                <input type="checkbox" checked={sel.includes(v)} onChange={() => toggle(v)} />
                <span className="biz-filter-label">{v}</span>
                <span className="biz-note">{counts[v] ?? 0}</span>
              </label>
            ))}
            {shown.length === 0 && <span className="biz-note">맞는 값이 없습니다</span>}
          </div>
        </>
      )}
    </div>
  );
}

function Shell({ anchor, children, close }: { anchor: DOMRect; children: React.ReactNode; close: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + 4 });
  useEffect(() => {
    const el = ref.current;
    if (el) {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      setPos({
        left: Math.max(8, Math.min(anchor.left, window.innerWidth - w - 8)),
        top: anchor.bottom + 4 + h > window.innerHeight - 8 ? Math.max(8, anchor.top - h - 4) : anchor.bottom + 4,
      });
    }
    const down = (e: MouseEvent) => { if (el && !el.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    setTimeout(() => window.addEventListener('mousedown', down), 0);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('mousedown', down); window.removeEventListener('keydown', key); };
  }, []);
  return <div ref={ref} className="biz-popover" style={{ left: pos.left, top: pos.top }} onMouseDown={(e) => e.stopPropagation()}>{children}</div>;
}

export function openFilterPopover(anchor: DOMRect, props: Omit<Props, 'close'>) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    setTimeout(() => { root.unmount(); host.remove(); }, 0);
  };
  root.render(<Shell anchor={anchor} close={close}><Panel {...props} close={close} /></Shell>);
}
