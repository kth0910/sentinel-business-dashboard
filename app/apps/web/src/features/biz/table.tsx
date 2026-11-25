// 업무 표 공용: 모두 끌어서 조절 — 열 너비(머리글 경계), 행 높이(행 아래 경계). 표 영역은 블록 크기(BizBlock)를 따라간다.
// 각각 두 번 누르면 원래대로.
// 설정은 블록 서식 format.biz_layout에 저장 → 같은 블록을 보는 모든 사람에게 같게 보인다. 데이터(format.biz)와 따로 둔다.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { BlockRecord } from '@nc/shared/records.ts';
import { getBlock, run, setFormat } from '../../lib/blocks.ts';
import { isolate } from './fields.tsx';
import { openFilterPopover } from './filterPopover.tsx';
import { activeFilterCount, applyFilters, distinctValues, type Filters } from './tableFilter.ts';
import { Icon } from '../../components/Icon.tsx';

export interface TableLayout {
  cols?: Record<string, number>;
  /** 모든 행 높이(px). 없으면 내용에 맞춤 */
  rowHeight?: number | null;
  /** 블록 전체 크기(px). 없으면 본문 폭·내용 높이. 화면 안을 넘지 않는다. 표 영역은 블록을 따라간다 */
  blockWidth?: number | null;
  blockHeight?: number | null;
  /** 열 필터(tableFilter.ts) */
  filters?: Filters;
}
export interface ColDef {
  key: string;
  label: ReactNode;
  /** 기본 너비(px) */
  width: number;
  num?: boolean;
  /** 필터에 쓰는 값. 없으면 이 열은 거르지 않는다 */
  value?: (row: any) => string | number | null | undefined;
}

const MIN_COL = 48;
const MIN_ROW = 24;
/** 행 아래 경계로 보는 범위(px) */
const ROW_EDGE = 5;

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
/** 이 블록에 저장된 필터로 거른 행. */
export function useFilteredRows<T>(block: BlockRecord, rows: T[], cols: ColDef[]): T[] {
  return applyFilters(rows, cols, tableLayout(block).filters);
}

/** 필터가 걸려 있으면 '필터 n개 · 보이는 건수 · 해제'. */
export function FilterNote({ block, readOnly, shown, total }: { block: BlockRecord; readOnly?: boolean; shown: number; total: number }) {
  const n = activeFilterCount(tableLayout(block).filters);
  if (!n) return null;
  return (
    <span className="biz-note biz-filter-note">
      필터 {n}개 · {shown.toLocaleString('ko-KR')}/{total.toLocaleString('ko-KR')}건
      {!readOnly && <button {...isolate} type="button" className="biz-link" onClick={() => saveTableLayout(block.id, { filters: {} })}>해제</button>}
    </span>
  );
}

/** 열 너비를 끌어서 바꿀 수 있는 표. filterRows(거르기 전 전체 행)를 주면 머리글에 필터가 생긴다. */
export function BizTable({ block, cols, readOnly, className, filterRows, children }: {
  block: BlockRecord; cols: ColDef[]; readOnly?: boolean; className?: string; filterRows?: unknown[]; children: ReactNode;
}) {
  const filters = tableLayout(block).filters ?? {};
  const openFilter = (e: React.MouseEvent, c: ColDef) => {
    e.stopPropagation();
    const all = filterRows ?? [];
    const counts: Record<string, number> = {};
    for (const v of all.map((r) => distinctValues([r], c)[0])) counts[v] = (counts[v] ?? 0) + 1;
    openFilterPopover((e.currentTarget as HTMLElement).getBoundingClientRect(), {
      title: typeof c.label === 'string' ? c.label : c.key,
      num: !!c.num,
      values: c.num ? [] : distinctValues(all, c),
      counts,
      current: filters[c.key],
      onChange: (f) => {
        const cur = { ...(tableLayout(getBlock(block.id) ?? block).filters ?? {}) };
        if (f) cur[c.key] = f;
        else delete cur[c.key];
        saveTableLayout(block.id, { filters: cur });
      },
    });
  };
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
  return (
    <div
      ref={box}
      {...isolate}
      onPointerDown={(e) => {
        e.stopPropagation();
        const tr = readOnly ? null : nearRowEdge(e);
        if (tr) startRow(e, tr);
      }}
      onPointerMove={(e) => { if (!readOnly && !rowDrag) setRowEdge(!!nearRowEdge(e)); }}
      onPointerLeave={() => setRowEdge(false)}
      onDoubleClick={(e) => {
        if (readOnly) return;
        if (nearRowEdge(e)) saveTableLayout(block.id, { rowHeight: null });
      }}
      className={`biz-table-wrap ${rowEdge || rowDrag ? 'row-edge' : ''}`}
    >
      <table className={`biz-table fixed ${rowH ? 'row-sized' : ''} ${className ?? ''}`} style={{ width: total, ...(rowH ? { ['--biz-row-h' as string]: `${rowH}px` } : {}) }}>
        <colgroup>{cols.map((c) => <col key={c.key} style={{ width: width(c) }} />)}</colgroup>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} className={c.num ? 'num' : undefined}>
                {c.label}
                {filterRows && c.value && !readOnly && (
                  <button
                    {...isolate} type="button" aria-label={`${typeof c.label === 'string' ? c.label : c.key} 필터`} title="필터"
                    className={`biz-col-filter ${activeFilterCount({ [c.key]: filters[c.key] ?? {} }) ? 'on' : ''}`}
                    onClick={(e) => openFilter(e, c)}
                  >
                    <Icon name="dbToolFilter" size={13} />
                  </button>
                )}
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
const MIN_BLOCK_H = 140;
/** 화면 끝에서 남길 여백(px) */
const EDGE = 24;

/**
 * 업무 블록 바깥 틀. 오른쪽 가장자리를 끌면 너비, 아래 가장자리를 끌면 높이, 오른쪽 아래 모서리를 끌면 둘 다 바뀐다(본문 폭보다 넓게도).
 * 안의 표·차트·일정은 블록 크기를 따라가고, 넘치면 그 안에서 스크롤된다.
 * 최대는 화면 안 — 창 크기·사이드바가 바뀌면 다시 재서 넘치지 않게 줄인다. 두 번 누르면 원래대로.
 */
export function BizBlock({ block, readOnly, biz, children }: { block: BlockRecord; readOnly?: boolean; biz: string; children: ReactNode }) {
  const layout = tableLayout(block);
  const ref = useRef<HTMLDivElement>(null);
  const [maxW, setMaxW] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ w: number | null; h: number | null } | null>(null);

  const limits = () => {
    const el = ref.current!;
    const r = el.getBoundingClientRect();
    return { w: Math.max(MIN_BLOCK, Math.floor(window.innerWidth - r.left - EDGE)), h: Math.max(MIN_BLOCK_H, Math.floor(window.innerHeight - 2 * EDGE)) };
  };

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setMaxW(limits().w);
    measure();
    window.addEventListener('resize', measure);
    const ro = new ResizeObserver(measure);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => { window.removeEventListener('resize', measure); ro.disconnect(); };
  }, []);

  const w = drag?.w ?? layout.blockWidth ?? null;
  const h = drag?.h ?? layout.blockHeight ?? null;
  const style: React.CSSProperties = {};
  if (w) Object.assign(style, { width: maxW ? Math.min(w, maxW) : w, maxWidth: 'none' });
  if (h) Object.assign(style, { height: Math.min(h, Math.max(MIN_BLOCK_H, window.innerHeight - 2 * EDGE)) });

  const start = (e: React.PointerEvent, dir: 'x' | 'y' | 'xy') => {
    const sx = dir !== 'y';
    const sy = dir !== 'x';
    e.preventDefault();
    e.stopPropagation();
    const el = ref.current;
    if (!el) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const w0 = el.offsetWidth;
    const h0 = el.offsetHeight;
    const max = limits();
    let cur = { w: w0, h: h0 };
    const move = (ev: PointerEvent) => {
      cur = {
        w: sx ? Math.min(max.w, Math.max(MIN_BLOCK, Math.round(w0 + ev.clientX - x0))) : w0,
        h: sy ? Math.min(max.h, Math.max(MIN_BLOCK_H, Math.round(h0 + ev.clientY - y0))) : h0,
      };
      setDrag({ w: sx ? cur.w : null, h: sy ? cur.h : null });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      const patch: Partial<TableLayout> = {};
      if (sx && cur.w !== w0) patch.blockWidth = cur.w;
      if (sy && cur.h !== h0) patch.blockHeight = cur.h;
      if (Object.keys(patch).length) saveTableLayout(block.id, patch);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div ref={ref} className={`biz-block ${w ? 'sized' : ''} ${h ? 'h-sized' : ''}`} contentEditable={false} data-biz={biz} style={style}>
      {children}
      {!readOnly && (
        <>
          <span
            {...isolate}
            className="biz-block-grip" role="separator" aria-orientation="vertical" aria-label="블록 너비 조절(두 번 누르면 원래대로)"
            title="끌어서 블록 너비 조절 · 두 번 누르면 원래대로"
            onPointerDown={(e) => start(e, 'x')}
            onDoubleClick={(e) => { e.stopPropagation(); saveTableLayout(block.id, { blockWidth: null }); }}
          />
          <span
            {...isolate}
            className="biz-block-grip-y" role="separator" aria-orientation="horizontal" aria-label="블록 높이 조절(두 번 누르면 원래대로)"
            title="끌어서 블록 높이 조절 · 두 번 누르면 원래대로"
            onPointerDown={(e) => start(e, 'y')}
            onDoubleClick={(e) => { e.stopPropagation(); saveTableLayout(block.id, { blockHeight: null }); }}
          />
          <span
            {...isolate}
            className="biz-block-corner" role="separator" aria-label="블록 크기 조절(두 번 누르면 원래대로)"
            title="끌어서 블록 크기 조절 · 두 번 누르면 원래대로"
            onPointerDown={(e) => start(e, 'xy')}
            onDoubleClick={(e) => { e.stopPropagation(); saveTableLayout(block.id, { blockWidth: null, blockHeight: null }); }}
          />
        </>
      )}
    </div>
  );
}
