// 업무 표 공용: 열 너비(머리글 경계 끌기), 행 높이(좁게·보통·넓게), 표 영역 크기(오른쪽 아래 모서리 끌기).
// 설정은 블록 서식 format.biz_layout에 저장 → 같은 블록을 보는 모든 사람에게 같게 보인다. 데이터(format.biz)와 따로 둔다.
import { useRef, useState, type ReactNode } from 'react';
import type { BlockRecord } from '@nc/shared/records.ts';
import { getBlock, run, setFormat } from '../../lib/blocks.ts';
import { isolate } from './fields.tsx';

export type Density = 'compact' | 'normal' | 'wide';
export interface TableLayout {
  cols?: Record<string, number>;
  density?: Density;
  /** 표 영역 크기(px). 없으면 내용에 맞춤 */
  width?: number | null;
  height?: number | null;
}
export interface ColDef {
  key: string;
  label: ReactNode;
  /** 기본 너비(px) */
  width: number;
  num?: boolean;
}

const MIN_COL = 48;
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

const DENSITY_LABEL: Record<Density, string> = { compact: '좁게', normal: '보통', wide: '넓게' };

/** 블록 머리에 두는 행 높이 선택과 크기 초기화. */
export function TableControls({ block, readOnly }: { block: BlockRecord; readOnly?: boolean }) {
  if (readOnly) return null;
  const layout = tableLayout(block);
  const density = layout.density ?? 'normal';
  const custom = !!(layout.width || layout.height || Object.keys(layout.cols ?? {}).length);
  return (
    <span className="biz-row">
      <span className="biz-seg" role="group" aria-label="행 높이">
        {(['compact', 'normal', 'wide'] as const).map((d) => (
          <button {...isolate} key={d} type="button" className={density === d ? 'on' : ''} aria-pressed={density === d} onClick={() => saveTableLayout(block.id, { density: d })}>
            {DENSITY_LABEL[d]}
          </button>
        ))}
      </span>
      {custom && (
        <button {...isolate} type="button" className="biz-link" title="열 너비와 표 크기를 처음대로" onClick={() => saveTableLayout(block.id, { cols: {}, width: null, height: null })}>
          크기 초기화
        </button>
      )}
    </span>
  );
}

/** 열 너비를 끌어서 바꿀 수 있는 표. tbody 행은 children으로 받는다. */
export function BizTable({ block, cols, readOnly, className, children }: {
  block: BlockRecord; cols: ColDef[]; readOnly?: boolean; className?: string; children: ReactNode;
}) {
  const layout = tableLayout(block);
  const [drag, setDrag] = useState<{ key: string; width: number } | null>(null);
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
      onPointerDown={(e) => { e.stopPropagation(); startBox(); }}
      className={`biz-table-wrap ${readOnly ? '' : 'resizable'}`}
      style={{ width: layout.width ?? undefined, height: layout.height ?? undefined, maxWidth: '100%' }}
    >
      <table className={`biz-table fixed dens-${layout.density ?? 'normal'} ${className ?? ''}`} style={{ width: total }}>
        <colgroup>{cols.map((c) => <col key={c.key} style={{ width: width(c) }} />)}</colgroup>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} className={c.num ? 'num' : undefined}>
                {c.label}
                {!readOnly && <span className="biz-col-grip" role="separator" aria-label="열 너비 조절" onPointerDown={(e) => startCol(e, c)} />}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
