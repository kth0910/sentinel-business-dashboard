// 일정 블록 (biz_schedule): 시연판은 직접 입력. 업무관리시스템 일정 연동은 3단계(설계 6.2, 11.3).
import { registerBlock, type BlockProps } from '../editor/Block.tsx';
import { bizData, Field, isolate, saveBiz } from './fields.tsx';
import './biz.css';

interface Item { start: string; end: string; text: string }
interface Schedule { items: Item[] }

const byStart = (a: Item, b: Item) => (a.start || '99:99').localeCompare(b.start || '99:99');

function ScheduleBlock({ block, readOnly }: BlockProps) {
  const data = bizData<Schedule>(block, { items: [] });
  const items = data.items.map((it, i) => ({ ...it, i })).sort(byStart);
  const save = (next: Item[]) => saveBiz(block, { items: next });
  const setItem = (i: number, patch: Partial<Item>) => save(data.items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const morning = items.filter((it) => it.start && it.start < '12:00');
  const afternoon = items.filter((it) => !it.start || it.start >= '12:00');

  const group = (label: string, list: typeof items) => (
    <div className="biz-sched-group">
      <span className="biz-note">{label}</span>
      {list.length === 0 && <span className="biz-note biz-muted">일정 없음</span>}
      {list.map((it) => (
        <div key={it.i} className="biz-sched-item">
          <Field ariaLabel="시작 시각" type="time" className="biz-time" value={it.start} readOnly={readOnly} onCommit={(v) => setItem(it.i, { start: v })} />
          <span className="biz-note">–</span>
          <Field ariaLabel="종료 시각" type="time" className="biz-time" value={it.end} readOnly={readOnly} onCommit={(v) => setItem(it.i, { end: v })} />
          <Field ariaLabel="일정 내용" value={it.text} readOnly={readOnly} placeholder="일정 내용" onCommit={(v) => setItem(it.i, { text: v })} />
          {!readOnly && <button {...isolate} type="button" className="biz-link" aria-label="일정 삭제" onClick={() => save(data.items.filter((_, j) => j !== it.i))}>삭제</button>}
        </div>
      ))}
    </div>
  );

  return (
    <div className="biz-block" contentEditable={false} data-biz="schedule">
      <div className="biz-block-head">
        <h3>일정</h3>
        <span className="biz-tag hand">직접 입력 · 업무관리시스템 연동 예정</span>
      </div>
      <div className="biz-sched">
        {group('오전', morning)}
        {group('오후', afternoon)}
      </div>
      {!readOnly && <button {...isolate} type="button" className="biz-link" onClick={() => save([...data.items, { start: '', end: '', text: '' }])}>+ 일정 추가</button>}
    </div>
  );
}

registerBlock(['biz_schedule'], ScheduleBlock);
