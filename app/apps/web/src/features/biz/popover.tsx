// 버튼 옆에 뜨는 창(모달 아님): 문서 위에 겹쳐 떠서 아래 내용이 밀리지 않는다.
// 바깥을 누르거나 Esc로 닫히고, 연 버튼을 다시 누르는 토글은 부르는 쪽이 close로 처리한다.
// 문서를 스크롤하면 버튼을 따라 움직이고, 아래 공간이 모자라면 버튼 위로 뜬다.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './biz.css';

const GAP = 6;
const MARGIN = 8;

function Shell({ anchor, label, close, children }: { anchor: HTMLElement; label: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      if (!anchor.isConnected) { close(); return; }
      const a = anchor.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const below = a.bottom + GAP;
      const top = below + h > window.innerHeight - MARGIN && a.top - GAP - h >= MARGIN ? a.top - GAP - h : below;
      setPos({ left: Math.max(MARGIN, Math.min(a.left, window.innerWidth - w - MARGIN)), top });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!el.contains(t) && !anchor.contains(t)) close();
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    // 편집기·입력칸이 이벤트 전달을 막아도 받도록 캡처 단계에서 듣는다
    window.addEventListener('mousedown', down, true);
    window.addEventListener('keydown', key, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('mousedown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, []);

  return (
    <div
      ref={ref} role="dialog" aria-label={label} className="biz-popover biz-panel"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0, visibility: 'hidden' }}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

/** anchor 옆에 창을 띄우고 닫는 함수를 돌려준다. onClose는 어떤 이유로든 닫힐 때 한 번 불린다. */
export function openPopover(anchor: HTMLElement, label: string, render: (close: () => void) => ReactNode, onClose?: () => void): () => void {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    onClose?.();
    setTimeout(() => { root.unmount(); host.remove(); }, 0);
  };
  root.render(<Shell anchor={anchor} label={label} close={close}>{render(close)}</Shell>);
  return close;
}
