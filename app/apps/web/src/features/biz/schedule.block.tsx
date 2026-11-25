// 일정 블록 (biz_schedule): 직접 입력. 업무관리시스템 일정 연동은 3단계(설계 6.2, 11.3).
// 시간은 'HH:MM'으로 저장하고, 표시는 개인 설정(오전/오후 또는 24시간)을 따른다.
import { registerBlock, type BlockProps } from '../editor/Block.tsx';
import { bizData, Field, isolate, updateBiz } from './fields.tsx';
import { addRow, keyed, patchRow, removeRow } from './listEdit.ts';
import { formatTime, parseTime, type TimeMode } from './timeFormat.ts';
import { savePref, usePrefs } from '../settings/userSettings.ts';
import { useUI } from '../../lib/store/ui.ts';
import './biz.css';

interface Item { id?: string; start: string; end: string; text: string }
interface Schedule { items: Item[] }

const byStart = (a: Item, b: Item) => (a.start || '99:99').localeCompare(b.start || '99:99');

/** 오전/오후·24시간 표시는 개인 설정(계정에 저장, 모든 기기에서 같게). */
const TIME_PREF = 'biz_time_format';

function TimeField({ label, value, mode, readOnly, onCommit }: { label: string; value: string; mode: TimeMode; readOnly?: boolean; onCommit: (v: string) => void }) {
  return (
    <Field
      ariaLabel={label} className={`biz-time ${mode === '24h' ? 'h24' : ''}`} readOnly={readOnly}
      value={formatTime(value, mode)} placeholder={mode === '12h' ? '오전 9:00' : '09:00'}
      onCommit={(text) => {
        const t = parseTime(text);
        if (t === null) useUI.getState().toast('시간을 알아볼 수 없습니다. 예: 오후 2:30, 14:30');
        else if (t !== value) onCommit(t);
      }}
    />
  );
}

function ScheduleBlock({ block, readOnly }: BlockProps) {
  const mode: TimeMode = usePrefs()[TIME_PREF] === '24h' ? '24h' : '12h';
  const data = bizData<Schedule>(block, { items: [] });
  const items = keyed(data.items).sort(byStart);
  const update = (change: (items: Item[]) => Item[]) => updateBiz<Schedule>(block.id, { items: [] }, (d) => ({ items: change(d.items ?? []) }));
  const setItem = (id: string, patch: Partial<Item>) => update((list) => patchRow(list, id, patch));
  const morning = items.filter((it) => it.start && it.start < '12:00');
  const afternoon = items.filter((it) => !it.start || it.start >= '12:00');

  const group = (label: string, list: typeof items) => (
    <div className="biz-sched-group">
      <span className="biz-note">{label}</span>
      {list.length === 0 && <span className="biz-note biz-muted">일정 없음</span>}
      {list.map((it) => (
        <div key={it.id} className="biz-sched-item">
          <TimeField label="시작 시각" value={it.start} mode={mode} readOnly={readOnly} onCommit={(v) => setItem(it.id, { start: v })} />
          <span className="biz-note">–</span>
          <TimeField label="종료 시각" value={it.end} mode={mode} readOnly={readOnly} onCommit={(v) => setItem(it.id, { end: v })} />
          <Field ariaLabel="일정 내용" value={it.text} readOnly={readOnly} placeholder="일정 내용" onCommit={(v) => setItem(it.id, { text: v })} />
          {!readOnly && <button {...isolate} type="button" className="biz-link" aria-label="일정 삭제" onClick={() => update((list) => removeRow(list, it.id))}>삭제</button>}
        </div>
      ))}
    </div>
  );

  return (
    <div className="biz-block" contentEditable={false} data-biz="schedule">
      <div className="biz-block-head">
        <h3>일정</h3>
        <span className="biz-seg" role="group" aria-label="시간 표시">
          {(['12h', '24h'] as const).map((m) => (
            <button {...isolate} key={m} type="button" className={mode === m ? 'on' : ''} aria-pressed={mode === m} onClick={() => savePref(TIME_PREF, m)}>
              {m === '12h' ? '오전/오후' : '24시간'}
            </button>
          ))}
        </span>
      </div>
      <div className="biz-sched">
        {group('오전', morning)}
        {group('오후', afternoon)}
      </div>
      {!readOnly && <button {...isolate} type="button" className="biz-link" onClick={() => update((list) => addRow(list, { start: '', end: '', text: '' }))}>+ 일정 추가</button>}
    </div>
  );
}

registerBlock(['biz_schedule'], ScheduleBlock);
