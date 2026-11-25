// 업무 표 공용: 모두 끌어서 조절 — 열 너비(머리글 경계), 행 높이(행 아래 경계), 표 영역(오른쪽 아래 모서리).
// 각각 두 번 누르면 원래대로.
// 설정은 블록 서식 format.biz_layout에 저장 → 같은 블록을 보는 모든 사람에게 같게 보인다. 데이터(format.biz)와 따로 둔다.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { BlockRecord } from '@nc/shared/records.ts';
import { getBlock, run, setFormat } from '../../lib/blocks.ts';
import { isolate } from './fields.tsx';

export interface TableLayout {
  cols?: Record<string, number>;
  /** 모든 행 높이(px). 없으면 내용에 맞춤 */
  rowHeight?: number | null;
  /** 표 영역 크기(px). 없으면 내용에 맞춤 */
  width?: number | null;
  height?: number | null;
  /** 블록 전체 너비(px). 없으면 본문 폭. 화면 오른쪽 끝을 넘지 않는다 */
  blockWidth?: number | null;
}
export interface ColDef {
  key: string;
  label: ReactNode;
  /** 기본 너비(px) */
  width: number;
  num?: boolean;
}

const MIN_COL = 48;
const MIN_ROW = 24;
/** 행 아래 경계로 보는 범위(px) */
const ROW_EDGE = 5;
/** 표 영역 모서리로 보는 범위(px) */
const CORNER = 18;
const MIN_BOX = { width: 240, height: 120 };

export function tableLayout(block: BlockRecord): TableLayout {
  return ((block.format as any)?.biz_layout as TableLayout | undefined) ?? {};
}

/** 저장하는 순간의 최신 블록 값에 합쳐 저장한다. */
export function saveTableLayout(blockId: string, patch: Partial<TableLayout>) {
  const latest = getBlock(blockId);
  const cur = latest ? tableLayout(latest) : {};
  run('bizLayout', (tx) => setFormat(tx, blockId, { biz_layout: { ...cur, ...patch } } as any));
}

/** 열 너비를 끌어서 바꿀 수 있는 표. tbody 행은 children으로 받는다. */
export function BizTable({ block, cols, readOnly, className, children }: {
  block: BlockRecord; cols: ColDef[]; readOnly?: boolean; className?: string; children: ReactNode;
}) {
  const layout = tableLayout(block);
  const [drag, setDrag] = useState<{ key: string; width: number } | null>(null);
  const [rowDrag, setRowDrag] = useState<number | null>(null);
  const [rowEdge, setRowEdge] = useState(false);
  const rowH = rowDrag ?? layout.rowHeight ?? null;
  const width = (c: ColDef) => (drag?.key === c.key ? drag.width : layout.cols?.[c.key] ?? c.width);
  const total = cols.reduce((a, c) => a + width(c), 0);
  const box = useRef<HTMLDivElement>(null);

  const startCol = (e: React.PointerEvent, c: ColDef) => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const w0 = width(c);
    let w = w0;
    const move = (ev: PointerEvent) => {
      w = Math.max(MIN_COL, Math.round(w0 + ev.clientX - x0));
      setDrag({ key: c.key, width: w });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      if (w !== w0) saveTableLayout(block.id, { cols: { ...(tableLayout(getBlock(block.id) ?? block).cols ?? {}), [c.key]: w } });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // 행 높이: 아무 행이나 아래 경계선(맨 아래 5px)을 끌면 모든 행 높이가 같이 바뀐다
  const nearRowEdge = (e: React.PointerEvent | React.MouseEvent) => {
    const td = (e.target as HTMLElement).closest?.('tbody td') as HTMLElement | null;
    return td && e.clientY >= td.getBoundingClientRect().bottom - ROW_EDGE ? (td.parentElement as HTMLElement) : null;
  };
  const startRow = (e: React.PointerEvent, tr: HTMLElement) => {
    e.preventDefault();
    e.stopPropagation();
    const y0 = e.clientY;
    const h0 = tr.offsetHeight;
    let h = h0;
    const move = (ev: PointerEvent) => {
      h = Math.max(MIN_ROW, Math.round(h0 + ev.clientY - y0));
      setRowDrag(h);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setRowDrag(null);
      if (h !== h0) saveTableLayout(block.id, { rowHeight: h });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const nearCorner = (e: React.MouseEvent) => {
    const r = box.current?.getBoundingClientRect();
    return !!r && e.clientX >= r.right - CORNER && e.clientY >= r.bottom - CORNER;
  };

  // 표 영역: CSS resize 모서리를 끈 뒤 손을 떼면 크기를 저장한다
  const startBox = () => {
    const el = box.current;
    if (!el || readOnly) return;
    const before = { w: el.offsetWidth, h: el.offsetHeight };
    const up = () => {
      window.removeEventListener('pointerup', up);
      const after = { w: el.offsetWidth, h: el.offsetHeight };
      if (Math.abs(after.w - before.w) > 2 || Math.abs(after.h - before.h) > 2) {
        saveTableLayout(block.id, { width: Math.max(MIN_BOX.width, after.w), height: Math.max(MIN_BOX.height, after.h) });
      }
    };
    window.addEventListener('pointerup', up);
  };

  return (
    <div
      ref={box}
      {...isolate}
      onPointerDown={(e) => {
        e.stopPropagation();
        const tr = readOnly ? null : nearRowEdge(e);
        if (tr) startRow(e, tr);
        else startBox();
      }}
      onPointerMove={(e) => { if (!readOnly && !rowDrag) setRowEdge(!!nearRowEdge(e)); }}
      onPointerLeave={() => setRowEdge(false)}
      onDoubleClick={(e) => {
        if (readOnly) return;
        if (nearRowEdge(e)) saveTableLayout(block.id, { rowHeight: null });
        else if (nearCorner(e)) saveTableLayout(block.id, { width: null, height: null });
      }}
      className={`biz-table-wrap ${readOnly ? '' : 'resizable'} ${rowEdge || rowDrag ? 'row-edge' : ''}`}
      style={{ width: layout.width ?? undefined, height: layout.height ?? undefined, maxWidth: '100%' }}
    >
      <table className={`biz-table fixed ${rowH ? 'row-sized' : ''} ${className ?? ''}`} style={{ width: total, ...(rowH ? { ['--biz-row-h' as string]: `${rowH}px` } : {}) }}>
        <colgroup>{cols.map((c) => <col key={c.key} style={{ width: width(c) }} />)}</colgroup>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} className={c.num ? 'num' : undefined}>
                {c.label}
                {!readOnly && (
                  <span
                    className="biz-col-grip" role="separator" aria-label="열 너비 조절(두 번 누르면 원래대로)" title="끌어서 열 너비 조절 · 두 번 누르면 원래대로"
                    onPointerDown={(e) => startCol(e, c)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      const cols = { ...(tableLayout(getBlock(block.id) ?? block).cols ?? {}) };
                      delete cols[c.key];
                      saveTableLayout(block.id, { cols });
                    }}
                  />
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const MIN_BLOCK = 320;
/** 화면 오른쪽 끝에서 남길 여백(px) */
const EDGE = 24;

/**
 * 업무 블록 바깥 틀. 오른쪽 가장자리를 끌면 블록 전체 너비가 바뀐다(본문 폭보다 넓게도).
 * 최대는 화면 오른쪽 끝까지 — 창 크기·사이드바가 바뀌면 다시 재서 넘치지 않게 줄인다. 두 번 누르면 본문 폭으로.
 */
export function BizBlock({ block, readOnly, biz, children }: { block: BlockRecord; readOnly?: boolean; biz: string; children: ReactNode }) {
  const saved = tableLayout(block).blockWidth ?? null;
  const ref = useRef<HTMLDivElement>(null);
  const [maxW, setMaxW] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setMaxW(Math.max(MIN_BLOCK, Math.floor(window.innerWidth - el.getBoundingClientRect().left - EDGE)));
    measure();
    window.addEventListener('resize', measure);
    const ro = new ResizeObserver(measure);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => { window.removeEventListener('resize', measure); ro.disconnect(); };
  }, []);

  const w = drag ?? saved;
  const style = w ? { width: maxW ? Math.min(w, maxW) : w, maxWidth: 'none' } : undefined;

  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = ref.current;
    if (!el) return;
    const x0 = e.clientX;
    const w0 = el.offsetWidth;
    const max = Math.max(MIN_BLOCK, Math.floor(window.innerWidth - el.getBoundingClientRect().left - EDGE));
    let cur = w0;
    const move = (ev: PointerEvent) => {
      cur = Math.min(max, Math.max(MIN_BLOCK, Math.round(w0 + ev.clientX - x0)));
      setDrag(cur);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      if (cur !== w0) saveTableLayout(block.id, { blockWidth: cur });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div ref={ref} className={`biz-block ${w ? 'sized' : ''}`} contentEditable={false} data-biz={biz} style={style}>
      {children}
      {!readOnly && (
        <span
          {...isolate}
          className="biz-block-grip" role="separator" aria-orientation="vertical" aria-label="블록 너비 조절(두 번 누르면 원래대로)"
          title="끌어서 블록 너비 조절 · 두 번 누르면 원래대로"
          onPointerDown={start}
          onDoubleClick={(e) => { e.stopPropagation(); saveTableLayout(block.id, { blockWidth: null }); }}
        />
      )}
    </div>
  );
}
