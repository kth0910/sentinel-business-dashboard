// 이름 하나를 입력받는 작은 창(업무 블록 저장·이름 변경). Enter 저장, Esc 취소.
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './biz.css';

function NameDialog({ title, initial, okLabel, placeholder, maxLength, onDone }: {
  title: string; initial: string; okLabel: string; placeholder: string; maxLength: number; onDone: (v: string | null) => void;
}) {
  const [value, setValue] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.select(); }, []);
  const ok = () => { if (value.trim()) onDone(value.trim()); };
  return (
    <div className="biz-dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onDone(null); }}>
      <div className="biz-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        <input
          ref={input} autoFocus className="biz-input" value={value} maxLength={maxLength} placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) ok();
            if (e.key === 'Escape') onDone(null);
          }}
        />
        <div className="biz-dialog-actions">
          <button type="button" className="biz-btn" onClick={() => onDone(null)}>취소</button>
          <button type="button" className="biz-btn biz-btn-primary" disabled={!value.trim()} onClick={ok}>{okLabel}</button>
        </div>
      </div>
    </div>
  );
}

export function askName(title: string, initial = '', okLabel = '저장', placeholder = '예: 주간 회의록', maxLength = 60): Promise<string | null> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (v: string | null) => {
      root.unmount();
      host.remove();
      resolve(v);
    };
    root.render(<NameDialog title={title} initial={initial} okLabel={okLabel} placeholder={placeholder} maxLength={maxLength} onDone={done} />);
  });
}
