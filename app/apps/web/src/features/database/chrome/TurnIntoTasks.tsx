import { HELP_URL } from '@nc/shared/brand.ts';
// "Turn into Tasks database" dialog (CollectionTypedDatabaseMigrationModal): pick the properties that represent status,
// assignee and due date ("Create new" when missing), preview of My Tasks, "Turn into task database".
import { useState } from 'react';
import type { CollectionRecord } from '@nc/shared/records.ts';
import { Icon } from '../../../components/Icon.tsx';
import { openNestedMenu as openMenu } from '../menus.ts';
import { openOverlay } from '../../../components/overlay.tsx';
import { useCollection } from '../../../lib/hooks.ts';
import { records } from '../../../lib/store/records.ts';
import { PropertyIcon } from '../properties/PropertyCell.tsx';
import { defaultRoleChoice, roleCandidates, turnIntoTaskDatabase, type RoleChoice } from '../taskdb.ts';
import './relationFeatures.css';

const ROLES: { id: 'status' | 'assignee' | 'due'; word: string; newName: string; newType: string }[] = [
  { id: 'status', word: 'status', newName: '상태', newType: 'status' },
  { id: 'assignee', word: 'assignee', newName: '담당자', newType: 'person' },
  { id: 'due', word: 'due date', newName: '마감일', newType: 'date' },
];

function TurnIntoTasks({ collectionId, close }: { collectionId: string; close: () => void }) {
  const c = useCollection(collectionId);
  const [choice, setChoice] = useState<Record<string, RoleChoice>>(() => {
    const col = records.get<CollectionRecord>('collection', collectionId);
    return col ? { status: defaultRoleChoice(col, 'status'), assignee: defaultRoleChoice(col, 'assignee'), due: defaultRoleChoice(col, 'due') } : {};
  });
  if (!c) return null;
  return (
    <div className="nc-tt-dialog" role="dialog" aria-label="작업 데이터베이스로 전환" data-menu-keys="ignore">
      <div className="nc-tt-title">작업 데이터베이스로 전환</div>
      <div className="nc-tt-sub">작업 표에는 상태, 담당자, 마감일 속성이 필요합니다.</div>
      {ROLES.map((r) => {
        const cur = choice[r.id];
        const prop = cur && cur !== 'new' ? c.schema[cur] : undefined;
        return (
          <div key={r.id} className="nc-tt-row">
            <div className="nc-tt-row-label">{`${r.word}을(를) 나타내는 속성 선택`}</div>
            <div
              role="button"
              className="nc-tt-select"
              data-testid={`task-role-${r.id}`}
              onClick={(e) => openMenu(e.currentTarget, {
                width: 280,
                sections: [{ items: [
                  ...roleCandidates(c, r.id).map(([id, p]) => ({ id, label: p.name, icon: <PropertyIcon prop={p} size={16} />, checked: cur === id, onSelect: () => setChoice({ ...choice, [r.id]: id }) })),
                  { id: 'new', label: '새로 만들기', icon: 'plus', checked: cur === 'new', onSelect: () => setChoice({ ...choice, [r.id]: 'new' }) },
                ] }],
              }, { placement: 'bottom-start' })}
            >
              {prop ? <PropertyIcon prop={prop} size={16} /> : <Icon name="plus" size={16} />}
              <span className="nc-tt-select-label">{prop ? prop.name : cur === 'new' ? `새로 만들기 · ${r.newName}` : '선택…'}</span>
              <Icon name="chevronDown" size={14} />
            </div>
            {r.id === 'status' && prop && prop.type !== 'status' && <div className="nc-tt-note">이 필드는 상태 필드 유형으로 변환됩니다.</div>}
          </div>
        );
      })}
      <div className="nc-tt-preview">
        <Icon name="checkmarkSquare" size={20} />
        <div>
          <div className="nc-tt-preview-title">내 작업</div>
          <div className="nc-tt-preview-desc">여러 테이블에 있는 내 작업을 개인 홈에서 한눈에 볼 수 있습니다.</div>
        </div>
      </div>
      <div className="nc-tt-footer">
        {HELP_URL && (<a className="nc-tt-learn" href={HELP_URL} target="_blank" rel="noreferrer">작업 데이터베이스 알아보기</a>)}
        <div role="button" className="nc-btn outline" onClick={close}>닫기</div>
        <div role="button" className="nc-btn primary" data-testid="turn-into-tasks-confirm" onClick={() => { turnIntoTaskDatabase(c, { status: choice.status, assignee: choice.assignee, due: choice.due }); close(); }}>작업 데이터베이스로 전환</div>
      </div>
    </div>
  );
}

export function openTurnIntoTasksDialog(collectionId: string) {
  return openOverlay((close) => <TurnIntoTasks collectionId={collectionId} close={close} />, { placement: 'center', backdrop: 'dim' });
}
