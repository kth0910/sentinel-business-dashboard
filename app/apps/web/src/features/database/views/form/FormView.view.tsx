import { HELP_URL } from '@nc/shared/brand.ts';
// Form builder view: questions linked to properties, title, description, icon, and cover,
// question options (Required / Description / Long answer / Display options as / Sync with the field name / Move /
// Delete), "+" Add question (new property or existing property), Preview + Share form (who can fill out,
// access to submission, copy link). Responses become rows of the data source (server submitFormResponse).
//: (title 40px/700,
// description, access banner, question cards radius 12 padding 12 inset 0.5px var(--lp-blue-border-strong), question titles
// 24px/30px 700, answer boxes 16px inset 1px var(--lp-border-secondary)).
import { useEffect, useRef, useState } from 'react';
import * as L from 'lucide-react';
import type { BlockRecord, CollectionRecord, CollectionViewRecord, PropertySchema, PropertyType, SpaceRecord } from '@nc/shared/records.ts';
import {
  FORM_QUESTION_TYPES, QUESTION_TYPE_LABEL, defaultFormConfig, formConfigOf, questionFor, questionName, supportedPropertyIds, supportsQuestion,
  type FormCondition, type FormConfig, type FormPermission, type FormQuestion, type FormQuestionConfig, type FormSubmitScreen, type SubmissionAccess,
} from '@nc/shared/form/index.ts';
import { registerToolbarExtra, registerView, registerViewSettingsMain, type ToolbarExtraProps, type ViewProps, type ViewSettingsMainProps } from '../../viewRegistry.ts';
import { Icon, registerIcons } from '../../../../components/Icon.tsx';
import { openMenu, type MenuItemDef } from '../../../../components/Menu.tsx';
import { openOverlay, PopoverSurface } from '../../../../components/overlay.tsx';
import { run } from '../../../../lib/blocks.ts';
import { api } from '../../../../lib/api.ts';
import { compactId } from '@nc/shared/ids.ts';
import { records } from '../../../../lib/store/records.ts';
import { useSession } from '../../../../lib/store/session.ts';
import { useUI } from '../../../../lib/store/ui.ts';
import { useCollection, useCollectionView } from '../../../../lib/hooks.ts';
import { openIconPicker } from '../../../page/IconPicker.tsx';
import { PropertyIcon } from '../../properties/PropertyCell.tsx';
import { openEditPropertyPopover } from '../../properties/PropertyMenus.tsx';
import { OptionPill } from '../../properties/ValueView.tsx';
import { Toggle } from '../../properties/editors/DatePicker.tsx';
import { addProperty, changePropertyType, deleteView, duplicateProperty, viewCreationHooks } from '../../actions.ts';
import { collectionTemplates } from '../../data.ts';
import { confirmDialog } from '../../../page/confirm.tsx';
import { COLOR_LABELS } from '@nc/shared/colors.ts';
import { ColorSwatch } from '../../properties/editors/SelectEditor.tsx';
import { SettingsRow, openNestedMenu, setFormat, useViewKit } from '../../advanced/viewKit.tsx';
import { FormRenderer, type PublicForm } from './FormRenderer.tsx';
import './form.css';

registerIcons({ ncAsterisk: L.Asterisk, ncFormIcon: L.Smile, ncFormCover: L.Image, ncEye: L.Eye, ncLock: L.Lock, ncGlobe: L.Globe, ncSync: L.ArrowLeftRight, ncMove: L.ArrowUpDown, ncBranch: L.Split });

/** Max selection menu: no limit, 1–5, or a custom number. */
function openMaxSelection(anchor: HTMLElement, q: FormQuestion, set: (n: number | undefined) => void) {
  let close: () => void = () => {};
  const custom = (
    <div className="nc-form-maxsel" data-menu-keys="ignore">
      <input
        className="nc-form-maxsel-input"
        placeholder="사용자 지정"
        defaultValue={q.config.maxSelection && ![1, 2, 3, 4, 5].includes(q.config.maxSelection) ? String(q.config.maxSelection) : ''}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          const n = Number((e.target as HTMLInputElement).value);
          if (!Number.isInteger(n) || n < 1) {
            useUI.getState().toast('숫자를 입력하세요.');
            return;
          }
          set(n);
          close();
        }}
      />
    </div>
  );
  close = openNestedMenu(anchor, {
    width: 200,
    header: <div className="nc-form-add-head">최대 선택 수</div>,
    sections: [{ items: [
      { id: 'none', label: '제한 없음', checked: !q.config.maxSelection, onSelect: () => set(undefined) },
      ...[1, 2, 3, 4, 5].map((n) => ({ id: String(n), label: String(n), checked: q.config.maxSelection === n, onSelect: () => set(n) })),
    ] }],
    footer: custom,
  }, { placement: 'right-start' });
}

/** "Create a condition": the next question that isn't branching yet (or a new Text question) is asked only when * the trigger's answer matches — the condition starts on the trigger's first option ("checked" for a checkbox). */
function addConditionalGroup(viewId: string, collectionId: string, triggerId: string) {
  const view = records.get<CollectionViewRecord>('collection_view', viewId);
  const col = records.get<CollectionRecord>('collection', collectionId);
  if (!view || !col) return;
  const cfg = formConfigOf(view.format as Record<string, unknown>);
  if (!cfg) return;
  const at = cfg.questions.findIndex((x) => x.id === triggerId);
  const trigger = cfg.questions[at];
  const prop = trigger ? col.schema[trigger.config.propertyId] : undefined;
  if (!trigger || !prop) return;
  const first = prop.type === 'checkbox' ? 'checked' : prop.options?.[0]?.value;
  const condition: FormCondition = { questionId: triggerId, operator: 'any', values: first ? [first] : [] };
  let list = [...cfg.questions];
  const next = list[at + 1];
  if (next && !next.config.condition) list[at + 1] = { ...next, config: { ...next.config, condition } };
  else {
    const pid = addProperty(collectionId, 'text', { name: `Question ${list.length + 1}`, action: 'formQuestionCreateSettings.newQuestion' });
    if (!pid) return;
    list = [...list.slice(0, at + 1), questionFor(pid, { condition }), ...list.slice(at + 1)];
  }
  setFormat(view, { form_config: { ...cfg, questions: list } }, 'formQuestionEditSettings.addConditionalLogic');
}

/** The "If … is selected" header of a conditional group. */
function ConditionHeader({ q, trigger, prop, readOnly, onChange, onDelete, onAddMore }: {
  q: FormQuestion; trigger: FormQuestion; prop: PropertySchema; readOnly: boolean;
  onChange: (c: FormCondition) => void; onDelete: () => void; onAddMore: (e: React.MouseEvent<HTMLElement>) => void;
}) {
  const c = q.config.condition!;
  const pick = (e: React.MouseEvent<HTMLElement>) => {
    if (readOnly) return;
    if (prop.type === 'checkbox') {
      openNestedMenu(e.currentTarget, { width: 180, sections: [{ items: (['checked', 'unchecked'] as const).map((v) => ({ id: v, label: v, checked: c.values[0] === v, onSelect: () => onChange({ ...c, values: [v] }) })) }] }, { placement: 'bottom-start' });
      return;
    }
    const opts = prop.options ?? [];
    openNestedMenu(e.currentTarget, { width: 220, sections: [{ items: opts.map((o) => ({ id: o.id, label: <OptionPill option={o} />, text: o.value, checked: c.values.includes(o.value), onSelect: () => { onChange({ ...c, values: c.values.includes(o.value) ? c.values.filter((v) => v !== o.value) : [...c.values, o.value] }); return false; } })) }] }, { placement: 'bottom-start' });
  };
  const valuesLabel = c.values.length ? c.values.join(', ') : '선택';
  return (
    <div className="nc-form-cond-head" data-testid="form-condition">
      <Icon name="ncBranch" size={14} />
      {prop.type === 'checkbox' ? (
        <span>만약 <span role="button" className="nc-form-cond-chip" onClick={pick}>{questionName(trigger, {})} {c.values[0] ?? 'checked'}</span></span>
      ) : prop.type === 'multi_select' ? (
        <span>만약 <span role="button" className="nc-form-cond-chip" onClick={(e) => !readOnly && openNestedMenu(e.currentTarget, { width: 160, sections: [{ items: (['any', 'all'] as const).map((op) => ({ id: op, label: op, checked: c.operator === op, onSelect: () => onChange({ ...c, operator: op }) })) }] }, { placement: 'bottom-start' })}>{c.operator}</span> of <span role="button" className="nc-form-cond-chip" onClick={pick}>{valuesLabel}</span> is selected</span>
      ) : (
        <span>만약 <span role="button" className="nc-form-cond-chip" onClick={pick}>{valuesLabel}</span> is selected</span>
      )}
      <span style={{ flex: 1 }} />
      {!readOnly && <span role="button" className="nc-form-cond-btn" onClick={onAddMore}>질문 더 만들기</span>}
      {!readOnly && <span role="button" className="nc-form-cond-btn icon" aria-label="조건 삭제" data-tooltip="조건 삭제" onClick={onDelete}><Icon name="trash" size={14} /></span>}
    </div>
  );
}

const NEW_QUESTION_TYPES: PropertyType[] = ['text', 'number', 'select', 'multi_select', 'date', 'person', 'file', 'checkbox', 'url', 'email', 'phone_number', 'place'] as PropertyType[];
const TEXT_LIKE = new Set(['title', 'text']);
const COVERS = [
  'linear-gradient(120deg, #f6d365 0%, #fda085 100%)', 'linear-gradient(120deg, #a1c4fd 0%, #c2e9fb 100%)', 'linear-gradient(120deg, #d4fc79 0%, #96e6a1 100%)',
  'linear-gradient(120deg, #fbc2eb 0%, #a6c1ee 100%)', 'linear-gradient(120deg, #e0c3fc 0%, #8ec5fc 100%)',
];

export function formLink(viewId: string): string {
  return `${location.origin}/form/${compactId(viewId)}`;
}

function spaceName(): string {
  const sid = useSession.getState().spaceId;
  return (sid && records.get<SpaceRecord>('space', sid)?.name) || 'this workspace';
}

function formOps(view: ViewProps['view'], schema: Record<string, PropertySchema>) {
  const cfg: FormConfig = formConfigOf(view.format as Record<string, unknown>) ?? defaultFormConfig(schema);
  const save = (next: FormConfig, action = 'formEditor.update') => setFormat(view, { form_config: next }, action);
  const setQuestions = (questions: FormQuestion[], action?: string) => save({ ...cfg, questions }, action);
  const updateQuestion = (id: string, patch: Partial<FormQuestionConfig>) => setQuestions(cfg.questions.map((q) => (q.id === id ? { ...q, config: { ...q.config, ...patch } } : q)), 'formQuestionEditSettings.update');
  return { cfg, save, setQuestions, updateQuestion };
}

function PlainEditable({ value, placeholder, className, onCommit, readOnly, testId }: { value: string; placeholder: string; className: string; onCommit: (v: string) => void; readOnly?: boolean; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current && ref.current.textContent !== value) ref.current.textContent = value;
  }, [value]);
  return (
    <div
      ref={ref}
      className={`${className} nc-form-editable`}
      data-testid={testId}
      contentEditable={!readOnly}
      suppressContentEditableWarning
      spellCheck
      role="textbox"
      data-placeholder={placeholder}
      onBlur={(e) => {
        const t = (e.currentTarget.textContent ?? '').replace(/\n+/g, ' ').trim();
        if (t !== value) onCommit(t);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          (e.currentTarget as HTMLDivElement).blur();
        }
        if (e.key === 'Escape') (e.currentTarget as HTMLDivElement).blur();
      }}
    />
  );
}

function AnswerPreview({ q, prop, onCheckboxLabel, readOnly, collectionId }: { q: FormQuestion; prop: PropertySchema; onCheckboxLabel: (v: string) => void; readOnly: boolean; collectionId: string }) {
  switch (prop.type) {
    case 'checkbox':
      return (
        <div className="nc-form-b-checkbox">
          <span className="nc-form-checkbox-box" />
          <PlainEditable value={q.config.checkboxLabel ?? ''} placeholder="체크박스 문구(선택)" className="nc-form-b-cblabel" onCommit={onCheckboxLabel} readOnly={readOnly} />
        </div>
      );
    case 'select':
    case 'multi_select': {
      const multi = prop.type === 'multi_select';
      const opts = prop.options ?? [];
      const addOption = (value: string) => {
        const v = value.trim();
        if (!v || opts.some((o) => o.value === v)) return;
        const colors = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
        run('formEditorQuestion.addOption', (tx) => tx.update('collection', collectionId, ['schema', q.config.propertyId], { options: [...opts, { id: crypto.randomUUID(), value: v, color: colors[opts.length % colors.length] }] }));
      };
      return (
        <div className="nc-form-b-options">
          {q.config.displayMode === 'dropdown' && <div className="nc-form-b-input dropdown">이 옵션이 메뉴에 표시됩니다<Icon name="chevronDown" size={14} color="var(--lp-icon-tertiary)" /></div>}
          {opts.map((o) => (
            <div key={o.id} className="nc-form-b-option">
              <span className={`nc-form-option-mark ${multi ? 'square' : 'round'}`} />
              <OptionPill option={o} />
            </div>
          ))}
          {!readOnly && (
            <div className="nc-form-b-option add">
              <span className={`nc-form-option-mark ${multi ? 'square' : 'round'}`} />
              <input className="nc-form-b-addopt" placeholder="옵션 추가" onKeyDown={(e) => { if (e.key === 'Enter') { addOption((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).value = ''; } }} onBlur={(e) => { addOption(e.target.value); e.target.value = ''; }} />
            </div>
          )}
          {multi && <div className="nc-form-hint">(Respondents can choose any number of options)</div>}
        </div>
      );
    }
    case 'file':
      return <div className="nc-form-b-upload"><Icon name="upload" size={14} />업로드</div>;
    default: {
      const icon = prop.type === 'date' ? 'calendar' : prop.type === 'person' ? 'person' : prop.type === 'relation' ? 'relation' : null;
      return (
        <div className={`nc-form-b-input ${q.config.isLongAnswer ? 'long' : ''}`}>
          <span>응답자의 답변</span>
          {icon && <Icon name={icon} size={16} color="var(--lp-icon-tertiary)" />}
        </div>
      );
    }
  }
}

function ToggleRowSmall({ icon, label, on, onChange, disabled }: { icon: string; label: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <SettingsRow icon={icon} label={label} chevron={false} disabled={disabled} right={<Toggle on={on} onChange={onChange} disabled={disabled} />} onClick={() => onChange(!on)} />;
}

function QuestionOptions({ viewId, collectionId, questionId, close }: { viewId: string; collectionId: string; questionId: string; close: () => void }) {
  const view = useCollectionView(viewId);
  const col = useCollection(collectionId);
  if (!view || !col) return null;
  const schema = col.schema;
  const { cfg, setQuestions, updateQuestion } = formOps(view, schema);
  const q = cfg.questions.find((x) => x.id === questionId);
  if (!q) return null;
  const prop = schema[q.config.propertyId];
  const idx = cfg.questions.indexOf(q);
  const move = (to: number) => {
    const list = cfg.questions.filter((x) => x.id !== q.id);
    list.splice(Math.max(0, Math.min(list.length, to)), 0, q);
    setQuestions(list, 'formQuestionEditSettings.moveQuestion');
  };
  return (
    <div className="nc-form-qopts" data-testid="form-question-options">
      <div className="nc-form-qopts-head"><span>질문 옵션</span><span role="button" className="nc-panel-close" aria-label="닫기" onClick={close}><Icon name="close" size={14} /></span></div>
      <div className="nc-menu-section">
        <ToggleRowSmall icon="ncAsterisk" label="필수" on={!!q.config.isRequired} onChange={(v) => updateQuestion(q.id, { isRequired: v })} />
        <ToggleRowSmall icon="alignLeft" label="설명" on={!!q.config.hasDescription} onChange={(v) => updateQuestion(q.id, { hasDescription: v })} />
        {prop && TEXT_LIKE.has(prop.type) && <ToggleRowSmall icon="fullWidth" label="장문 답변" on={!!q.config.isLongAnswer} onChange={(v) => updateQuestion(q.id, { isLongAnswer: v })} />}
      </div>
      <div className="nc-menu-section with-divider">
        {/* Question type = the linked property's type; the title question keeps Title */}
        <SettingsRow icon="squareGrid2X2" label="질문 유형" value={prop ? QUESTION_TYPE_LABEL[prop.type] ?? prop.type : 'Not Found'} chevron={!!prop && prop.type !== 'title'} disabled={!prop || prop.type === 'title'} onClick={(e) => openNestedMenu(e.currentTarget, {
          width: 220, sections: [{ items: FORM_QUESTION_TYPES.filter((t) => t !== 'title').map((t) => ({ id: t, label: QUESTION_TYPE_LABEL[t] ?? t, icon: <PropertyIcon prop={{ type: t }} size={16} />, checked: prop?.type === t, onSelect: () => changePropertyType(collectionId, q.config.propertyId, t as PropertyType) })) }],
        }, { placement: 'right-start' })} />
        {/* Max selection: multi-select, person and relation questions */}
        {prop && (prop.type === 'multi_select' || prop.type === 'person' || prop.type === 'relation') && (
          <SettingsRow icon="number" label="최대 선택 수" value={q.config.maxSelection ? String(q.config.maxSelection) : '제한 없음'} disabled={prop.type === 'relation' && (prop as { limit?: number }).limit === 1} onClick={(e) => openMaxSelection(e.currentTarget, q, (n) => updateQuestion(q.id, { maxSelection: n }))} />
        )}
        {prop && (prop.type === 'select' || prop.type === 'multi_select') && (
          <SettingsRow icon="listDash" label="옵션 표시 방식" value={q.config.displayMode === 'dropdown' ? '드롭다운' : '목록 보기'} onClick={(e) => openNestedMenu(e.currentTarget, {
            width: 200, sections: [{ items: [
              { id: 'dropdown', label: '드롭다운', checked: q.config.displayMode === 'dropdown', onSelect: () => updateQuestion(q.id, { displayMode: 'dropdown' }) },
              { id: 'list', label: '목록 보기', checked: q.config.displayMode !== 'dropdown', onSelect: () => updateQuestion(q.id, { displayMode: 'list' }) },
            ] }],
          }, { placement: 'right-start' })} />
        )}
        <SettingsRow icon="databaseEmbed" label="연결된 필드 열기" disabled={!prop} onClick={(e) => openEditPropertyPopover(e.currentTarget, collectionId, q.config.propertyId, view, { placement: 'right-start' })} />
        <ToggleRowSmall icon="ncSync" label="필드 이름과 동기화" on={q.config.shouldSyncQuestionNameToPropertyName !== false} onChange={(v) => updateQuestion(q.id, { shouldSyncQuestionNameToPropertyName: v, name: v ? undefined : questionName(q, schema) })} />
        {/* Create a condition: select, multi-select and checkbox questions branch to follow-up questions */}
        {prop && ['select', 'multi_select', 'checkbox'].includes(prop.type) && !q.config.condition && (
          <SettingsRow icon="ncBranch" label="조건 만들기" chevron={false} onClick={() => { close(); addConditionalGroup(view.id, collectionId, q.id); }} />
        )}
        {q.config.condition && <SettingsRow icon="ncBranch" label="조건 그룹에서 제거" chevron={false} onClick={() => updateQuestion(q.id, { condition: undefined })} />}
      </div>
      <div className="nc-menu-section with-divider">
        <SettingsRow icon="ncMove" label="질문 이동" onClick={(e) => openNestedMenu(e.currentTarget, {
          width: 220, sections: [{ items: [
            { id: 'up', label: '위로 이동', disabled: idx === 0, onSelect: () => move(idx - 1) },
            { id: 'down', label: '아래로 이동', disabled: idx === cfg.questions.length - 1, onSelect: () => move(idx + 1) },
            { id: 'top', label: '그룹 맨 위로 이동', disabled: idx === 0, onSelect: () => move(0) },
            { id: 'bottom', label: '그룹 맨 아래로 이동', disabled: idx === cfg.questions.length - 1, onSelect: () => move(cfg.questions.length) },
          ] }],
        }, { placement: 'right-start' })} />
        {/* Duplicate question: a copy of the linked property + the question's settings, right below */}
        {prop && prop.type !== 'title' && <SettingsRow icon="duplicate" label="질문 복제" chevron={false} onClick={() => {
          const pid = duplicateProperty(collectionId, q.config.propertyId);
          if (!pid) return;
          const latest = records.get<CollectionViewRecord>('collection_view', viewId);
          const cur = (latest && formConfigOf(latest.format as Record<string, unknown>)) ?? cfg;
          const copy = questionFor(pid, { ...q.config, propertyId: pid, name: q.config.shouldSyncQuestionNameToPropertyName === false ? `${questionName(q, schema)} (1)` : undefined });
          const list = [...cur.questions];
          list.splice(list.findIndex((x) => x.id === q.id) + 1, 0, copy);
          setFormat(latest ?? view, { form_config: { ...cur, questions: list } }, 'formQuestionEditSettings.duplicateQuestion');
          close();
        }} />}
        <SettingsRow icon="trash" label="질문 삭제" chevron={false} onClick={() => {
          // questions that branched off this one leave the conditional group with it
          setQuestions(cfg.questions.filter((x) => x.id !== q.id).map((x) => (x.config.condition?.questionId === q.id ? { ...x, config: { ...x.config, condition: undefined } } : x)), 'formQuestionEditSettings.deleteQuestion');
          close();
        }} />
      </div>
    </div>
  );
}


function ShareMenu({ viewId, collectionId }: { viewId: string; collectionId: string }) {
  const view = useCollectionView(viewId);
  const col = useCollection(collectionId);
  const [copied, setCopied] = useState(false);
  if (!view || !col) return null;
  const { cfg, save } = formOps(view, col.schema);
  const perm: FormPermission = cfg.permission ?? 'space';
  const accessLabel: Record<SubmissionAccess, string> = { none: '권한 없음', reader: '보기 가능', comment_only: '댓글 가능', read_and_write: '편집 가능', editor: '전체 권한' };
  const permLabel: Record<FormPermission, string> = { space: `링크가 있는 ${spaceName()} 구성원 누구나`, public: '링크가 있는 모든 사용자', closed: '접근 권한 없음' };
  const copy = () => {
    void navigator.clipboard?.writeText(formLink(viewId));
    setCopied(true);
    useUI.getState().toast('폼 링크를 복사했습니다');
  };
  return (
    <div className="nc-form-share" data-testid="form-share-menu">
      <div className="nc-form-share-title">폼 공유</div>
      <div className="nc-menu-section">
        <SettingsRow icon={perm === 'public' ? 'ncGlobe' : 'ncLock'} label="제출 가능한 사람" value={<span className="nc-form-share-val">{permLabel[perm]}{perm === 'public' && <span className="nc-form-badge">공개</span>}{perm === 'closed' && <span className="nc-form-badge gray">폐쇄형</span>}</span>} onClick={(e) => openNestedMenu(e.currentTarget, {
          width: 300, sections: [{ items: (['space', 'public', 'closed'] as FormPermission[]).map((p) => ({
            id: p, label: permLabel[p], checked: perm === p,
            description: p === 'space' ? '링크가 있는 팀 구성원은 폼을 열고 제출할 수 있습니다.' : p === 'public' ? '링크가 있으면 누구나 로그인 없이 열고 제출할 수 있습니다.' : '아무도 이 폼을 열거나 제출할 수 없습니다.',
            onSelect: () => save({ ...cfg, permission: p, anonymous: p === 'public' ? true : cfg.anonymous }, 'FormShareMenu.setPermission'),
          })) }],
        }, { placement: 'bottom-end' })} />
        <SettingsRow icon="userPlus" label="제출 권한" value={perm === 'public' || cfg.anonymous ? '접근 권한 없음' : accessLabel[cfg.submissionAccess ?? 'none']} disabled={perm === 'public' || !!cfg.anonymous} onClick={(e) => openNestedMenu(e.currentTarget, {
          width: 260, sections: [{ items: (['none', 'reader', 'comment_only', 'read_and_write', 'editor'] as SubmissionAccess[]).map((a) => ({ id: a, label: accessLabel[a], checked: (cfg.submissionAccess ?? 'none') === a, onSelect: () => save({ ...cfg, submissionAccess: a }, 'FormShareMenu.setSubmissionAccess') })) }],
        }, { placement: 'bottom-end' })} />
        <SettingsRow icon="user" label="익명 제출" chevron={false} disabled={perm === 'public'} right={<Toggle on={perm === 'public' || !!cfg.anonymous} disabled={perm === 'public'} onChange={(v) => save({ ...cfg, anonymous: v }, 'FormShareMenu.setAnonymous')} />} onClick={() => perm !== 'public' && save({ ...cfg, anonymous: !cfg.anonymous }, 'FormShareMenu.setAnonymous')} />
      </div>
      <div className="nc-form-share-link">
        <input readOnly value={formLink(viewId)} onFocus={(e) => e.currentTarget.select()} aria-label="폼 링크" />
        <div role="button" className="nc-form-btn primary small" data-testid="copy-form-link" onClick={copy}>{copied ? '복사됨' : '폼 링크 복사'}</div>
      </div>
    </div>
  );
}

function PreviewModal({ viewId, close }: { viewId: string; close: () => void }) {
  const [form, setForm] = useState<PublicForm | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<{ status: string; form?: PublicForm }>('getPublicForm', { viewId, preview: true })
      .then((r) => (r.form ? setForm(r.form) : setErr('이 폼은 마감되었거나 더 이상 사용할 수 없습니다.')))
      .catch((e) => setErr((e as Error).message));
  }, [viewId]);
  return (
    <div className="nc-form-preview" role="dialog" aria-label="폼 미리보기" data-testid="form-preview">
      <div className="nc-form-preview-actions">
        <span role="button" aria-label="폼 편집" data-tooltip="폼 편집" onClick={close}><Icon name="pencil" size={16} /></span>
        <span role="button" aria-label="폼 링크 복사" data-tooltip="폼 링크 복사" onClick={() => { void navigator.clipboard?.writeText(formLink(viewId)); useUI.getState().toast('폼 링크를 복사했습니다'); }}><Icon name="link" size={16} /></span>
        <span role="button" aria-label="폼 열기" data-tooltip="폼 열기" onClick={() => { close(); window.open(formLink(viewId), '_blank', 'noopener'); }}><Icon name="arrowDiagonalUpRight" size={16} /></span>
      </div>
      <div className="nc-form-preview-scroll lit-scroller vertical">
        {form ? <FormRenderer form={form} preview /> : <div className="nc-form-state-sub" style={{ padding: 48 }}>{err ?? ''}</div>}
      </div>
    </div>
  );
}

export function openFormPreview(viewId: string) {
  return openOverlay((close) => <PreviewModal viewId={viewId} close={close} />, { placement: 'center', backdrop: 'dim' });
}

function AutoCreateDialog({ count, onAll, onScratch }: { count: number; onAll: () => void; onScratch: () => void }) {
  return (
    <div className="nc-form-autocreate" role="dialog" aria-label="폼 질문 자동 생성" data-testid="form-autocreate">
      <div className="nc-form-autocreate-art"><Icon name="viewTable" size={36} color="var(--lp-icon-secondary)" /><Icon name="arrowRight" size={22} color="var(--lp-icon-secondary)" /><Icon name="inlineBlockDouble" size={36} color="var(--lp-icon-secondary)" /></div>
      <div className="nc-form-autocreate-title">기존 속성으로 폼 질문을 만들까요?</div>
      <div className="nc-form-autocreate-sub">지원되는 속성 유형만 질문으로 만들어집니다.</div>
      <div role="button" className="nc-form-btn primary wide" onClick={onAll}>{count === 1 ? '질문 1개 만들기' : `질문 ${count}개 만들기`}</div>
      <div role="button" className="nc-form-autocreate-scratch" onClick={onScratch}>빈 폼으로 시작</div>
    </div>
  );
}

function FormView(props: ViewProps) {
  const kit = useViewKit(props);
  const { view, collection, readOnly } = kit;
  const schema = collection.schema;
  const { cfg, save, setQuestions, updateQuestion } = formOps(view, schema);
  const [selected, setSelected] = useState<string | null>(null);
  const [hoverHead, setHoverHead] = useState(false);
  const asked = useRef(false);
  const bleed = kit.db?.bleed ?? { left: 0, right: 0 };

  useEffect(() => {
    if (readOnly || cfg.initialized || asked.current) return;
    asked.current = true;
    const ids = supportedPropertyIds(schema);
    const owner = useSession.getState().userId ?? undefined;
    let chosen = false;
    // opened after the core's "New view" panel (it opens 50ms after creation) so the question dialog is on top
    const timer = setTimeout(() => openOverlay((close) => (
      <AutoCreateDialog
        count={ids.length}
        onAll={() => { chosen = true; save({ ...defaultFormConfig(schema, { all: true, ownerId: owner }), title: cfg.title, description: cfg.description }, 'formEditorActions.createQuestions'); close(); }}
        onScratch={() => { chosen = true; save({ ...defaultFormConfig(schema, { all: false, ownerId: owner }), title: cfg.title, description: cfg.description }, 'formEditorActions.startFromScratch'); close(); }}
      />
    ), { placement: 'center', backdrop: 'dim', onClose: () => { if (!chosen) save({ ...cfg, initialized: true, ownerId: cfg.ownerId ?? owner }, 'formEditorActions.dismiss'); } }), 160);
    return () => clearTimeout(timer);
  }, [cfg.initialized]); // eslint-disable-line react-hooks/exhaustive-deps

  const renameQuestion = (q: FormQuestion, name: string) => {
    if (!name) return;
    if (q.config.shouldSyncQuestionNameToPropertyName !== false && schema[q.config.propertyId]) {
      run('formQuestionTitle.renameProperty', (tx) => tx.update('collection', collection.id, ['schema', q.config.propertyId], { name }));
    } else updateQuestion(q.id, { name });
  };

  const addQuestion = (e: React.MouseEvent<HTMLElement>) => openAddQuestionMenu(e.currentTarget, view.id, collection.id, setSelected);

  const perm: FormPermission = cfg.permission ?? 'space';
  const banner = perm === 'public' ? '이 폼은 공개되어 있습니다. 링크가 있으면 누구나 응답을 제출할 수 있습니다.'
    : perm === 'closed' ? '이 폼은 마감되었습니다. 새 응답을 받을 수 없습니다.' : `${spaceName()} 멤버만 이 양식을 제출할 수 있습니다.`;

  return (
    <div className="nc-form-b lit-form-view" style={{ paddingInlineStart: bleed.left, paddingInlineEnd: bleed.right }} onPointerDown={(e) => { if (!(e.target as HTMLElement).closest('.nc-form-b-q, .nc-overlay')) setSelected(null); }}>
      {cfg.cover && (
        <div className="nc-form-b-cover" style={{ background: cfg.cover }}>
          {!readOnly && <div role="button" className="nc-form-b-cover-btn" onClick={() => save({ ...cfg, cover: undefined }, 'formEditor.removeCover')}>커버 제거</div>}
        </div>
      )}
      <div className="nc-form-b-col">
        <div className="nc-form-b-head" onPointerEnter={() => setHoverHead(true)} onPointerLeave={() => setHoverHead(false)}>
          {cfg.icon && <div role="button" className="nc-form-b-icon" onClick={(e) => !readOnly && openIconPicker(e.currentTarget, { current: cfg.icon, onPick: (v) => save({ ...cfg, icon: v ?? undefined }, 'formEditor.setIcon') })}>{cfg.icon}</div>}
          {!readOnly && (
            <div className="nc-form-b-controls" style={{ opacity: hoverHead || (!cfg.icon && !cfg.cover && !cfg.title) ? 1 : 0 }}>
              {!cfg.icon && <div role="button" className="nc-form-b-ctl" onClick={(e) => openIconPicker(e.currentTarget, { onPick: (v) => save({ ...cfg, icon: v ?? undefined }, 'formEditor.setIcon') })}><Icon name="ncFormIcon" size={14} />폼 아이콘</div>}
              {!cfg.cover && <div role="button" className="nc-form-b-ctl" onClick={() => save({ ...cfg, cover: COVERS[Math.floor(Math.random() * COVERS.length)] }, 'formEditor.setCover')}><Icon name="ncFormCover" size={14} />폼 커버</div>}
            </div>
          )}
          <PlainEditable testId="form-title" value={cfg.title ?? ''} placeholder="폼 제목" className="nc-form-b-title" readOnly={readOnly} onCommit={(t) => save({ ...cfg, title: t || undefined }, 'formTitle.update')} />
          <PlainEditable value={cfg.description ?? ''} placeholder="설명(선택)" className="nc-form-b-desc" readOnly={readOnly} onCommit={(t) => save({ ...cfg, description: t || undefined }, 'formTitle.updateDescription')} />
        </div>
        <div className="nc-form-b-banner" data-testid="form-access-banner">
          <span className="nc-form-b-banner-text"><Icon name={perm === 'public' ? 'ncGlobe' : 'ncLock'} size={16} />{banner}</span>
          {!readOnly && <div role="button" className="nc-form-b-banner-btn" onClick={(e) => openShareMenu(e.currentTarget, view.id, collection.id)}>변경</div>}
        </div>
        {cfg.questions.map((q, qi) => {
          const prop = schema[q.config.propertyId];
          const isSel = selected === q.id;
          const cond = q.config.condition;
          const trigger = cond ? cfg.questions.find((x) => x.id === cond.questionId) : undefined;
          const tprop = trigger ? schema[trigger.config.propertyId] : undefined;
          const prev = cfg.questions[qi - 1];
          // a conditional group starts where the condition differs from the previous question's
          const startsGroup = !!cond && JSON.stringify(prev?.config.condition ?? null) !== JSON.stringify(cond);
          const sameGroup = (x: FormQuestion) => JSON.stringify(x.config.condition ?? null) === JSON.stringify(cond ?? null);
          const header = startsGroup && trigger && tprop ? (
            <ConditionHeader
              key={`cond-${q.id}`}
              q={q}
              trigger={trigger}
              prop={tprop}
              readOnly={readOnly}
              onChange={(c) => setQuestions(cfg.questions.map((x) => (sameGroup(x) ? { ...x, config: { ...x.config, condition: c } } : x)), 'FormConditionalLogic.updateCondition')}
              onDelete={() => setQuestions(cfg.questions.map((x) => (sameGroup(x) ? { ...x, config: { ...x.config, condition: undefined } } : x)), 'FormConditionalLogic.deleteCondition')}
              onAddMore={(e) => {
                const others = cfg.questions.filter((x) => x.id !== cond!.questionId && !x.config.condition && x.id !== q.id && supportsQuestion(schema[x.config.propertyId]));
                openMenu(e.currentTarget, { width: 260, header: <div className="nc-form-add-head">질문 만들기 또는 선택</div>, sections: [{ items: others.map((x) => ({ id: x.id, label: questionName(x, schema), icon: <PropertyIcon prop={schema[x.config.propertyId]} size={16} />, onSelect: () => {
                  // moved right after the group's last question
                  const rest = cfg.questions.filter((y) => y.id !== x.id);
                  let last = -1;
                  rest.forEach((y, i) => { if (sameGroup(y)) last = i; });
                  rest.splice(last + 1, 0, { ...x, config: { ...x.config, condition: cond } });
                  setQuestions(rest, 'FormConditionalLogic.addQuestion');
                } })) }] }, { placement: 'bottom-end' });
              }}
            />
          ) : null;
          return (
            <div key={q.id} className={cond ? 'nc-form-cond-group' : undefined} data-cond-of={cond?.questionId}>
            {header}
            <div className={`nc-form-b-q layout-content ${isSel ? 'selected' : ''}`} data-question-id={q.id} onPointerDown={() => setSelected(q.id)}>
              {!prop ? (
                <div className="nc-form-b-missing">연결된 필드를 찾을 수 없습니다.</div>
              ) : (
                <>
                  <div className="form-question-title">
                    <PlainEditable value={questionName(q, schema)} placeholder="질문 이름" className="nc-form-b-qtitle" readOnly={readOnly} onCommit={(t) => renameQuestion(q, t)} />
                    {q.config.isRequired && <span className="nc-form-req">*</span>}
                  </div>
                  {q.config.hasDescription && <PlainEditable value={q.config.description ?? ''} placeholder="설명 추가" className="nc-form-b-qdesc" readOnly={readOnly} onCommit={(t) => updateQuestion(q.id, { description: t })} />}
                  <AnswerPreview q={q} prop={prop} readOnly={readOnly} collectionId={collection.id} onCheckboxLabel={(v) => updateQuestion(q.id, { checkboxLabel: v || undefined })} />
                </>
              )}
              {!readOnly && (
                <div role="button" className="nc-form-b-qmore" aria-label="질문 편집" data-tooltip="질문 편집" onClick={(e) => {
                  e.stopPropagation();
                  setSelected(q.id);
                  openOverlay((close) => <PopoverSurface width={300}><QuestionOptions viewId={view.id} collectionId={collection.id} questionId={q.id} close={close} /></PopoverSurface>, { anchor: e.currentTarget, placement: 'left-start', backdrop: 'transparent' });
                }}><Icon name="ellipsis" size={16} /></div>
              )}
            </div>
            </div>
          );
        })}
        {!readOnly && (
          <div className="nc-form-b-add-wrap">
            <div role="button" className="nc-form-b-add" aria-label="질문 추가" data-tooltip="질문 추가" onClick={addQuestion}><Icon name="plus" size={18} /></div>
          </div>
        )}
      </div>
    </div>
  );
}

/** "+" Add question / Form settings › New question: a new property of a question type, or an existing property. */
function openAddQuestionMenu(anchor: HTMLElement, viewId: string, collectionId: string, onAdded?: (questionId: string) => void, placement: 'bottom' | 'right-start' = 'bottom') {
  const view = records.get<CollectionViewRecord>('collection_view', viewId);
  const collection = records.get<CollectionRecord>('collection', collectionId);
  if (!view || !collection) return;
  const schema = collection.schema;
  const latestCfg = () => {
    const v = records.get<CollectionViewRecord>('collection_view', viewId) ?? view;
    return { v, cfg: formConfigOf(v.format as Record<string, unknown>) ?? defaultFormConfig(schema) };
  };
  const append = (q: FormQuestion, action: string) => {
    const { v, cfg } = latestCfg();
    setFormat(v, { form_config: { ...cfg, questions: [...cfg.questions, q] } }, action);
    onAdded?.(q.id);
  };
  const linked = new Set(latestCfg().cfg.questions.map((q) => q.config.propertyId));
  const existing = Object.entries(schema).filter(([id, p]) => !linked.has(id) && supportsQuestion(p));
  const items: MenuItemDef[] = NEW_QUESTION_TYPES.map((t) => ({
    id: `new-${t}`, label: QUESTION_TYPE_LABEL[t] ?? t, icon: <PropertyIcon prop={{ type: t }} size={16} />,
    onSelect: () => {
      const n = latestCfg().cfg.questions.length + 1;
      const pid = addProperty(collectionId, t, { name: `Question ${n}`, action: 'formQuestionCreateSettings.newQuestion' });
      if (pid) append(questionFor(pid), 'formQuestionCreateSettings.newQuestion');
    },
  }));
  const sections = [{ title: '새 질문', items }];
  if (existing.length) {
    sections.push({
      title: '기존 속성',
      items: existing.map(([id, p]) => ({ id, label: p.name, icon: <PropertyIcon prop={p} size={16} />, onSelect: () => append(questionFor(id), 'formQuestionCreateSettings.existingProperty') })),
    });
  }
  openMenu(anchor, { width: 260, search: '질문 유형 검색…', header: <div className="nc-form-add-head">유형 선택</div>, sections }, { placement });
}

function openShareMenu(anchor: HTMLElement, viewId: string, collectionId: string) {
  return openOverlay(() => <PopoverSurface width={360}><ShareMenu viewId={viewId} collectionId={collectionId} /></PopoverSurface>, { anchor, placement: 'bottom-end', backdrop: 'transparent' });
}

function FormToolbar({ view, collection, readOnly }: ToolbarExtraProps) {
  return (
    <div className="nc-form-toolbar">
      <div role="button" className="nc-form-tb-preview" data-testid="form-preview-button" onClick={() => openFormPreview(view.id)}><Icon name="ncEye" size={16} />미리보기</div>
      {!readOnly && <div role="button" className="nc-form-tb-share" data-testid="form-share-button" onClick={(e) => openShareMenu(e.currentTarget, view.id, collection.id)}>폼 공유</div>}
    </div>
  );
}

const SUBMIT_COLOR_NAMES = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const;

/** Form settings › Submit. */
function SubmitScreenSettings({ cfg, save, readOnly, onBack }: { cfg: FormConfig; save: (next: FormConfig, action?: string) => void; readOnly: boolean; onBack: () => void }) {
  const ss: FormSubmitScreen = cfg.submitScreen ?? {};
  const set = (patch: Partial<FormSubmitScreen>, action = 'formCustomizeSettings.update') => save({ ...cfg, submitScreen: { ...ss, ...patch } }, action);
  const color = ss.submitButtonColor ?? 'blue';
  return (
    <div className="nc-form-settings" data-testid="form-submit-screen">
      <div role="menuitem" className="nc-menu-item nc-vs-row" onClick={onBack}><div className="nc-menu-item-inner"><div className="nc-menu-icon"><Icon name="arrowStraightLeftSmall" size={16} /></div><div className="nc-menu-label">제출 완료 화면</div></div></div>
      <div className="nc-menu-section">
        <div className="nc-menu-section-title">제출 버튼</div>
        <SettingsRow icon="paintRoller" label="색상" value={<span className="nc-form-color-val"><ColorSwatch color={color === 'blue' ? 'blue' : color} />{COLOR_LABELS[color as keyof typeof COLOR_LABELS] ?? color}</span>} disabled={readOnly} onClick={(e) => openNestedMenu(e.currentTarget, {
          width: 200, sections: [{ items: SUBMIT_COLOR_NAMES.map((c) => ({ id: c, label: COLOR_LABELS[c] ?? c, icon: <ColorSwatch color={c === 'default' ? 'blue' : c} />, checked: color === (c === 'default' ? 'blue' : c), onSelect: () => set({ submitButtonColor: c === 'default' ? undefined : c }) })) }],
        }, { placement: 'right-start' })} />
        <div className="nc-form-settings-field" data-menu-keys="ignore">
          <label>텍스트</label>
          <input disabled={readOnly} placeholder="제출" defaultValue={ss.submitButtonText ?? ''} onBlur={(e) => set({ submitButtonText: e.target.value.trim() || undefined })} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        </div>
      </div>
      <div className="nc-menu-section with-divider">
        <div className="nc-form-settings-field" data-menu-keys="ignore">
          <label>확인 화면 제목</label>
          <input disabled={readOnly} placeholder="감사합니다!" defaultValue={ss.confirmationTitle ?? ''} onBlur={(e) => set({ confirmationTitle: e.target.value.trim() || undefined })} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        </div>
        <div className="nc-form-settings-field" data-menu-keys="ignore">
          <label>확인 메시지 본문</label>
          <textarea disabled={readOnly} rows={3} placeholder="응답이 제출되었습니다." defaultValue={ss.confirmationBody ?? ''} onBlur={(e) => set({ confirmationBody: e.target.value.trim() || undefined })} />
        </div>
      </div>
      <div className="nc-menu-section with-divider">
        <div className="nc-menu-section-title">버튼 더 보기</div>
        <ToggleRowSmall icon="plus" label="다른 응답 제출" on={ss.allowSubmitAnotherResponse !== false} disabled={readOnly} onChange={(v) => set({ allowSubmitAnotherResponse: v })} />
        <ToggleRowSmall icon="ncEye" label="내 제출 내용 열기" on={!!ss.allowViewResponse} disabled={readOnly} onChange={(v) => set({ allowViewResponse: v })} />
        <ToggleRowSmall icon="mail" label="내 이메일로 사본 받기" on={!!ss.allowEmailResponse} disabled={readOnly} onChange={(v) => set({ allowEmailResponse: v })} />
      </div>
    </div>
  );
}

/** View settings of a form view ("Form settings"): New question, Submit, Select template (applied to new submissions), Share form, Automations, Delete form, Explore forms. */
function FormSettingsMain({ block, view, collection, readOnly, close }: ViewSettingsMainProps) {
  const [page, setPage] = useState<'main' | 'submit'>('main');
  const live = useCollectionView(view.id) ?? view;
  const { cfg, save } = formOps(live, collection.schema);
  if (page === 'submit') return <SubmitScreenSettings cfg={cfg} save={save} readOnly={readOnly} onBack={() => setPage('main')} />;
  const templates = collectionTemplates(collection);
  const template = templates.find((t) => t.id === cfg.templateId);
  const perm: FormPermission = cfg.permission ?? 'space';
  const permLabel: Record<FormPermission, string> = { space: `링크가 있는 ${spaceName()} 구성원 누구나`, public: '링크가 있는 모든 사용자', closed: '접근 권한 없음' };
  return (
    <div className="nc-form-settings" data-testid="form-settings">
      <div className="nc-menu-section">
        {!readOnly && <SettingsRow icon="plus" label="새 질문" onClick={(e) => openAddQuestionMenu(e.currentTarget, view.id, collection.id, undefined, 'right-start')} />}
        <SettingsRow icon="checkmarkSquare" label="제출 완료 화면" onClick={() => setPage('submit')} />
        <SettingsRow icon="template" label="템플릿 선택" value={template ? toTitle(template) : '없음'} disabled={readOnly} onClick={(e) => openNestedMenu(e.currentTarget, {
          width: 260, header: <div className="nc-form-add-head">제출용 템플릿 선택</div>, sections: [{ items: [
            { id: 'none', label: '없음', checked: !template, onSelect: () => save({ ...cfg, templateId: undefined }, 'formSelectTemplateSettings.select') },
            ...templates.map((t) => ({ id: t.id, label: toTitle(t), icon: 'page', checked: t.id === cfg.templateId, onSelect: () => save({ ...cfg, templateId: t.id }, 'formSelectTemplateSettings.select') })),
          ] }],
        }, { placement: 'right-start' })} />
        <SettingsRow icon={perm === 'public' ? 'ncGlobe' : 'ncLock'} label="제출 가능한 사람" value={permLabel[perm]} disabled={readOnly} onClick={(e) => openShareMenu(e.currentTarget, view.id, collection.id)} />
        <SettingsRow icon="dbLightning" label="자동화" disabled={readOnly} onClick={(e) => { const a = e.currentTarget; close(); void import('../../automations/list.tsx').then((m) => m.openAutomations(collection, a)); }} />
      </div>
      <div className="nc-menu-section with-divider">
        {!readOnly && <SettingsRow icon="trash" label="폼 삭제" chevron={false} onClick={async () => {
          const ok = await confirmDialog({ message: `${view.name || 'Form'}을(를) 영구 삭제할까요?`, description: '더 이상 이 폼을 제출할 수 없게 됩니다. 이미 받은 응답은 그대로 유지됩니다.', confirmLabel: '폼 삭제' });
          if (!ok) return;
          close();
          deleteView(records.get<BlockRecord>('block', block.id) ?? block, view.id);
        }} />}
        {HELP_URL && <SettingsRow icon="questionMarkCircle" label="폼 알아보기" chevron={false} onClick={() => window.open(HELP_URL!, '_blank', 'noopener')} />}
      </div>
    </div>
  );
}

function toTitle(b: BlockRecord): string {
  return (b.properties?.title ?? []).map((d) => String(d[0])).join('') || '제목 없음';
}

registerView('form', FormView);
registerToolbarExtra('form', FormToolbar);
registerViewSettingsMain('form', FormSettingsMain);

/** New form views: "Form builder" with the title question; the auto-create dialog offers every supported property. */
viewCreationHooks.form = (tx, viewId, collection) => {
  const owner = useSession.getState().userId ?? undefined;
  tx.update('collection_view', viewId, [], { name: 'Form builder' });
  tx.update('collection_view', viewId, ['format'], { form_config: { ...defaultFormConfig(collection.schema), ownerId: owner, initialized: false } as FormConfig });
};

