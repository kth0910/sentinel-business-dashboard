// 업무 블록 공통: format.biz 읽기·저장, 편집기 단축키와 섞이지 않는 입력칸.
import { useEffect, useState } from 'react';
import type { BlockRecord } from '@nc/shared/records.ts';
import { getBlock, run, setFormat } from '../../lib/blocks.ts';

export function bizData<T>(block: BlockRecord, fallback: T): T {
  return ((block.format as any)?.biz as T | undefined) ?? fallback;
}

/** 저장하는 순간의 최신 블록 값에 변경을 적용한다. 화면을 그린 뒤 다른 사람이 바꾼 칸을 덮어쓰지 않는다(리뷰 #5). */
export function updateBiz<T>(blockId: string, fallback: T, change: (latest: T) => T) {
  const latest = getBlock(blockId);
  run('bizEdit', (tx) => setFormat(tx, blockId, { biz: change(latest ? bizData(latest, fallback) : fallback) } as any));
}

/** 편집기(블록 이동·삭제 단축키)가 입력칸의 키·마우스 이벤트를 가져가지 않게 막는다. */
export const isolate = {
  onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation(),
  onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
  onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
  onPaste: (e: React.ClipboardEvent) => e.stopPropagation(),
  onCopy: (e: React.ClipboardEvent) => e.stopPropagation(),
  onCut: (e: React.ClipboardEvent) => e.stopPropagation(),
};

/** 입력 중에는 로컬 값, 포커스를 잃거나 Enter를 누르면 저장. 다른 사람이 바꾼 값은 포커스가 없을 때 반영. */
export function Field({ value, onCommit, readOnly, placeholder, type = 'text', ariaLabel, className }: {
  value: string; onCommit: (v: string) => void; readOnly?: boolean; placeholder?: string; type?: string; ariaLabel: string; className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setDraft(value); }, [value, focused]);
  if (readOnly) return <span className={className}>{value || '—'}</span>;
  const commit = () => { if (draft !== value) onCommit(draft); };
  return (
    <input
      {...isolate}
      className={`biz-input ${className ?? ''}`}
      type={type}
      value={draft}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); commit(); }}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
      }}
    />
  );
}
