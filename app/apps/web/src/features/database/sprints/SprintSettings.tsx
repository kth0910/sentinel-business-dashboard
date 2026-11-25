import { HELP_URL } from '@nc/shared/brand.ts';
// Sprints UI: View settings › More settings › Sprints (set up / settings / turn off), the "Complete sprint" toolbar
// button of sprint views and its summary modal.
import { useState } from 'react';
import type { BlockRecord, CollectionRecord, CollectionViewRecord } from '@nc/shared/records.ts';
import { dayIndex, dayString, sprintDatesOf, sprintStatusOf, sprintSummary, type SprintSettings } from '@nc/shared/database/index.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { Icon } from '../../../components/Icon.tsx';
import { openOverlay } from '../../../components/overlay.tsx';
import { useCollection } from '../../../lib/hooks.ts';
import { records } from '../../../lib/store/records.ts';
import { openPage } from '../../../lib/router.ts';
import { confirmDialog } from '../../page/confirm.tsx';
import { useDatabaseVersion } from '../data.ts';
import { VSRow as Row, VSSection as Section, VSToggleRow as ToggleRow, vsPick as pick } from '../chrome/ViewSettings.tsx';
import { completeSprint, manageSprintFromView, sprintInfo, sprintRows, todayStr, turnOffSprints, turnOnSprints, updateSprintSettings } from './sprints.ts';
import './sprints.css';

const WEEKDAYS = ['일요일', 'Monday', '화요일', 'Wednesday', '목요일', 'Friday', '토요일'];
const INCOMPLETE: { id: SprintSettings['incomplete_tasks']; label: string; short: string }[] = [
  { id: 'next_sprint', label: '다음 스프린트로 보내기', short: '다음 스프린트' },
  { id: 'backlog', label: '백로그로 보내기', short: '백로그' },
  { id: 'current_sprint', label: '현재 스프린트에 유지', short: '현재 스프린트' },
];

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "Next sprint starts in N days (date)" line for the settings panel. */
function nextStartLine(tasks: CollectionRecord): string | null {
  const info = sprintInfo(tasks);
  if (!info) return null;
  const cur = sprintRows(info).sprints.find((r) => sprintStatusOf(r, info) === 'Current');
  const dates = sprintDatesOf(cur, info);
  if (!dates) return null;
  const startNext = dayIndex(dates.end) + 1;
  const days = startNext - dayIndex(todayStr());
  if (days === 0) return '다음 스프린트는 오늘 시작해야 합니다';
  return days > 0 ? `다음 스프린트는 ${days}일 후 시작됩니다 (${fmtDate(dayString(startNext))})` : `다음 스프린트가 ${-days}일 전에 시작됐어야 합니다 (${fmtDate(dayString(startNext))})`;
}

export function SprintSettingsBody({ collection, view, readOnly, closePanel }: { collection: CollectionRecord; view: CollectionViewRecord; block: BlockRecord; readOnly: boolean; closePanel: () => void }) {
  useDatabaseVersion();
  const c = useCollection(collection.id) ?? collection;
  const info = sprintInfo(c);
  if (!info) {
    return (
      <>
        <div className="nc-rf-desc">스프린트는 작업을 반복되는 기간 단위로 나누어 관리합니다.</div>
        <div className="nc-rf-desc">We’ll also add this to your team:</div>
        <ul className="nc-sprint-setup-list">
          <li><b>스프린트 보드</b>: To manage tasks and plan your work</li>
          <li><b>스프린트 데이터베이스</b>: To keep a historical record of what you accomplished</li>
        </ul>
        <div className="nc-rf-cta"><div role="button" data-testid="turn-on-sprints" className={`nc-btn primary nc-rf-cta-btn ${readOnly ? 'disabled' : ''}`} onClick={() => {
          if (readOnly) return;
          const res = turnOnSprints(c);
          closePanel();
          if (res) openPage(res.boardId);
        }}>스프린트 사용</div></div>
        {HELP_URL && <Section divider><Row icon="questionMarkCircle" label="스프린트 알아보기" chevron={false} onClick={() => window.open(HELP_URL!, '_blank', 'noopener')} /></Section>}
      </>
    );
  }
  const s = info.settings;
  const line = nextStartLine(c);
  return (
    <>
      <Section className="nc-vs-sec first">
        <Row label="기간" value={`${s.duration_weeks} ${s.duration_weeks === 1 ? 'week' : 'weeks'}`} disabled={readOnly} onClick={(e) => pick(e.currentTarget, [1, 2, 3, 4, 5, 6, 7, 8].map((w) => ({ id: String(w), label: `${w}주`, checked: s.duration_weeks === w, onSelect: () => updateSprintSettings(c, { duration_weeks: w }) })))} />
        <Row label="시작 요일" value={`${WEEKDAYS[s.start_day]}s`} disabled={readOnly} onClick={(e) => pick(e.currentTarget, WEEKDAYS.map((d, i) => ({ id: d, label: `${d}s`, checked: s.start_day === i, onSelect: () => updateSprintSettings(c, { start_day: i }) })))} />
        {line && <div className="nc-rf-caption">{line}</div>}
        <Row label="미완료 작업" value={INCOMPLETE.find((x) => x.id === s.incomplete_tasks)?.short} disabled={readOnly} onClick={(e) => pick(e.currentTarget, INCOMPLETE.map((o) => ({ id: o.id, label: o.label, checked: s.incomplete_tasks === o.id, onSelect: () => updateSprintSettings(c, { incomplete_tasks: o.id }) })))} />
        <ToggleRow label="스프린트 자동화" on={s.automated} disabled={readOnly} onChange={(v) => updateSprintSettings(c, { automated: v })} />
        <div className="nc-rf-caption">다음 스프린트가 시작되기 전에 스프린트가 자동으로 종료됩니다.</div>
      </Section>
      <Section divider>
        <Row label="이 레이아웃의 스프린트 관리" chevron={false} disabled={readOnly || (view.format as Record<string, unknown>)?.sprint_view === 'current'} onClick={async () => {
          const ok = await confirmDialog({ message: '이 보기의 스프린트를 관리할까요?', description: s.automated ? '현재 스프린트 기준으로 필터가 적용되도록 레이아웃이 업데이트됩니다.' : '현재 스프린트용 필터가 레이아웃에 적용되고 스프린트 완료 버튼이 표시됩니다.', confirmLabel: '보기 업데이트', danger: false });
          if (ok) manageSprintFromView(view, c);
        }} />
        {HELP_URL && <Row icon="questionMarkCircle" label="스프린트 알아보기" chevron={false} onClick={() => window.open(HELP_URL!, '_blank', 'noopener')} />}
        <Row icon="trash" label="스프린트 해제" chevron={false} disabled={readOnly} testid="turn-off-sprints" onClick={async () => {
          const ok = await confirmDialog({ message: '스프린트를 해제할까요?', description: '스프린트 보드, 스프린트 표, 연결된 레이아웃이 삭제됩니다.', confirmLabel: '비활성화하고 삭제' });
          if (ok) {
            turnOffSprints(c);
            closePanel();
          }
        }} />
      </Section>
    </>
  );
}

// ------------------------------------------------------------------ Complete sprint

function CompleteSprintModal({ tasksId, close }: { tasksId: string; close: () => void }) {
  useDatabaseVersion();
  const tasks = useCollection(tasksId);
  const info = sprintInfo(tasks);
  const [incomplete, setIncomplete] = useState<SprintSettings['incomplete_tasks'] | null>(null);
  if (!tasks || !info) return null;
  const rows = sprintRows(info);
  const current = rows.sprints.find((r) => sprintStatusOf(r, info) === 'Current');
  const next = rows.sprints.find((r) => sprintStatusOf(r, info) === 'Next');
  if (!current) {
    return (
      <div className="nc-sprint-modal" role="dialog" aria-label="스프린트 완료">
        <div className="nc-sprint-modal-title">현재 스프린트가 없습니다</div>
        <div className="nc-sprint-modal-foot">
          <div role="button" className="nc-btn outline" onClick={close}>취소</div>
          <div role="button" className="nc-btn primary" onClick={() => { close(); openPage(info.sprints.parent_id); }}>스프린트 표에서 수정</div>
        </div>
      </div>
    );
  }
  const name = toPlainText(current.properties?.title as never) || '스프린트';
  const sum = sprintSummary(info, current.id, rows.tasks);
  const choice = incomplete ?? info.settings.incomplete_tasks;
  const nextDates = sprintDatesOf(next, info);
  return (
    <div className="nc-sprint-modal" role="dialog" aria-label={`${name} 요약`} data-menu-keys="ignore">
      <div className="nc-sprint-modal-title">{`${name} 요약`}</div>
      <div className="nc-sprint-modal-summary">
        <Icon name="checkmarkSquare" size={16} />
        <span data-testid="sprint-summary">{`할 일 ${sum.total}개 중 ${sum.completed}개 완료`}</span>
      </div>
      {sum.incomplete > 0 && (
        <div className="nc-sprint-modal-row">
          <div className="nc-sprint-modal-label">{`미완료 작업 ${sum.incomplete}개`}</div>
          <div role="button" className="nc-tt-select" data-testid="sprint-incomplete" onClick={(e) => pick(e.currentTarget, INCOMPLETE.map((o) => ({ id: o.id, label: o.label, checked: choice === o.id, onSelect: () => setIncomplete(o.id) })), 240)}>
            <span className="nc-tt-select-label">{INCOMPLETE.find((x) => x.id === choice)?.label}</span>
            <Icon name="chevronDown" size={14} />
          </div>
        </div>
      )}
      <div className="nc-sprint-modal-row">
        <div className="nc-sprint-modal-label">다음 스프린트 날짜</div>
        <div className="nc-sprint-modal-dates">{nextDates ? `${fmtDate(nextDates.start)} → ${fmtDate(nextDates.end)}` : '날짜 선택'}</div>
      </div>
      <div className="nc-sprint-modal-foot">
        <div role="button" className="nc-btn outline" onClick={close}>취소</div>
        <div role="button" className="nc-btn primary" data-testid="complete-sprint-confirm" onClick={() => { completeSprint(tasks, { incomplete: choice }); close(); }}>{`${name} 완료`}</div>
      </div>
    </div>
  );
}

export function openCompleteSprint(tasksCollectionId: string) {
  return openOverlay((close) => <CompleteSprintModal tasksId={tasksCollectionId} close={close} />, { placement: 'center', backdrop: 'dim' });
}

/** Toolbar "Complete sprint" button of a view managed as the current sprint (format.sprint_view = 'current'). */
export function SprintToolbarButton({ view, collection, readOnly }: { view: CollectionViewRecord; collection: CollectionRecord; readOnly: boolean }) {
  if ((view.format as Record<string, unknown> | undefined)?.sprint_view !== 'current' || readOnly || !sprintInfo(records.get<CollectionRecord>('collection', collection.id))) return null;
  return (
    <div role="button" className="nc-btn outline nc-sprint-complete-btn" data-testid="complete-sprint" onClick={() => openCompleteSprint(collection.id)}>
      <Icon name="checkmarkSquare" size={14} />
      <span>스프린트 완료</span>
    </div>
  );
}
