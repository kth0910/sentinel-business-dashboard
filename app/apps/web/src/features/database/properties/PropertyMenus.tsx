// Property menus: column header menu (Edit property / Change type / Filter / Sort / Group / Calculate /
// Freeze / Hide / Wrap / Insert left|right / Duplicate / Delete), per-type "Edit property" flyouts,
// Calculate / Sort / Change type submenus and the "+ Add property" type picker.
// Item lists and per-type gating follow the configured property definitions.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { STATUS_GROUP_LABELS } from '@nc/shared/database/schema.ts';
import { TRIM } from '../../biz/flags.ts';
import type { BlockRecord, CollectionRecord, CollectionViewRecord, PropertySchema, PropertyType, SelectOption, SpaceRecord } from '@nc/shared/records.ts';
import {
  AGGREGATION_LABELS, CREATABLE_TYPES, DATE_FORMATS, NUMBER_FORMATS, NUMBER_PRECISIONS, PICKER_SECTIONS, TIME_FORMATS, defaultFilterOperator, defaultGroupBy,
  isGroupable, propertyTypeMeta, timeFormatId, type AggregationSpec, type GroupBy, type StatusGroup, groupByOf, aggregatorName,
} from '@nc/shared/database/index.ts';
import { COLOR_LABELS } from '@nc/shared/colors.ts';
import { records } from '../../../lib/store/records.ts';
import { useCollection, useCollectionView } from '../../../lib/hooks.ts';
import { openMenu, type MenuDef, type MenuItemDef } from '../../../components/Menu.tsx';
import { openOverlay, PopoverSurface, useOverlays } from '../../../components/overlay.tsx';
import { Icon } from '../../../components/Icon.tsx';
import { openIconPicker } from '../../page/IconPicker.tsx';
import { confirmDialog } from '../../page/confirm.tsx';
import { toPlainText } from '@nc/shared/richtext.ts';
import {
  addOption, addProperty, changePropertyType, deleteOption, deleteProperty, duplicateProperty, renameProperty, reorderOptions, setAggregation,
  setGroupBy, setPropertyVisible, setSorts, updateOption, updateProperty, updateViewFormat, updateViewProperty, viewProperties, setGroupAggregation,
  deleteIdProperty, permanentlyDeleteProperty, restoreProperty,
} from '../actions.ts';
import { useCollectionAccess } from '../access.ts';
import { PropertyIcon } from './PropertyCell.tsx';
import { OptionPill, StatusPill } from './ValueView.tsx';
import { ColorSwatch } from './editors/SelectEditor.tsx';
import { Toggle, reminderLabel } from './editors/DatePicker.tsx';
import { propertyConfigRegistry, propertyCreatedHooks } from './editorRegistry.ts';
import { REMINDER_OPTIONS_DATE, canRestrictProperty, hasPropertyRule, subitemConfigOf } from '@nc/shared/database/index.ts';
import './properties.css';
import { openNestedMenu } from '../menus.ts';
import { autofillMenuItems, createAutofillProperty } from '../../ai/autofillUi.tsx';

export interface PropMenuContext {
  collectionId: string;
  propId: string;
  view?: CollectionViewRecord;
  block?: BlockRecord;
  readOnly?: boolean;
  /** add a filter chip for this property and open its editor */
  onAddFilter?: (propId: string) => void;
  /** "Insert left/right": open the add-property picker next to this column */
  onInsert?: (side: 'left' | 'right') => void;
  onClose?: () => void;
}

export function overlayIdOf(el: Element | null | undefined): number | undefined {
  const o = el?.closest?.('[data-overlay-id]') as HTMLElement | null;
  return o ? Number(o.dataset.overlayId) : undefined;
}

const OPTION_COLORS = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const;

function col(id: string) {
  return records.get<CollectionRecord>('collection', id);
}

// ---------- sort / calculate / change type submenus ----------

export function sortLabels(type: string): [string, string] {
  switch (type) {
    case 'date': case 'created_time': case 'last_edited_time': case 'last_visited_time':
      return ['오래된 순으로 정렬', '최신순 정렬'];
    case 'number': case 'auto_increment_id':
      return ['낮음 → 높음 정렬', '높음 → 낮음 정렬'];
    case 'checkbox':
      return ['체크 안 됨 → 체크됨 순으로 정렬', '체크된 항목 먼저 정렬'];
    case 'select': case 'multi_select': case 'status': case 'rollup': case 'formula':
      return ['오름차순 정렬', '내림차순 정렬'];
    default:
      return ['A → Z 순으로 정렬', 'Z → A 순으로 정렬'];
  }
}

export function sortMenuDef(view: CollectionViewRecord, propId: string, prop: PropertySchema): MenuDef {
  const [asc, desc] = sortLabels(prop.type);
  const apply = (direction: 'ascending' | 'descending') => {
    const cur = (view.query2?.sort ?? []).filter((s) => s.property !== propId);
    setSorts(view, [{ property: propId, direction }, ...cur]);
  };
  return { width: 200, sections: [{ items: [{ id: 'asc', label: asc, onSelect: () => apply('ascending') }, { id: 'desc', label: desc, onSelect: () => apply('descending') }] }] };
}

function bucketItems(agg: string[], current: string, pick: (a: string) => void): MenuItemDef[] {
  return agg.map((a) => ({ id: a, label: AGGREGATION_LABELS[a]?.full ?? a, checked: current === a, onSelect: () => pick(a) }));
}

/** Calculate submenu (None / Count › / Percent › / Date › | More options ›). */
export function calculateMenuDef(prop: PropertySchema, current: string, pick: (aggregator: string | AggregationSpec['aggregator']) => void, opts?: { limitToggle?: { on: boolean; set: (v: boolean) => void } }): MenuDef {
  const type = prop.type === 'formula' || prop.type === 'rollup' ? ((prop as any).formula2?.result_type?.type ?? 'number') : prop.type;
  const isCheckbox = type === 'checkbox';
  const isNumber = type === 'number' || type === 'auto_increment_id';
  const isDate = ['date', 'created_time', 'last_edited_time', 'last_visited_time'].includes(type);
  const countAggs = isCheckbox ? ['count', 'checked', 'unchecked'] : ['count', 'count_values', 'unique', 'empty', 'not_empty'];
  const pctAggs = isCheckbox ? ['percent_checked', 'percent_unchecked'] : ['percent_empty', 'percent_not_empty'];
  const items: MenuItemDef[] = [
    { id: 'none', label: '없음', checked: !current || current === 'none', onSelect: () => pick('none') },
    {
      id: 'count', label: '개수', checked: countAggs.includes(current), submenu: () => ({
        width: 250,
        sections: [
          ...(opts?.limitToggle ? [{ items: [{ id: 'limit', label: '큰 수는 99+로 표시', description: '항목이 많은 테이블의 성능이 좋아집니다.', right: <Toggle on={opts.limitToggle.on} />, onSelect: () => { opts.limitToggle!.set(!opts.limitToggle!.on); return false; } }] }] : []),
          { items: bucketItems(countAggs, current, pick) },
        ],
      }),
    },
    { id: 'percent', label: '퍼센트', checked: pctAggs.includes(current), submenu: () => ({ width: 250, sections: [{ items: bucketItems(pctAggs, current, pick) }] }) },
  ];
  if (prop.type === 'status') {
    const groups = (prop.groups ?? []) as StatusGroup[];
    items.push({
      id: 'per_group', label: '그룹별', submenu: () => ({
        width: 250,
        sections: [
          { title: '그룹별 개수', items: groups.map((g) => ({ id: `c:${g.id}`, label: (STATUS_GROUP_LABELS[g.name] ?? g.name), onSelect: () => pick({ operator: 'count_per_group', groupName: g.name }) })) },
          { title: '그룹별 비율', items: groups.map((g) => ({ id: `p:${g.id}`, label: (STATUS_GROUP_LABELS[g.name] ?? g.name), onSelect: () => pick({ operator: 'percent_per_group', groupName: g.name }) })) },
        ],
      }),
    });
  }
  if (isDate) items.push({ id: 'date', label: '날짜', checked: ['earliest_date', 'latest_date', 'date_range'].includes(current), submenu: () => ({ width: 250, sections: [{ items: bucketItems(['earliest_date', 'latest_date', 'date_range'], current, pick) }] }) });
  if (isNumber) items.push({ id: 'more', label: '옵션 더 보기', checked: ['sum', 'average', 'median', 'min', 'max', 'range'].includes(current), submenu: () => ({ width: 250, sections: [{ items: bucketItems(['sum', 'average', 'median', 'min', 'max', 'range'], current, pick) }] }) });
  return { width: 200, sections: [{ items }] };
}

export function changeTypeMenuDef(collectionId: string, propId: string, prop: PropertySchema, onChanged?: (t: PropertyType) => void): MenuDef {
  return {
    width: 200,
    maxHeight: 470,
    sections: [{
      items: CREATABLE_TYPES.map((t) => {
        const meta = propertyTypeMeta(t);
        return {
          id: t,
          label: meta.label,
          icon: <PropertyIcon prop={{ type: t }} size={16} style={{ color: 'var(--lp-icon-primary)' }} />,
          checked: prop.type === t,
          disabled: t === 'auto_increment_id' && prop.type !== t,
          onSelect: async () => {
            // Relation (again, or from another type) asks which data source it relates to 
            const pickTarget = () => { void import('../advanced/RelationConfig.tsx').then((m) => m.openRelationConfig(null, { collectionId, propertyId: propId })); };
            if (prop.type === t) {
              if (t === 'relation') pickTarget();
              return;
            }
            if (prop.type === 'relation') {
              const ok = await confirmDialog({ message: '모든 연결 값이 삭제되며 되돌릴 수 없습니다', confirmLabel: '계속' });
              if (!ok) return;
            }
            changePropertyType(collectionId, propId, t);
            onChanged?.(t);
            if (t === 'relation') pickTarget();
          },
        } satisfies MenuItemDef;
      }),
    }],
  };
}

// ---------- "Edit property" flyout ----------

function FlyRow({ icon, label, value, chevron = true, onClick, children }: { icon?: string | ReactNode; label: ReactNode; value?: ReactNode; chevron?: boolean; onClick?: (e: React.MouseEvent<HTMLDivElement>) => void; children?: ReactNode }) {
  return (
    <div role="menuitem" className="nc-menu-item nc-fly-row" onClick={onClick} onMouseDown={(e) => e.preventDefault()}>
      <div className="nc-menu-item-inner">
        {icon && <div className="nc-menu-icon">{typeof icon === 'string' ? <Icon name={icon} size={20} /> : icon}</div>}
        <div className="nc-menu-label">{label}</div>
        {value !== undefined && <span className="nc-menu-value">{value}</span>}
        {children}
        {chevron && <Icon name="arrowChevronSingleRightSmall" size={16} style={{ color: 'var(--lp-icon-tertiary)' }} />}
      </div>
    </div>
  );
}

function dropdown(anchor: HTMLElement, items: MenuItemDef[], opts?: { width?: number; search?: string; maxHeight?: number }) {
  return openNestedMenu(anchor, { width: opts?.width ?? 250, search: opts?.search, maxHeight: opts?.maxHeight, sections: [{ items }] }, { placement: 'bottom-end', offset: 2, parent: overlayIdOf(anchor), backdrop: 'transparent' });
}

function DateFlyout({ collectionId, propId, prop, timeOnly }: { collectionId: string; propId: string; prop: PropertySchema; timeOnly?: boolean }) {
  const df = (prop.date_format as string | undefined) ?? 'll';
  const tf = prop.time_format as string | undefined;
  const reminder = prop.default_reminder as any;
  return (
    <div className="nc-menu-section">
      <FlyRow icon="viewCalendar" label="날짜 형식" value={DATE_FORMATS.find((f) => f.id === df)?.label ?? '전체 날짜'} onClick={(e) => dropdown(e.currentTarget, DATE_FORMATS.map((f) => ({ id: f.id, label: f.label, checked: df === f.id, onSelect: () => updateProperty(collectionId, propId, { date_format: f.id }) })))} />
      <FlyRow icon="clock" label="시간 형식" value={TIME_FORMATS.find((f) => f.id === timeFormatId(tf))?.label} onClick={(e) => dropdown(e.currentTarget, TIME_FORMATS.map((f) => ({ id: f.id, label: f.label, checked: timeFormatId(tf) === f.id, onSelect: () => updateProperty(collectionId, propId, { time_format: f.stored }) })))} />
      {!timeOnly && (
        <FlyRow icon="alarm" label="알림" value={reminderLabel(reminder, false)} onClick={(e) => dropdown(e.currentTarget, REMINDER_OPTIONS_DATE.map((o, i) => ({ id: String(i), label: reminderLabel(o as any, false), checked: JSON.stringify(o) === JSON.stringify(reminder ?? { unit: 'none' }), onSelect: () => updateProperty(collectionId, propId, { default_reminder: o.unit === 'none' ? undefined : o }) })))} />
      )}
    </div>
  );
}

function NumberFlyout({ collectionId, propId, prop }: { collectionId: string; propId: string; prop: PropertySchema }) {
  const fmt = (prop.number_format as string | undefined) ?? 'number';
  const prec = (prop.number_precision as string | undefined) ?? 'precision_uncapped';
  const showAs = (prop.show_as as { type?: string; color?: string; maxValue?: number; showValue?: boolean } | undefined) ?? undefined;
  const mode = showAs?.type ?? 'number';
  const fmtLabel = (f: (typeof NUMBER_FORMATS)[number]) => (f.currency && f.id !== 'bitcoin' ? `${f.label} (${f.currency})` : f.id === 'bitcoin' ? '비트코인(BTC)' : f.id === 'number_with_commas' ? '구분 기호 포함 숫자' : f.label);
  const setShow = (patch: Record<string, unknown>) => updateProperty(collectionId, propId, { show_as: { type: mode, color: 'green', maxValue: 100, showValue: true, ...(showAs ?? {}), ...patch } });
  return (
    <>
      <div className="nc-menu-section">
        <FlyRow label="숫자 형식" value={fmtLabel(NUMBER_FORMATS.find((f) => f.id === fmt) ?? NUMBER_FORMATS[0])} onClick={(e) => openNestedMenu(e.currentTarget, { width: 192, search: '형식 필터…', maxHeight: 600, sections: [{ items: NUMBER_FORMATS.map((f) => ({ id: f.id, label: fmtLabel(f), onSelect: () => updateProperty(collectionId, propId, { number_format: f.id }) })) }] }, { placement: 'right-start', parent: overlayIdOf(e.currentTarget) })} />
        <FlyRow label="소수점 자릿수" value={prec === 'precision_uncapped' ? '기본' : NUMBER_PRECISIONS.find((p) => p.id === prec)?.digits} onClick={(e) => dropdown(e.currentTarget, NUMBER_PRECISIONS.map((p) => ({ id: p.id, label: p.digits === null ? '기본값' : String(p.digits), checked: prec === p.id, onSelect: () => updateProperty(collectionId, propId, { number_precision: p.id }) })))} />
      </div>
      <div className="nc-menu-section with-divider">
        <div className="nc-menu-section-title">표시 방식</div>
        <div className="nc-show-as-tiles">
          {[
            { id: 'number', label: '숫자', preview: <span className="nc-show-as-42">42</span> },
            { id: 'bar', label: '막대', preview: <span className="nc-show-as-bar"><span /></span> },
            { id: 'ring', label: '링', preview: <svg width={20} height={20} viewBox="0 0 20 20"><circle cx={10} cy={10} r={7} fill="none" stroke="var(--lp-border-primary-transparent)" strokeWidth={3} /><circle cx={10} cy={10} r={7} fill="none" stroke="currentColor" strokeWidth={3} strokeDasharray="22 44" transform="rotate(-90 10 10)" /></svg> },
          ].map((tile) => (
            <div key={tile.id} role="button" className={`nc-show-as-tile ${mode === tile.id ? 'selected' : ''}`} onClick={() => (tile.id === 'number' ? updateProperty(collectionId, propId, { show_as: undefined }) : setShow({ type: tile.id }))}>
              <div className="nc-show-as-preview">{tile.preview}</div>
              <div className="nc-show-as-label">{tile.label}</div>
            </div>
          ))}
        </div>
        {mode !== 'number' && (
          <div className="nc-show-as-settings" data-menu-keys="ignore">
            <div className="nc-show-as-row">
              <span>색상</span>
              <span role="button" className="nc-show-as-color" onClick={(e) => dropdown(e.currentTarget, OPTION_COLORS.filter((c) => c !== 'default').map((c) => ({ id: c, label: COLOR_LABELS[c], icon: <ColorSwatch color={c} />, checked: (showAs?.color ?? 'green') === c, onSelect: () => setShow({ color: c }) })), { width: 190 })}>
                <ColorSwatch color={showAs?.color ?? 'green'} />
                {COLOR_LABELS[(showAs?.color ?? 'green') as keyof typeof COLOR_LABELS] ?? '초록색'}
                <Icon name="arrowChevronSingleDownSmall" size={14} />
              </span>
            </div>
            <div className="nc-show-as-row">
              <span>나누기</span>
              <span className="nc-input nc-show-as-divide"><input defaultValue={String(showAs?.maxValue ?? 100)} onBlur={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n > 0) setShow({ maxValue: n }); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} /></span>
            </div>
            <div className="nc-show-as-row">
              <span>숫자 표시</span>
              <Toggle on={showAs?.showValue !== false} onChange={(v) => setShow({ showValue: v })} />
            </div>
          </div>
        )}
        <div className="nc-fly-footnote">이 속성을 표시하는 모든 보기에 변경 사항이 적용됩니다.</div>
      </div>
    </>
  );
}

/** Option row "›" submenu: name, description, Delete, (status: Set as default, Group ›), Colors. */
export function optionEditMenuDef(collectionId: string, propId: string, prop: PropertySchema, option: SelectOption): MenuDef {
  let name = option.value;
  const isStatus = prop.type === 'status';
  const groups = (prop.groups ?? []) as StatusGroup[];
  const curGroup = groups.find((g) => g.optionIds?.includes(option.id));
  return {
    width: 220,
    header: (
      <div className="nc-option-menu-head" data-menu-keys="ignore">
        <div className="nc-input focused">
          <input
            autoFocus
            defaultValue={option.value}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => (name = e.target.value)}
            onBlur={() => name.trim() && name !== option.value && updateOption(collectionId, propId, option.id, { value: name })}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur(); }}
          />
        </div>
      </div>
    ),
    sections: [
      {
        items: [
          { id: 'delete', label: '삭제', icon: 'trash', onSelect: () => deleteOption(collectionId, propId, option.id) },
          ...(isStatus ? [
            { id: 'default', label: '기본값으로 설정', icon: 'flag', disabled: prop.defaultOption === option.value, onSelect: () => updateProperty(collectionId, propId, { defaultOption: option.value }) },
            {
              id: 'group', label: '그룹', icon: 'checkmarkSquare', right: <span className="nc-menu-value">{curGroup?.name ?? ''}</span>,
              submenu: () => ({ width: 200, sections: [{ items: groups.map((g) => ({ id: g.id, label: (STATUS_GROUP_LABELS[g.name] ?? g.name), checked: g.id === curGroup?.id, onSelect: () => {
                const next = groups.map((x) => ({ ...x, optionIds: (x.optionIds ?? []).filter((id) => id !== option.id) }));
                next.find((x) => x.id === g.id)!.optionIds.push(option.id);
                updateProperty(collectionId, propId, { groups: next });
              } })) }] }),
            },
          ] as MenuItemDef[] : []),
        ],
      },
      {
        title: '색상',
        items: OPTION_COLORS.map((c) => ({ id: c, label: COLOR_LABELS[c], icon: <ColorSwatch color={c} />, checked: (option.color ?? 'default') === c, onSelect: () => { updateOption(collectionId, propId, option.id, { color: c }); } })),
      },
    ],
  };
}

function OptionsFlyout({ collectionId, propId, prop }: { collectionId: string; propId: string; prop: PropertySchema }) {
  const [adding, setAdding] = useState<string | null>(null); // group id ('' for select)
  const [newName, setNewName] = useState('');
  const [drag, setDrag] = useState<{ id: string } | null>(null);
  const [over, setOver] = useState<{ id: string; before: boolean } | null>(null);
  const isStatus = prop.type === 'status';
  const options = prop.options ?? [];
  const groups = (prop.groups ?? []) as StatusGroup[];
  const sortMode = (prop.option_sort as string | undefined) ?? 'manual';

  const create = (groupId?: string) => {
    if (newName.trim()) addOption(collectionId, propId, newName.trim(), { groupId });
    setNewName('');
    setAdding(null);
  };

  const drop = (targetId: string, before: boolean) => {
    if (!drag || drag.id === targetId) return;
    const ids = options.map((o) => o.id).filter((id) => id !== drag.id);
    const ti = ids.indexOf(targetId);
    ids.splice(before ? ti : ti + 1, 0, drag.id);
    if (isStatus) {
      const next = groups.map((g) => ({ ...g, optionIds: (g.optionIds ?? []).filter((id) => id !== drag.id) }));
      const tg = next.find((g) => g.optionIds.includes(targetId) || groups.find((x) => x.id === g.id)?.optionIds?.includes(targetId));
      if (tg) {
        const pos = tg.optionIds.indexOf(targetId);
        tg.optionIds.splice(before ? pos : pos + 1, 0, drag.id);
      }
      reorderOptions(collectionId, propId, ids, next);
    } else {
      reorderOptions(collectionId, propId, ids);
      if (sortMode !== 'manual') updateProperty(collectionId, propId, { option_sort: 'manual' });
    }
    setDrag(null);
    setOver(null);
  };

  const row = (o: SelectOption) => (
    <div
      key={o.id}
      role="menuitem"
      className={`nc-menu-item nc-option-row ${over?.id === o.id ? (over.before ? 'drop-before' : 'drop-after') : ''}`}
      draggable
      onDragStart={() => setDrag({ id: o.id })}
      onDragOver={(e) => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setOver({ id: o.id, before: e.clientY < r.top + r.height / 2 }); }}
      onDrop={() => over && drop(over.id, over.before)}
      onDragEnd={() => { setDrag(null); setOver(null); }}
      onClick={(e) => openNestedMenu(e.currentTarget, optionEditMenuDef(collectionId, propId, prop, o), { placement: 'right-start', parent: overlayIdOf(e.currentTarget), backdrop: 'transparent' })}
    >
      <div className="nc-menu-item-inner">
        <span className="nc-option-drag"><Icon name="dragHandle" size={14} /></span>
        <div className="nc-menu-label">{isStatus ? <StatusPill option={o} /> : <OptionPill option={o} />}</div>
        {isStatus && prop.defaultOption === o.value && <span className="nc-option-default">기본</span>}
        <Icon name="arrowChevronSingleRightSmall" size={16} style={{ color: 'var(--lp-icon-secondary)' }} />
      </div>
    </div>
  );

  const adder = (groupId?: string) => adding === (groupId ?? '') && (
    <div className="nc-option-add-input" data-menu-keys="ignore">
      <div className="nc-input focused">
        <input autoFocus placeholder="새 옵션을 입력하세요…" value={newName} onChange={(e) => setNewName(e.target.value)} onBlur={() => create(groupId)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); create(groupId); setAdding(groupId ?? ''); } if (e.key === 'Escape') { e.preventDefault(); setAdding(null); } }} />
      </div>
    </div>
  );

  if (isStatus) {
    return (
      <>
        {groups.map((g, gi) => (
          <div key={g.id} className={`nc-menu-section ${gi ? 'with-divider' : ''}`}>
            <div className="nc-menu-section-title nc-options-title">
              <span>{(STATUS_GROUP_LABELS[g.name] ?? g.name)}</span>
              <span role="button" className="nc-options-add" aria-label="옵션 만들기" onClick={() => { setAdding(g.id); setNewName(''); }}><Icon name="plus" size={14} /></span>
            </div>
            {adder(g.id)}
            {(g.optionIds ?? []).map((id) => options.find((o) => o.id === id)).filter(Boolean).map((o) => row(o!))}
          </div>
        ))}
      </>
    );
  }
  return (
    <>
      <div className="nc-menu-section">
        <FlyRow icon="arrowUpDown" label="정렬" value={sortMode === 'alphabetical' ? '가나다순' : sortMode === 'reverse_alphabetical' ? '가나다 역순' : '수동'} onClick={(e) => dropdown(e.currentTarget, [
          { id: 'manual', label: '수동', checked: sortMode === 'manual', onSelect: () => updateProperty(collectionId, propId, { option_sort: 'manual' }) },
          { id: 'az', label: '가나다순', checked: sortMode === 'alphabetical', onSelect: () => { const sorted = [...options].sort((a, b) => a.value.localeCompare(b.value)); reorderOptions(collectionId, propId, sorted.map((o) => o.id)); updateProperty(collectionId, propId, { option_sort: 'alphabetical' }); } },
          { id: 'za', label: '가나다 역순', checked: sortMode === 'reverse_alphabetical', onSelect: () => { const sorted = [...options].sort((a, b) => b.value.localeCompare(a.value)); reorderOptions(collectionId, propId, sorted.map((o) => o.id)); updateProperty(collectionId, propId, { option_sort: 'reverse_alphabetical' }); } },
        ])} />
      </div>
      <div className="nc-menu-section with-divider">
        <div className="nc-menu-section-title nc-options-title">
          <span>옵션</span>
          <span role="button" className="nc-options-add" aria-label="옵션 만들기" onClick={() => { setAdding(''); setNewName(''); }}><Icon name="plus" size={14} /></span>
        </div>
        {adder()}
        {options.map(row)}
        {!options.length && adding === null && <div className="nc-options-empty">옵션 없음</div>}
      </div>
      <div className="nc-menu-section with-divider">
        <div role="menuitem" className="nc-menu-item disabled"><div className="nc-menu-item-inner"><div className="nc-menu-icon"><Icon name="aiFace" size={20} /></div><div className="nc-menu-label">AI로 생성</div></div></div>
      </div>
    </>
  );
}

const ID_PREFIX = /^[A-Za-z][A-Za-z0-9-]{1,9}$/;

function IdFlyout({ collectionId, propId, prop }: { collectionId: string; propId: string; prop: PropertySchema }) {
  const [prefix, setPrefix] = useState((prop.prefix as string | undefined) ?? '');
  const [error, setError] = useState('');
  const suggestion = (toPlainText(col(collectionId)?.name as any) || 'TAS').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'TAS';
  const shown = prefix || suggestion;
  const apply = () => {
    const next = (prefix || suggestion).toUpperCase();
    // The server validates the same prefix format.
    if (!ID_PREFIX.test(next)) return setError('접두사는 문자로 시작해야 하며, 문자·숫자·하이픈을 최대 9개까지 이어 쓸 수 있습니다.');
    setError('');
    updateProperty(collectionId, propId, { prefix: next });
    setPrefix(next);
  };
  return (
    <div className="nc-menu-section nc-id-flyout" data-menu-keys="ignore">
      <div className="nc-id-prefix-row">
        <span className="nc-id-prefix-label">접두사</span>
        <span className="nc-input"><input placeholder={suggestion} value={prefix} data-testid="id-prefix" onChange={(e) => { setError(''); setPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 10)); }} onKeyDown={(e) => { if (e.key === 'Enter') apply(); }} /></span>
      </div>
      <div className="nc-id-preview">{`${shown}-1, ${shown}-2, ${shown}-3, …`}</div>
      {error && <div className="nc-id-error" role="alert">{error}</div>}
      <div role="button" className="nc-btn primary nc-id-apply" data-testid="id-prefix-apply" onClick={apply}>
        <Icon name="plus" size={14} />{prop.prefix ? 'ID 접두사 수정' : 'ID 접두사 만들기'}
      </div>
    </div>
  );
}

/** Person property notifications: who is notified when someone is added. */
const NOTIFY_LABEL: Record<string, string> = { users_and_groups: '사용자 및 그룹', users: '사용자만', none: '없음' };

function LimitFlyout({ collectionId, propId, prop, kind }: { collectionId: string; propId: string; prop: PropertySchema; kind: 'person' | 'file' }) {
  const limit = prop.limit === 1 ? 1 : 0;
  return (
    <div className="nc-menu-section">
      <FlyRow icon="numbers123" label="제한" value={limit ? `1 ${kind === 'person' ? 'person' : 'file'}` : '제한 없음'} onClick={(e) => dropdown(e.currentTarget, [
        { id: 'none', label: '제한 없음', checked: !limit, onSelect: () => updateProperty(collectionId, propId, { limit: undefined }) },
        { id: 'one', label: `1 ${kind === 'person' ? 'person' : 'file'}`, checked: limit === 1, onSelect: () => updateProperty(collectionId, propId, { limit: 1 }) },
      ])} />
      {kind === 'person' && (
        <>
          <FlyRow icon="personCircle" label="기본" value={prop.default === 'created_by' ? '생성자' : '기본값 없음'} onClick={(e) => dropdown(e.currentTarget, [
            { id: 'none', label: '기본값 없음', checked: prop.default !== 'created_by', onSelect: () => updateProperty(collectionId, propId, { default: undefined }) },
            { id: 'cb', label: '생성자', checked: prop.default === 'created_by', onSelect: () => updateProperty(collectionId, propId, { default: 'created_by' }) },
          ])} />
          <FlyRow icon="bell" label="알림" value={NOTIFY_LABEL[(prop.notification_mode as string | undefined) ?? 'users'] ?? '사용자만'} onClick={(e) => dropdown(e.currentTarget, (['users_and_groups', 'users', 'none'] as const).map((m) => ({
            id: m, label: NOTIFY_LABEL[m], checked: ((prop.notification_mode as string | undefined) ?? 'users') === m, onSelect: () => updateProperty(collectionId, propId, { notification_mode: m === 'users' ? undefined : m }),
          })))} />
        </>
      )}
    </div>
  );
}

/** Fallback rollup/relation/formula config used until the formula/relation/rollup work stream registers its own. */
function ComputedFallbackFlyout({ collectionId, propId, prop }: { collectionId: string; propId: string; prop: PropertySchema }) {
  const c = col(collectionId)!;
  if (prop.type === 'relation') {
    const target = records.get<CollectionRecord>('collection', String(prop.collection_id ?? ''));
    const all = records.all<CollectionRecord>('collection').filter((x) => x.alive !== false);
    return (
      <div className="nc-menu-section">
        <FlyRow icon="arrowDiagonalUpRight" label="관련 대상" value={target ? toPlainText(target.name as any) || '제목 없음' : '선택'} onClick={(e) => dropdown(e.currentTarget, all.map((x) => ({ id: x.id, label: toPlainText(x.name as any) || '제목 없음', checked: x.id === target?.id, onSelect: () => updateProperty(collectionId, propId, { collection_id: x.id, collection_pointer: { id: x.id, table: 'collection', spaceId: x.space_id } }) })), { width: 280, search: '데이터 소스 검색…' })} />
        <FlyRow icon="numbers123" label="제한" value={prop.limit === 1 ? '페이지 1개' : '제한 없음'} onClick={(e) => dropdown(e.currentTarget, [
          { id: 'none', label: '제한 없음', checked: prop.limit !== 1, onSelect: () => updateProperty(collectionId, propId, { limit: undefined }) },
          { id: 'one', label: '페이지 1개', checked: prop.limit === 1, onSelect: () => updateProperty(collectionId, propId, { limit: 1 }) },
        ])} />
      </div>
    );
  }
  if (prop.type === 'rollup') {
    const rels = Object.entries(c.schema).filter(([, p]) => p.type === 'relation');
    const rel = c.schema[String(prop.relation_property ?? '')];
    const target = records.get<CollectionRecord>('collection', String(rel?.collection_id ?? ''));
    const targetProp = target?.schema[String(prop.target_property ?? '')];
    const agg = typeof prop.aggregation === 'string' ? prop.aggregation : 'show_original';
    return (
      <div className="nc-menu-section">
        <FlyRow icon="arrowDiagonalUpRight" label="관계형" value={rel?.name ?? '선택'} onClick={(e) => dropdown(e.currentTarget, rels.map(([id, p]) => ({ id, label: p.name, checked: id === prop.relation_property, onSelect: () => updateProperty(collectionId, propId, { relation_property: id }) })), { width: 280 })} />
        <FlyRow icon="pathRoundEnds" label="속성" value={targetProp?.name ?? '선택'} onClick={(e) => target && dropdown(e.currentTarget, Object.entries(target.schema).map(([id, p]) => ({ id, label: p.name, checked: id === prop.target_property, onSelect: () => updateProperty(collectionId, propId, { target_property: id, target_property_type: p.type }) })), { width: 280 })} />
        <FlyRow icon="sum" label="계산" value={agg === 'show_original' ? '원본 표시' : AGGREGATION_LABELS[agg]?.full ?? agg} onClick={(e) => openNestedMenu(e.currentTarget, {
          width: 200,
          sections: [{ items: [
            { id: 'orig', label: '원본 표시', checked: agg === 'show_original', onSelect: () => updateProperty(collectionId, propId, { aggregation: 'show_original' }) },
            { id: 'uniq', label: '고유 값 표시', checked: agg === 'show_unique', onSelect: () => updateProperty(collectionId, propId, { aggregation: 'show_unique' }) },
            ...calculateMenuDef(targetProp ?? { name: '', type: 'number' }, agg, (a) => updateProperty(collectionId, propId, { aggregation: a as any })).sections[0].items.slice(1),
          ] }],
        }, { placement: 'right-start', parent: overlayIdOf(e.currentTarget) })} />
      </div>
    );
  }
  // formula
  return <FormulaFallback collectionId={collectionId} propId={propId} prop={prop} />;
}

function FormulaFallback({ collectionId, propId, prop }: { collectionId: string; propId: string; prop: PropertySchema }) {
  const f2 = (prop as any).formula2;
  const initial = typeof f2?.code === 'string' ? f2.code : toPlainText(f2?.code) || (prop.formula as any)?.expression || '';
  const [code, setCode] = useState(initial);
  return (
    <div className="nc-menu-section nc-formula-fallback" data-menu-keys="ignore">
      <div className="nc-menu-section-title">수식</div>
      <textarea className="nc-formula-input" value={code} placeholder='e.g. prop("Number") * 2' onChange={(e) => setCode(e.target.value)} onBlur={() => updateProperty(collectionId, propId, { version: 'v2', formula2: { code: code ? [[code]] : [], result_type: f2?.result_type ?? { type: 'text' } }, formula: { expression: code } })} />
    </div>
  );
}

export function hasEditFlyout(prop: PropertySchema): boolean {
  if (propertyConfigRegistry[prop.type]) return true;
  return ['date', 'created_time', 'last_edited_time', 'number', 'select', 'multi_select', 'status', 'person', 'file', 'auto_increment_id', 'rollup', 'relation', 'formula'].includes(prop.type);
}

/** Body of the "Edit property" flyout for a property type. */
export function EditPropertyBody({ collectionId, propId, view, close }: { collectionId: string; propId: string; view?: CollectionViewRecord; close?: () => void }) {
  const c = useCollection(collectionId);
  const prop = c?.schema[propId];
  if (!c || !prop) return null;
  const Custom = propertyConfigRegistry[prop.type];
  if (Custom) return <Custom collection={c} propId={propId} prop={prop} view={view} close={close ?? (() => {})} />;
  switch (prop.type) {
    case 'date': return <DateFlyout collectionId={collectionId} propId={propId} prop={prop} />;
    case 'created_time': case 'last_edited_time': return <DateFlyout collectionId={collectionId} propId={propId} prop={prop} timeOnly />;
    case 'number': return <NumberFlyout collectionId={collectionId} propId={propId} prop={prop} />;
    case 'select': case 'multi_select': case 'status': return <OptionsFlyout collectionId={collectionId} propId={propId} prop={prop} />;
    case 'person': return <LimitFlyout collectionId={collectionId} propId={propId} prop={prop} kind="person" />;
    case 'file': return <LimitFlyout collectionId={collectionId} propId={propId} prop={prop} kind="file" />;
    case 'auto_increment_id': return <IdFlyout collectionId={collectionId} propId={propId} prop={prop} />;
    case 'rollup': case 'relation': case 'formula': return <ComputedFallbackFlyout collectionId={collectionId} propId={propId} prop={prop} />;
    default: return <div className="nc-menu-empty">이 속성 유형에는 옵션이 없습니다</div>;
  }
}

function editFlyoutDef(collectionId: string, propId: string, view?: CollectionViewRecord): MenuDef {
  return { width: 300, header: <div data-menu-keys="ignore" className="nc-edit-flyout"><EditPropertyBody collectionId={collectionId} propId={propId} view={view} /></div>, sections: [{ items: [] }], maxHeight: '80vh' };
}

/** Open the "Edit property" body as a standalone popover (page property labels, view settings). */
export function openEditPropertyPopover(anchor: HTMLElement | DOMRect, collectionId: string, propId: string, view?: CollectionViewRecord, opts?: { placement?: 'bottom-start' | 'right-start' }) {
  return openOverlay((close) => (
    <PopoverSurface width={300} maxHeight="80vh" className="nc-edit-property-popover">
      <div className="lit-scroller vertical" data-menu-keys="ignore">
        <PropertyDetailHead collectionId={collectionId} propId={propId} />
        <EditPropertyBody collectionId={collectionId} propId={propId} view={view} close={close} />
        <PropertyDetailActions collectionId={collectionId} propId={propId} view={view} close={close} />
      </div>
    </PopoverSurface>
  ), { anchor, placement: opts?.placement ?? 'bottom-start', offset: 1 });
}

/** Property detail (View settings › Properties › property): name / icon row when the person may edit the schema. */
function PropertyDetailHead({ collectionId, propId }: { collectionId: string; propId: string }) {
  const access = useCollectionAccess(collectionId);
  if (!access.canEditStructure) return null;
  return <PropertyNameHeader collectionId={collectionId} propId={propId} />;
}

/** "Duplicate property" / "Delete property" at the bottom of the property detail. */
function PropertyDetailActions({ collectionId, propId, view, close }: { collectionId: string; propId: string; view?: CollectionViewRecord; close: () => void }) {
  const c = useCollection(collectionId);
  const access = useCollectionAccess(collectionId);
  const prop = c?.schema[propId];
  if (!c || !prop || !access.canEditStructure || propId === 'title' || prop.type === 'title') return null;
  return (
    <div className="nc-menu-section nc-prop-detail-actions">
      <div className="nc-menu-divider" />
      {prop.type !== 'auto_increment_id' && <FlyRow icon="dbDuplicate" label="속성 복제" chevron={false} onClick={() => { duplicateProperty(collectionId, propId, view); close(); }} />}
      <FlyRow icon="dbTrash" label="속성 삭제" chevron={false} onClick={() => { close(); setTimeout(() => void confirmDeleteProperty(collectionId, propId), 0); }} />
    </div>
  );
}

/** View settings › Properties › Deleted properties: Restore / Delete per property, Permanently delete all. */
export function deletedPropertiesMenuDef(collectionId: string): MenuDef {
  const c = col(collectionId);
  const deleted = Object.entries(((c?.deleted_schema ?? {}) as Record<string, PropertySchema>)).filter(([, p]) => !!p);
  const removeOne = async (id: string) => {
    const ok = await confirmDialog({ message: '이 필드를 삭제할까요?', confirmLabel: '삭제', danger: true, width: 300 });
    if (ok) permanentlyDeleteProperty(collectionId, id);
  };
  const removeAll = async () => {
    const ok = await confirmDialog({ message: '모든 필드를 영구 삭제할까요?', description: '이 작업은 되돌릴 수 없습니다.', confirmLabel: '모두 영구 삭제', danger: true, width: 320 });
    if (ok) for (const [id] of deleted) permanentlyDeleteProperty(collectionId, id);
  };
  return {
    width: 280,
    sections: [
      { items: deleted.map(([id, p]) => ({
        id, label: p.name, icon: <PropertyIcon prop={p} size={16} />,
        submenu: () => ({ width: 200, sections: [{ items: [
          { id: 'restore', label: '복원', icon: 'undo', onSelect: () => restoreProperty(collectionId, id) },
          { id: 'delete', label: '삭제', icon: 'trash', onSelect: () => { setTimeout(() => void removeOne(id), 0); } },
        ] }] }),
      })) },
      ...(deleted.length ? [{ items: [{ id: 'all', label: '모두 영구 삭제', icon: 'trash', onSelect: () => { setTimeout(() => void removeAll(), 0); } }] }] : []),
    ],
  };
}

// ---------- header row (icon / name / description) ----------

function PropertyNameHeader({ collectionId, propId, autoFocus }: { collectionId: string; propId: string; autoFocus?: boolean }) {
  const c = useCollection(collectionId);
  const prop = c?.schema[propId];
  const [name, setName] = useState(prop?.name ?? '');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  // header-menu-status: the name field is focused (caret at the end) when a property's menu opens;
    // the title column’s menu leaves it unfocused
  useEffect(() => {
    if (!autoFocus) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, [autoFocus]);
  if (!c || !prop) return null;
  const commit = () => {
    const n = name.trim();
    if (!n || n === prop.name) return;
    const dup = Object.entries(c.schema).some(([id, p]) => id !== propId && p.name.toLowerCase() === n.toLowerCase());
    if (dup) {
      setError(`이름이 ${n}인 필드가 이 테이블에 이미 있습니다.`);
      return;
    }
    setError('');
    renameProperty(collectionId, propId, n);
  };
  return (
    <div className="nc-prop-menu-head" data-menu-keys="ignore">
      <div className="nc-prop-menu-head-row">
        <div role="button" className="nc-prop-icon-btn" aria-label="아이콘 변경" onClick={(e) => openIconPicker(e.currentTarget, { current: prop.icon as string | undefined, onPick: (v) => updateProperty(collectionId, propId, { icon: v ?? undefined }) })}>
          <PropertyIcon prop={prop} size={14} style={{ color: 'rgb(85, 83, 78)' }} />
        </div>
        <div className="nc-input nc-prop-name-input">
          <input
            ref={inputRef}
            value={name}
            placeholder="속성 이름"
            onChange={(e) => { setName(e.target.value); setError(''); }}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                commit();
                if (!error) useOverlays.getState().closeAll();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                useOverlays.getState().closeAll();
              }
            }}
          />
          <span
            role="button"
            className="nc-prop-desc-btn"
            aria-label={prop.description ? '필드 설명 편집' : '속성 설명 추가'}
            data-tooltip={prop.description ? String(prop.description) : '필드 설명 추가'}
            onClick={(e) => openDescriptionPopover(e.currentTarget, collectionId, propId)}
          >
            <Icon name="infoCircleFill" size={20} />
          </span>
        </div>
      </div>
      {error && <div className="nc-prop-name-error">{error}</div>}
    </div>
  );
}

function openDescriptionPopover(anchor: HTMLElement, collectionId: string, propId: string) {
  const prop = col(collectionId)?.schema[propId];
  let text = String(prop?.description ?? '');
  openOverlay((close) => (
    <PopoverSurface width={280} className="nc-prop-desc-popover">
      <div data-menu-keys="ignore" className="nc-prop-desc-body">
        <textarea autoFocus defaultValue={text} placeholder="설명 추가…" onChange={(e) => (text = e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); close(); } }} />
      </div>
    </PopoverSurface>
  ), { anchor, placement: 'bottom-start', parent: overlayIdOf(anchor), onClose: () => updateProperty(collectionId, propId, { description: text.trim() || undefined }) });
}

// ---------- column header menu ----------

const AI_AUTOFILL_TYPES = new Set(['text', 'checkbox', 'multi_select', 'select', 'number', 'person', 'url', 'date', 'email', 'phone_number', 'status']);
const NO_ACCESS = new Set(['created_by', 'created_time', 'auto_increment_id', 'last_edited_by', 'last_edited_time', 'title']);

export function openPropertyHeaderMenu(anchor: HTMLElement, ctx: PropMenuContext): () => void {
  const c = col(ctx.collectionId);
  const prop = c?.schema[ctx.propId];
  if (!c || !prop) return () => {};
  const view = ctx.view;
  const { propId, collectionId } = ctx;
  const type = prop.type;
  const isTitle = propId === 'title' || type === 'title';
  const entries = view ? viewProperties(view, c.schema) : [];
  const entry = entries.find((e) => e.property === propId);
  const fmt = (view?.format ?? {}) as Record<string, any>;
  const tableWrap = fmt.table_wrap !== false;
  const wrapped = entry?.wrap ?? tableWrap;
  const gb = view ? groupByOf(view, c.schema) : null;
  const groupedHere = gb?.property === propId;
  const visible = entries.filter((e) => e.visible);
  const frozenIdx = typeof fmt.table_frozen_column_index === 'number' ? fmt.table_frozen_column_index : -1;
  const myIdx = visible.findIndex((e) => e.property === propId);
  const frozenHere = frozenIdx >= 0 && myIdx >= 0 && myIdx <= frozenIdx;
  const currentAgg = view ? aggregatorName((view.query2?.aggregations ?? []).find((a) => a.property === propId) as AggregationSpec | undefined) : 'none';

  const s2: MenuItemDef[] = [];
  if (isTitle && view) s2.push({ id: 'pageicon', label: '항목 아이콘 표시', icon: 'emojiFace', right: <Toggle on={fmt.show_page_icon !== false} decorative />, onSelect: () => { updateViewFormat(view.id, { show_page_icon: fmt.show_page_icon === false }); return false; } });
  if (type === 'url') s2.push({ id: 'fullurl', label: '전체 URL 표시', icon: 'arrowExpandHorizontal', right: <Toggle on={prop.show_full_url === true} />, onSelect: () => { updateProperty(collectionId, propId, { show_full_url: prop.show_full_url !== true }); return false; } });
  if (type === 'button') s2.push({ id: 'automation', label: '자동화 편집', icon: 'pencilLine', onSelect: () => openButtonConfig(collectionId, propId) });
  if (!ctx.readOnly && hasEditFlyout(prop) && !isTitle) s2.push({ id: 'edit', label: '속성 편집', icon: 'slidersTwo', submenu: () => editFlyoutDef(collectionId, propId, view) });
  if (!NO_ACCESS.has(type) && canRestrictProperty(prop, propId, subitemPairOf(c))) s2.push({ id: 'access', label: '속성 액세스 권한', icon: 'lockKeyhole', right: hasPropertyRule(prop) ? <span className="nc-menu-value">켜기</span> : undefined, onSelect: () => openPropertyAccess(collectionId, propId) });
  if (!isTitle && type !== 'auto_increment_id' && !ctx.readOnly) s2.push({ id: 'type', label: '유형 변경', icon: 'dbTurnInto', submenu: () => changeTypeMenuDef(collectionId, propId, prop) });
  // header-menu-name / -status: "AI Autofill ›" (no promo badge any more), also on the title column
  if (!TRIM.ai && (AI_AUTOFILL_TYPES.has(type) || isTitle)) s2.push({
    id: 'ai', label: 'AI 자동 채우기', icon: 'magicWandSparkle',
    // Basic autofill is configured / run by features/ai; Custom Agent autofill comes with Custom Agents
    submenu: () => ({ width: 260, sections: [{ items: [
      ...(ctx.readOnly ? [{ id: 'basic', label: '기본', icon: 'magicWand', description: '이 속성 유형에서는 사용할 수 없습니다', disabled: true }] : autofillMenuItems(collectionId, propId, view, anchor)),
      { id: 'agent', label: '사용자 지정 에이전트', icon: 'aiFace', badge: '신규', description: '고급 모델이 웹 검색과 연결된 워크스페이스를 바탕으로 속성을 채웁니다.', disabled: true },
    ] }] }),
  });

  const s3: MenuItemDef[] = [];
  if (view && type !== 'button') {
    s3.push({ id: 'filter', label: '필터', icon: 'dbFilter', onSelect: () => ctx.onAddFilter?.(propId) });
    s3.push({ id: 'sort', label: '정렬', icon: 'arrowUpDownSmall', disabled: type === 'rollup' && (prop.aggregation ?? 'show_original') === 'show_original', submenu: () => sortMenuDef(view, propId, prop) });
    if (isGroupable(prop) && !['file', 'place', 'auto_increment_id'].includes(type) && !(type === 'rollup' && (prop.aggregation ?? 'show_original') === 'show_original')) {
      s3.push(groupedHere
        ? { id: 'ungroup', label: '그룹 해제', icon: 'dbGroup', onSelect: () => setGroupBy(view, null) }
        : { id: 'group', label: '그룹', icon: 'dbGroup', onSelect: () => setGroupBy(view, defaultGroupBy(prop, propId, { board: view.type === 'board' }) as GroupBy) });
    }
    s3.push({ id: 'calc', label: '계산', icon: 'sum', submenu: () => calculateMenuDef(prop, currentAgg, (a) => setAggregation(view, propId, a as any)) });
  }
  if (view?.type === 'table') {
    s3.push(frozenHere
      ? { id: 'unfreeze', label: frozenIdx > 0 ? '열 고정 해제' : '열 고정 해제', icon: 'pinSlash', onSelect: () => updateViewFormat(view.id, { table_frozen_column_index: -1 }) }
      : { id: 'freeze', label: '고정', icon: 'dbPin', onSelect: () => updateViewFormat(view.id, { table_frozen_column_index: Math.max(0, myIdx) }) });
  }
  if (view && !isTitle) s3.push({ id: 'hide', label: '숨기기', icon: 'dbEyeSlash', onSelect: () => setPropertyVisible(view, c.schema, propId, false) });
  if (view && type !== 'checkbox' && type !== 'button') {
    s3.push({ id: 'wrap', label: wrapped ? '줄바꿈 해제' : '내용 줄바꿈', icon: wrapped ? 'arrowLineRight' : 'arrowUTurnDownLeft', onSelect: () => updateViewProperty(view, c.schema, propId, { wrap: !wrapped }, wrapped ? 'unwrapColumn' : 'wrapColumn') });
  }
  if (view && type === 'status') {
    const showAs = (entry?.statusShowAs as string | undefined) ?? 'select';
    s3.push({ id: 'displayas', label: '표시 방식', icon: 'dbEye', right: <span className="nc-menu-value">{showAs === 'checkbox' ? '체크박스' : '선택'}</span>, submenu: () => ({ width: 200, sections: [{ items: [
      { id: 'cb', label: '체크박스', icon: 'checkmarkSquare', checked: showAs === 'checkbox', onSelect: () => updateViewProperty(view, c.schema, propId, { statusShowAs: 'checkbox' }) },
      { id: 'sel', label: '선택', icon: 'arrowTriangleDownCircle', checked: showAs !== 'checkbox', onSelect: () => updateViewProperty(view, c.schema, propId, { statusShowAs: undefined }) },
    ] }] }) });
  }

  const s4: MenuItemDef[] = [];
  if (view && !ctx.readOnly) {
    s4.push({ id: 'left', label: '왼쪽에 삽입', icon: 'arrowRectangleLeft', onSelect: () => ctx.onInsert?.('left') });
    s4.push({ id: 'right', label: '오른쪽에 삽입', icon: 'arrowRectangleRight', onSelect: () => ctx.onInsert?.('right') });
  }
  if (!isTitle && type !== 'auto_increment_id' && !ctx.readOnly) s4.push({ id: 'dup', label: '속성 복제', icon: 'dbDuplicate', onSelect: () => duplicateProperty(collectionId, propId, view) });
  if (!isTitle && !ctx.readOnly) s4.push({ id: 'delete', label: '속성 삭제', icon: 'dbTrash', danger: false, onSelect: () => { setTimeout(() => void confirmDeleteProperty(collectionId, propId), 0); } });

  const sections = [{ items: s2 }, { items: s3 }, { items: s4 }].filter((s) => s.items.length);
  //: min-width 220, rows with a toggle make it ~243; the popover sits 6px left of the header cell
  // (dialog margin-inline-start -6px) and opens with no highlighted row; the name field takes focus except on the
    // title column behavior differs from other columns
  const hasToggle = s2.some((it) => it.id === 'pageicon' || it.id === 'fullurl');
  const r = anchor.getBoundingClientRect();
  return openMenu(new DOMRect(r.left - 6, r.top, r.width, r.height), {
    // header-menu-name: the title menu (with the "Display entry icon" toggle) is 243.3 wide, the others 220
    width: hasToggle ? 243.3 : 220,
    role: 'menu',
    initialActive: -1,
    header: ctx.readOnly ? undefined : <PropertyNameHeader collectionId={collectionId} propId={propId} autoFocus={!isTitle} />,
    sections,
  }, { placement: 'bottom-start', offset: 0, onClose: ctx.onClose });
}

export async function confirmDeleteProperty(collectionId: string, propId: string) {
  const c = col(collectionId);
  if (!c) return;
  if (c.schema[propId]?.type === 'auto_increment_id') {
    // IDs have no "Deleted properties" entry.
    const sure = await confirmDialog({ message: 'ID 필드가 영구 삭제됩니다.', confirmLabel: '삭제', danger: true, width: 300 });
    if (sure) deleteIdProperty(collectionId, propId);
    return;
  }
  const name = toPlainText(c.name as any) || 'this database';
  const ok = await confirmDialog({ message: `${name}에서 이 필드를 삭제할까요? 모든 레이아웃에서 제거됩니다.`, confirmLabel: '삭제', width: 300 });
  if (ok) deleteProperty(collectionId, propId);
}

/** Property access: the rule dialog with the other database permissions UI. */
function openPropertyAccess(collectionId: string, propId: string) {
  void import('../permissions/PropertyAccess.tsx').then((m) => m.openPropertyAccessDialog(collectionId, propId));
}

/** Sub-item relation pair (can't get access rules). */
function subitemPairOf(c: CollectionRecord): string[] {
  const cfg = subitemConfigOf(c);
  return cfg ? [cfg.property, cfg.inverse] : [];
}

// ---------- "+ Add property" ----------

export interface AddPropertyOptions {
  collectionId: string;
  view?: CollectionViewRecord;
  afterPropId?: string;
  beforePropId?: string;
  /** called with the new property id (e.g. to open the relation panel) */
  onCreated?: (propId: string, type: PropertyType) => void;
  /** anchor rect is the header cell slot; the name row overlays it */
  overlayHeader?: boolean;
  anchor?: HTMLElement | DOMRect;
  /** called when the menu closes (the table drops its pending column slot) */
  onClose?: () => void;
}

// AI Autofill presets of the "+ Add property" card (05-database-.1)
const AI_PRESETS = [
  { id: 'sum', label: '요약', icon: 'textAlignLeft', options: ['Paragraph', 'Bullets', 'One-liner'] },
  { id: 'tr', label: '번역', icon: 'textTranslate', options: ['English', '한국어', 'Chinese Simplified', 'Chinese Traditional', 'Japanese', '스페인어', 'Russian', 'French', 'Portuguese', '독일어', 'Italian', 'Dutch', 'Indonesian', '필리핀어', 'Vietnamese'] },
];

function AddPropertyMenu({ opts, close }: { opts: AddPropertyOptions; close: () => void }) {
  const [name, setName] = useState('');
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const view = useCollectionView(opts.view?.id);
  const choose = (type: PropertyType) => {
    const pid = addProperty(opts.collectionId, type, { name, view: view ?? opts.view, afterPropId: opts.afterPropId, beforePropId: opts.beforePropId });
    close();
    if (!pid) return;
    opts.onCreated?.(pid, type);
    propertyCreatedHooks[type]?.({ anchor: opts.anchor ?? null, collectionId: opts.collectionId, propId: pid, viewId: (view ?? opts.view)?.id });
  };
  // Verification: wikis and Business / Enterprise workspaces, one per database
  const c = useCollection(opts.collectionId);
  const space = c ? records.get<SpaceRecord>('space', c.space_id) : undefined;
  const canVerify = !!c && !Object.values(c.schema).some((p) => p?.type === 'verification')
    && (!!(c.format as Record<string, unknown> | undefined)?.is_wiki || space?.plan_type === 'business' || space?.plan_type === 'enterprise');
  const picker = PICKER_SECTIONS.map((s) => (s.id === 'advanced' && canVerify ? { ...s, types: [...s.types, 'verification' as PropertyType] } : s));
  const sections = picker.map((s) => ({ ...s, types: s.types.filter((t) => query === null || propertyTypeMeta(t).label.toLowerCase().includes(query.toLowerCase())) })).filter((s) => s.types.length);
  const flat = sections.flatMap((s) => s.types);
  return (
    <div className="nc-add-prop" data-menu-keys="ignore">
      <div className="nc-add-prop-name">
        <span role="button" className="nc-add-prop-icon" aria-label="아이콘 선택"><Icon name="emojiFaceFill" size={16} /></span>
        <input
          autoFocus
          placeholder="필드 이름 입력…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter') { e.preventDefault(); choose((flat[active] as PropertyType) ?? 'text'); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, flat.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(-1, a - 1)); }
            else if (e.key === 'Escape') { e.preventDefault(); close(); }
          }}
        />
      </div>
      <div className="nc-add-prop-card">
        <div className="lit-scroller vertical nc-add-prop-scroll" role="grid">
          <div className="nc-add-prop-section">
            <div className="nc-add-prop-section-title">AI 자동 채우기</div>
            {/* add-property-menu: regular rows; presets open a submenu */}
            {AI_PRESETS.map((a) => (
              <div key={a.id} role="gridcell" className="nc-add-prop-ai" onClick={(e) => openMenu(e.currentTarget, { width: 220, sections: [{ items: a.options.map((o) => ({ id: o, label: o, onSelect: () => { close(); createAutofillProperty(opts.collectionId, a.id as 'sum' | 'tr', o, view ?? opts.view, { afterPropId: opts.afterPropId, beforePropId: opts.beforePropId }); } })) }] }, { placement: 'right-start', parent: overlayIdOf(e.currentTarget) })}>
                <Icon name={a.icon} size={20} style={{ color: 'var(--lp-icon-secondary)' }} />
                <span className="nc-add-prop-ai-label">{a.label}</span>
                <span className="nc-badge gray">기본</span>
                <Icon name="arrowChevronSingleRightSmall" size={16} style={{ color: 'var(--lp-icon-secondary)', marginInlineStart: 'auto' }} />
              </div>
            ))}
          </div>
          <div className="nc-add-prop-section types-head with-divider">
            <div className="nc-add-prop-section-title">
              <span>유형 선택</span>
              <span role="button" className={`nc-add-prop-search-btn ${query !== null ? 'on' : ''}`} aria-label="유형 검색…" onClick={() => setQuery(query === null ? '' : null)}><Icon name="magnifyingGlassSmall" size={14} /></span>
            </div>
            {query !== null && (
              <div className="nc-add-prop-search"><input autoFocus placeholder="유형 검색…" value={query} onChange={(e) => { setQuery(e.target.value); setActive(0); }} onKeyDown={(e) => { if (e.key === 'Enter' && flat[Math.max(0, active)]) choose(flat[Math.max(0, active)] as PropertyType); if (e.key === 'Escape') { e.preventDefault(); setQuery(null); } }} /></div>
            )}
          </div>
          {sections.map((s, si) => (
            <div key={s.id} className={`nc-add-prop-group ${si ? 'with-divider' : 'first'}`} role="rowgroup">
              {chunk(s.types, 2).map((pair, ri) => (
                <div key={ri} role="row" className="nc-add-prop-row">
                  {pair.map((t) => {
                    const meta = propertyTypeMeta(t);
                    const idx = flat.indexOf(t);
                    return (
                      <div key={t} role="gridcell" className={`nc-add-prop-cell ${idx === active ? 'active' : ''}`} onMouseMove={() => setActive(idx)} onClick={() => choose(t)}>
                        <span className="nc-add-prop-cell-icon"><PropertyIcon prop={{ type: t }} size={16} /></span>
                        <span className="nc-add-prop-cell-label">{meta.label}</span>
                        <span role="button" className="nc-add-prop-help" data-tooltip={meta.tooltip} onClick={(e) => e.stopPropagation()}><Icon name="questionMarkCircleSmall" size={14} /></span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
          {!sections.length && <div className="nc-menu-empty">결과 없음</div>}
        </div>
      </div>
    </div>
  );
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** "+ Add property": name row over the new column slot + type picker card. */
export function openAddPropertyMenu(anchor: HTMLElement | DOMRect, opts: AddPropertyOptions): () => void {
  const r = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor;
  opts = { ...opts, anchor: opts.anchor ?? anchor };
  return openOverlay((close) => <AddPropertyMenu opts={opts} close={close} />, {
    anchor: new DOMRect(r.left - 11, r.top, r.width, 0), placement: 'bottom-start', offset: 0, className: 'nc-add-prop-overlay', onClose: opts.onClose,
  });
}

// ---------- button property config (Edit automation) ----------

/** Button property › Edit automation: the shared automation builder in button mode (features/database/automations). */
export function openButtonConfig(collectionId: string, propId: string) {
  void import('../automations/builder.tsx').then((m) => m.openButtonPropertyBuilder(collectionId, propId));
}

export { setGroupAggregation, defaultFilterOperator };
