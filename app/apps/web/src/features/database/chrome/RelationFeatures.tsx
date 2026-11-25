// View settings › More settings › Sub-items / Dependencies / Sprints pages and "Change to Tasks table"
// Labels use the database view settings and collection settings translations.
// Labels describe sub-item display and filter scope, plus sprint settings.
import { useState, type ReactNode } from 'react';
import type { BlockRecord, CollectionRecord, CollectionViewRecord, PropertySchema } from '@nc/shared/records.ts';
import {
  DATE_SHIFT_MODES, dependencyConfigOf, isSprintsDatabase, nestsSubitems, sprintSettingsOf, subitemConfigOf, subitemSettingsOf,
  type DateShiftMode, type SubitemDisplayMode, type SubitemFilterScope,
} from '@nc/shared/database/index.ts';
import { Icon } from '../../../components/Icon.tsx';
import type { MenuItemDef } from '../../../components/Menu.tsx';
import { openOverlay } from '../../../components/overlay.tsx';
import { useCollection, useCollectionView } from '../../../lib/hooks.ts';
import { confirmDialog } from '../../page/confirm.tsx';
import { PropertyIcon } from '../properties/PropertyCell.tsx';
import { updateViewFormat } from '../actions.ts';
import { itemNoun, setSubitemDisplayMode, setSubitemFilterScope, turnOffSubitems, turnOnSubitems } from '../subitems.ts';
import { turnOffDependencies, turnOnDependencies, updateDependencySettings, firstDateProperty } from '../dependencies.ts';
import { isTaskDatabase, undoTaskDatabase } from '../taskdb.ts';
import { openTurnIntoTasksDialog } from './TurnIntoTasks.tsx';
import { isSkillsDatabase, openTurnIntoSkillsDialog, undoSkillsDatabase } from '../../ai/SkillsDatabase.tsx';
import { SprintSettingsBody } from '../sprints/SprintSettings.tsx';
import { useCollectionAccess } from '../access.ts';
import { openLayoutBuilder } from '../layout/openLayoutBuilder.ts';
import { connectionsMenuItem } from '../../developer/PageConnections.tsx';
import { VSHeader as Header, VSRow as Row, VSSection as Section, VSToggleRow as ToggleRow, vsPick as pick, type VSCtx, type VSPage } from './ViewSettings.tsx';
import '../featureIcons.tsx';
import './relationFeatures.css';

interface PageProps {
  ctx: VSCtx;
  view: CollectionViewRecord;
  collection: CollectionRecord;
  go: (p: VSPage) => void;
  close: () => void;
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** View settings › “More settings” submenu: Dependencies, Connections, and Adjust entry layout. */
export function moreSettingsItems(opts: { collection: CollectionRecord; view: CollectionViewRecord; block: BlockRecord; go: (p: string) => void; close: () => void }): MenuItemDef[] {
  const noun = itemNoun(opts.collection);
  return [
    { id: 'subitems', label: `Sub-${noun.items}`, icon: 'listToggleIndent', right: <Icon name="arrowChevronSingleRightSmall" size={16} style={{ color: 'var(--lp-icon-tertiary)' }} />, onSelect: () => opts.go('subitems') },
    { id: 'deps', label: '종속 관계', icon: 'arrowTurnDownRight', right: <Icon name="arrowChevronSingleRightSmall" size={16} style={{ color: 'var(--lp-icon-tertiary)' }} />, onSelect: () => opts.go('dependencies') },
    ...(isTaskDatabase(opts.collection) ? [{ id: 'sprints', label: '스프린트', icon: 'sprint', right: <Icon name="arrowChevronSingleRightSmall" size={16} style={{ color: 'var(--lp-icon-tertiary)' }} />, onSelect: () => opts.go('sprints') }] : []),
    // API connections of this database (features/developer: list / add / remove, page ••• › Connections)
    connectionsMenuItem(opts.block.id, (label, icon, extra) => ({ id: 'conn', label, icon, ...extra })),
    { id: 'layout', label: '항목 레이아웃 조정', icon: 'layout', onSelect: () => { opts.close(); openLayoutBuilder(opts.collection.id); } },
  ];
}

/** View settings › "Turn into" submenu. */
export function turnIntoItems(collection: CollectionRecord, close: () => void): MenuItemDef[] {
  // Skills database
  if (isSkillsDatabase(collection)) {
    return [{ id: 'undo-skills', label: '스킬 테이블 되돌리기', icon: 'paperBolt', onSelect: async () => {
      const ok = await confirmDialog({ message: '스킬 테이블을 되돌릴까요?', confirmLabel: '실행 취소' });
      if (ok) undoSkillsDatabase(collection);
    } }];
  }
  if (isTaskDatabase(collection)) {
    return [{ id: 'undo', label: '작업 표 되돌리기', icon: 'checkmarkSquare', onSelect: async () => {
      const ok = await confirmDialog({ message: '작업 표를 해제할까요?', confirmLabel: '제거' });
      if (ok) undoTaskDatabase(collection);
    } }];
  }
  return [
    { id: 'tasks', label: '작업 테이블로 전환', icon: 'checkmarkSquare', disabled: isSprintsDatabase(collection), onSelect: () => { close(); openTurnIntoTasksDialog(collection.id); } },
    { id: 'skills', label: '스킬 테이블로 전환', icon: 'paperBolt', onSelect: () => { close(); openTurnIntoSkillsDialog(collection.id); } },
  ];
}

/** Modal of "Turn off sub-items" / "Disable dependencies": Keep properties | Remove properties. */
function openTurnOffModal(opts: { title: string; property: string; inverse?: string; onPick: (remove: boolean) => void }) {
  openOverlay((close) => (
    <div className="nc-confirm nc-rf-turnoff" role="alertdialog" style={{ width: 340 }}>
      <div className="nc-confirm-message">{opts.title}</div>
      <div className="nc-rf-turnoff-choices">
        <div role="button" className="nc-rf-turnoff-choice" onClick={() => { close(); opts.onPick(false); }}>
          <div className="nc-rf-turnoff-title">속성 유지</div>
        </div>
        <div role="button" className="nc-rf-turnoff-choice danger" onClick={() => { close(); opts.onPick(true); }}>
          <div className="nc-rf-turnoff-title">속성 제거</div>
          <div className="nc-rf-turnoff-desc">{opts.inverse ? `${opts.property}, ${opts.inverse} 속성을 삭제합니다.` : `${opts.property} 속성을 삭제합니다.`}</div>
        </div>
      </div>
      <div className="nc-confirm-buttons"><button className="nc-dialog-btn outline" onClick={close}>취소</button></div>
    </div>
  ), { placement: 'center', backdrop: 'dim' });
}

function selfRelations(c: CollectionRecord): [string, PropertySchema][] {
  return Object.entries(c.schema).filter(([, p]) => p.type === 'relation' && ((p.collection_pointer as { id?: string } | undefined)?.id ?? p.collection_id) === c.id);
}

/** Shared "Property" chooser of the turn-on state: create a new relation (optional name) or use an existing one. */
function RelationChooser({ c, caption, placeholder, value, onChange }: { c: CollectionRecord; caption: string; placeholder: string; value: { mode: 'new' | 'existing'; name: string; relation?: string }; onChange: (v: { mode: 'new' | 'existing'; name: string; relation?: string }) => void }) {
  const rels = selfRelations(c);
  return (
    <Section title="속성" className="nc-vs-sec titled">
      <Row label="새 연결 만들기" chevron={false} right={<Icon name={value.mode === 'new' ? 'radioOn' : 'radioOff'} size={16} />} onClick={() => onChange({ ...value, mode: 'new' })} />
      {value.mode === 'new' && (
        <div className="nc-rf-input" data-menu-keys="ignore">
          <div className="nc-rf-input-label">Rename (optional)</div>
          <div className="nc-input"><input placeholder={placeholder} value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} /></div>
        </div>
      )}
      <Row label="기존 링크 사용" chevron={false} disabled={!rels.length} right={<Icon name={value.mode === 'existing' ? 'radioOn' : 'radioOff'} size={16} />} onClick={() => onChange({ ...value, mode: 'existing', relation: value.relation ?? rels[0]?.[0] })} />
      {value.mode === 'existing' && rels.length > 0 && (
        <Row icon={<PropertyIcon prop={c.schema[value.relation ?? rels[0][0]]} size={16} />} label="속성" value={c.schema[value.relation ?? rels[0][0]]?.name} onClick={(e) => pick(e.currentTarget, rels.map(([id, p]) => ({ id, label: p.name, icon: <PropertyIcon prop={p} size={16} />, checked: id === value.relation, onSelect: () => onChange({ ...value, relation: id }) })))} />
      )}
      <div className="nc-rf-caption">{caption}</div>
    </Section>
  );
}

// ------------------------------------------------------------------ Sub-items

const DISPLAY_LABEL: Record<SubitemDisplayMode, string> = { show: '토글 안에 중첩', flattened: '평면 목록', disabled: '비활성화' };
const SCOPE_LABEL: Record<SubitemFilterScope, string> = { parents: '상위 항목만', parents_and_subitems: '상위 항목과 하위 항목', subitems: '하위 항목만' };

function subitemsPreview(mode: SubitemDisplayMode, scope: SubitemFilterScope, nested: boolean): string {
  if (mode === 'disabled') return 'Every item is treated as top-level.';
  if (mode === 'flattened') {
    return scope === 'parents' ? '조건에 맞는 상위 항목이 하위 항목 수와 함께 표시됩니다.'
      : scope === 'subitems' ? '조건에 맞는 하위 항목만 표시됩니다.' : '조건에 맞는 상위 항목과 하위 항목이 함께 표시됩니다.';
  }
  if (!nested) return '조건에 맞는 상위 항목이 표시되며, 하위 항목은 각 카드 안에 포함됩니다.';
  return scope === 'parents' ? '필터에 맞는 상위 항목이 하위 항목을 포함해 표시됩니다.'
    : scope === 'subitems' ? '조건에 맞는 하위 항목이 있는 상위 항목만 표시됩니다.' : '조건에 맞는 상위 항목과 하위 항목이 모두 표시됩니다.';
}

export function SubitemsPage({ ctx, view: v0, collection: c0, go, close }: PageProps) {
  const c = useCollection(c0.id) ?? c0;
  const view = useCollectionView(v0.id) ?? v0;
  const noun = itemNoun(c);
  const cfg = subitemConfigOf(c);
  const ro = ctx.readOnly || !useCollectionAccess(c.id).canEditStructure;
  const [choice, setChoice] = useState<{ mode: 'new' | 'existing'; name: string; relation?: string }>({ mode: 'new', name: '' });
  const title = `Sub-${noun.items}`;
  if (!cfg) {
    return (
      <>
        <Header title={title} onBack={() => go('main')} close={close} />
        <div className="nc-rf-desc">{`Group ${noun.items} under toggles`}</div>
        <RelationChooser c={c} value={choice} onChange={setChoice} placeholder={isTaskDatabase(c) ? 'Sub-tasks…' : 'Sub-items…'} caption={`하위 ${noun.items}에 사용할 연결 필드를 선택하세요. 기본값은 “하위 ${noun.item}”입니다.`} />
        <div className="nc-rf-cta"><div role="button" data-testid="turn-on-subitems" className={`nc-btn primary nc-rf-cta-btn ${ro ? 'disabled' : ''}`} onClick={() => !ro && turnOnSubitems(c, choice.mode === 'existing' ? { relation: choice.relation } : { name: choice.name })}>{`하위 ${noun.items} 켜기`}</div></div>
      </>
    );
  }
  const f = (view.format ?? {}) as Record<string, any>;
  const nested = nestsSubitems(view.type);
  const settings = subitemSettingsOf(view, c);
  const mode: SubitemDisplayMode = (f.subitem_display_mode as SubitemDisplayMode | undefined) ?? (view.type === 'chart' ? 'flattened' : 'show');
  const scope: SubitemFilterScope = settings?.scope ?? 'parents';
  const showLabel = nested ? '토글 안에 중첩' : '카드 속성';
  const scopes: SubitemFilterScope[] = mode === 'show' && !nested ? ['parents'] : ['parents', 'parents_and_subitems', 'subitems'];
  return (
    <>
      <Header title={title} onBack={() => go('main')} close={close} />
      <Section className="nc-vs-sec first">
        <Row label="표시 옵션" testid="subitem-display" value={mode === 'show' ? showLabel : DISPLAY_LABEL[mode]} disabled={ro} onClick={(e) => pick(e.currentTarget, (['show', 'flattened', 'disabled'] as SubitemDisplayMode[]).map((m) => ({ id: m, label: m === 'show' ? showLabel : DISPLAY_LABEL[m], checked: mode === m, onSelect: () => setSubitemDisplayMode(view, m) })))} />
        {mode !== 'disabled' && (
          <Row label={mode === 'flattened' ? '포함' : '필터 옵션'} testid="subitem-scope" value={SCOPE_LABEL[scope]} disabled={ro || scopes.length === 1} onClick={(e) => pick(e.currentTarget, scopes.map((s) => ({ id: s, label: SCOPE_LABEL[s], checked: scope === s, onSelect: () => setSubitemFilterScope(view, s) })))} />
        )}
        <div className="nc-rf-caption">{subitemsPreview(mode, scope, nested)}</div>
      </Section>
      <Section divider title="고급 설정" className="nc-vs-sec titled">
        <Row label="속성" value={c.schema[cfg.property]?.name} disabled={ro} onClick={(e) => pick(e.currentTarget, selfRelations(c).map(([id, p]) => ({ id, label: p.name, icon: <PropertyIcon prop={p} size={16} />, checked: id === cfg.property, onSelect: () => turnOnSubitems(c, { relation: id }) })))} />
        {view.type === 'table' && (
          <div data-tooltip="중첩 항목과 토글을 제목 열에 둘지 첫 번째 열에 둘지 선택합니다. 표에만 적용됩니다.">
            <ToggleRow label="중첩 토글을 제목 열에 표시" on={f.table_subitem_toggle_on_title !== false} disabled={ro} onChange={(on) => updateViewFormat(view.id, { table_subitem_toggle_on_title: on ? undefined : false }, 'subitems.toggleOnTitle')} />
          </div>
        )}
      </Section>
      <Section divider className="nc-vs-sec last">
        <Row icon="trash" label={`하위 ${noun.items} 사용 안 함`} chevron={false} disabled={ro} testid="turn-off-subitems" onClick={() => openTurnOffModal({
          title: `Remove linked fields when disabling sub-${noun.items}?`,
          property: c.schema[cfg.property]?.name ?? 'Sub-item', inverse: c.schema[cfg.inverse]?.name,
          onPick: (remove) => turnOffSubitems(c, remove),
        })} />
      </Section>
    </>
  );
}

// ------------------------------------------------------------------ Dependencies

function ShiftOptions({ mode, avoidWeekends, disabled, onMode, onAvoid, noun }: { mode: DateShiftMode | 'none'; avoidWeekends: boolean; disabled: boolean; onMode: (m: DateShiftMode | 'none') => void; onAvoid: (v: boolean) => void; noun: string }) {
  return (
    <Section divider title="날짜 자동 조정" className="nc-vs-sec titled">
      {DATE_SHIFT_MODES.map((m) => (
        <Row key={m.id} testid={`shift-${m.id}`} label={m.id === 'preserve_gap' ? `간격을 유지하며 ${noun} 이동` : m.label} chevron={false} disabled={disabled} right={<Icon name={mode === m.id ? 'radioOn' : 'radioOff'} size={16} />} onClick={() => onMode(m.id)} />
      ))}
      <ToggleRow label="주말 제외" on={avoidWeekends} disabled={disabled || mode === 'none'} onChange={onAvoid} />
      <div className="nc-rf-caption">{`이동한 ${noun}을(를) 주말에 두지 않기`}</div>
    </Section>
  );
}

function ShiftUsing({ c, date, end, disabled, onChange }: { c: CollectionRecord; date?: string; end?: string; disabled: boolean; onChange: (date: string, end?: string | null) => void }) {
  const dates = Object.entries(c.schema).filter(([, p]) => p.type === 'date');
  const items = (cur: string | undefined, set: (id: string) => void) => dates.map(([id, p]) => ({ id, label: p.name, icon: <PropertyIcon prop={p} size={16} />, checked: id === cur, onSelect: () => set(id) }));
  return (
    <Section divider title="이동 기준" className="nc-vs-sec titled">
      {end ? (
        <>
          <Row label="시작 날짜" value={date ? c.schema[date]?.name : 'None'} disabled={disabled || !dates.length} onClick={(e) => pick(e.currentTarget, items(date, (id) => onChange(id, end)))} />
          <Row label="종료일" value={c.schema[end]?.name} disabled={disabled} onClick={(e) => pick(e.currentTarget, items(end, (id) => onChange(date ?? id, id)))} />
        </>
      ) : (
        <Row label="날짜 속성" value={date ? c.schema[date]?.name : 'None'} disabled={disabled || !dates.length} onClick={(e) => pick(e.currentTarget, items(date, (id) => onChange(id)))} />
      )}
      <ToggleRow label="시작일과 종료일을 따로 사용" on={!!end} disabled={disabled || dates.length < 2} onChange={(on) => onChange(date ?? dates[0]?.[0] ?? '', on ? dates.find(([id]) => id !== date)?.[0] : null)} />
    </Section>
  );
}

export function DependenciesPage({ ctx, view: v0, collection: c0, go, close }: PageProps) {
  const c = useCollection(c0.id) ?? c0;
  const view = useCollectionView(v0.id) ?? v0;
  const noun = itemNoun(c);
  const cfg = dependencyConfigOf(c);
  const ro = ctx.readOnly || !useCollectionAccess(c.id).canEditStructure;
  const [choice, setChoice] = useState<{ mode: 'new' | 'existing'; name: string; relation?: string }>({ mode: 'new', name: '' });
  const [draft, setDraft] = useState<{ mode: DateShiftMode | 'none'; avoid: boolean; date?: string; end?: string }>({ mode: 'consume_gap', avoid: true, date: firstDateProperty(c.schema) });
  if (!cfg) {
    return (
      <>
        <Header title="종속 관계" onBack={() => go('main')} close={close} />
        <div className="nc-rf-desc">{`종속 관계로 다른 ${noun.items}을(를) 막고 있거나 막힌 ${noun.items}을(를) 표시합니다.`}</div>
        <RelationChooser c={c} value={choice} onChange={setChoice} placeholder="종속 관계…" caption={`Choose the link field for blocked ${noun.items}. “Blocking” is the default.`} />
        <ShiftOptions mode={draft.mode} avoidWeekends={draft.avoid} disabled={ro} noun={noun.items} onMode={(m) => setDraft({ ...draft, mode: m })} onAvoid={(v) => setDraft({ ...draft, avoid: v })} />
        <ShiftUsing c={c} date={draft.date} end={draft.end} disabled={ro} onChange={(d, e) => setDraft({ ...draft, date: d, end: e ?? undefined })} />
        <div className="nc-rf-cta"><div role="button" data-testid="turn-on-dependencies" className={`nc-btn primary nc-rf-cta-btn ${ro ? 'disabled' : ''}`} onClick={() => !ro && turnOnDependencies(c, {
          relation: choice.mode === 'existing' ? choice.relation : undefined, name: choice.name, mode: draft.mode === 'none' ? null : draft.mode, avoidWeekends: draft.avoid, dateProperty: draft.date, endDateProperty: draft.end, view,
        })}>종속 관계 사용</div></div>
      </>
    );
  }
  const shownInView = (view.format as Record<string, any> | undefined)?.timeline_arrows_by?.property;
  return (
    <>
      <Header title="종속 관계" onBack={() => go('main')} close={close} />
      <Section className="nc-vs-sec first">
        <Row label="속성" value={c.schema[cfg.blocking]?.name} disabled={ro} onClick={(e) => pick(e.currentTarget, selfRelations(c).map(([id, p]) => ({ id, label: p.name, icon: <PropertyIcon prop={p} size={16} />, checked: id === cfg.blocking, onSelect: () => turnOnDependencies(c, { relation: id, mode: cfg.mode ?? null, avoidWeekends: cfg.avoidWeekends, dateProperty: cfg.dateProperty, endDateProperty: cfg.endDateProperty }) })))} />
        <div className="nc-rf-caption">새 레이아웃에서 이 속성을 종속 관계와 날짜 이동에 사용합니다.</div>
        {view.type === 'timeline' && (
          <Row label={shownInView ? '이 레이아웃에서 종속성 숨기기' : '이 보기에 종속성 표시'} chevron={false} disabled={ro} onClick={() => updateViewFormat(view.id, { timeline_arrows_by: shownInView ? undefined : { property: cfg.blocking } }, 'dependencies.toggleView')} />
        )}
      </Section>
      <ShiftOptions mode={cfg.mode ?? 'none'} avoidWeekends={cfg.avoidWeekends} disabled={ro} noun={noun.items} onMode={(m) => updateDependencySettings(c, { mode: m === 'none' ? null : m })} onAvoid={(v) => updateDependencySettings(c, { avoid_weekends: v })} />
      <ShiftUsing c={c} date={cfg.dateProperty} end={cfg.endDateProperty} disabled={ro} onChange={(d, e) => updateDependencySettings(c, { date_property: d, end_date_property: e === undefined ? cfg.endDateProperty ?? null : e })} />
      <Section divider className="nc-vs-sec last">
        <Row icon="trash" label="종속 관계 해제" chevron={false} disabled={ro} testid="turn-off-dependencies" onClick={() => openTurnOffModal({
          title: '종속 관계를 해제할까요?', property: c.schema[cfg.blocking]?.name ?? '막는 항목', inverse: cfg.blockedBy ? c.schema[cfg.blockedBy]?.name : undefined,
          onPick: (remove) => turnOffDependencies(c, remove),
        })} />
      </Section>
    </>
  );
}

// ------------------------------------------------------------------ Sprints

export function SprintsPage({ ctx, view, collection: c0, go, close }: PageProps) {
  const c = useCollection(c0.id) ?? c0;
  const ro = ctx.readOnly || !useCollectionAccess(c.id).canEditStructure;
  return (
    <>
      <Header title="스프린트" onBack={() => go('main')} close={close} />
      <SprintSettingsBody collection={c} view={view} block={ctx.block} readOnly={ro} closePanel={close} />
      {void sprintSettingsOf}
    </>
  );
}

export function Caption({ children }: { children: ReactNode }) {
  return <div className="nc-rf-caption">{children}</div>;
}

export { cap };
