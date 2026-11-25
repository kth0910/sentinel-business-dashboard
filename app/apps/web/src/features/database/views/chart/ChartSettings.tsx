import { HELP_URL } from '@nc/shared/brand.ts';
// Chart view settings: chart type, X axis, Y axis, style, donut data, number, database, filters, and sharing.
import { useState, type ReactNode } from 'react';
import * as L from 'lucide-react';
import type { PropertySchema } from '@nc/shared/records.ts';
import { savedGroupsFrom, type GroupResult } from '@nc/shared/database/index.ts';
import { NUMBER_FORMATS } from '@nc/shared/formula/index.ts';
import { Icon, registerIcons } from '../../../../components/Icon.tsx';
import { openMenu, type MenuItemDef } from '../../../../components/Menu.tsx';
import { openOverlay, PopoverSurface } from '../../../../components/overlay.tsx';
import { useUI } from '../../../../lib/store/ui.ts';
import { PropertyIcon } from '../../properties/PropertyCell.tsx';
import { viewIcon, viewLink } from '../../chrome/ViewTabs.tsx';
import type { ViewSettingsMainProps } from '../../viewRegistry.ts';
import { NUMBER_FORMAT_LABEL, PRECISIONS, collectionName } from '../../advanced/index.ts';
import { SettingsRow, SettingsToggle, openNestedMenu, overlayParentOf, setFormat } from '../../advanced/viewKit.tsx';
import { makeQueryContext, useViewQuery } from '../../data.ts';
import { setSavedGroups } from '../../actions.ts';
import { GroupToken } from '../../chrome/Groups.tsx';
import { openChartExport } from './ChartExport.tsx';
import {
  AGG_LABEL, CHART_TYPE_LABEL, CHART_TYPE_ORDER, aggregationLabel, chartColorVar, chartConfigOf, chartGroupLists, chartSavedGroupsOf, groupByFor, isGroupableForChart, isNumericProperty, numberChartTitle, switchChartType,
  type ChartAggregation, type ChartColorTheme, type ChartConfig, type ChartFormat, type ChartGroupBy, type ChartHeight, type ChartType, type MainSort, type ReferenceLine,
} from './chartModel.ts';

registerIcons({
  ncChartXWhat: L.CornerDownRight, ncChartSort: L.ArrowLeftRight, ncChartYWhat: L.ArrowUp, ncChartGroup: L.Rows2, ncChartRange: L.MoveVertical,
  ncChartRefLines: L.Ellipsis, ncChartColor: L.Palette, ncChartStyle: L.Brush, ncChartTitle: L.CaseSensitive, ncChartCalc: L.Binary,
  ncChartHeight: L.MoveVertical, ncChartRangeH: L.MoveHorizontal, ncChartSlice: L.ChartPie,
});

const CHART_TYPE_ICON: Record<ChartType, string> = { column: 'chartBarXAxis', bar: 'chartBarYAxis', line: 'chartLine', donut: 'donutChart', number: 'number' };
const THEMES: { id: ChartColorTheme; label: string }[] = [
  { id: 'auto', label: '자동' }, { id: 'colorful', label: '다채로운 색' }, { id: 'gray', label: '무색' }, { id: 'blue', label: '파란색' }, { id: 'green', label: '초록색' },
  { id: 'orange', label: '주황색' }, { id: 'pink', label: '분홍색' }, { id: 'purple', label: '보라색' }, { id: 'red', label: '빨간색' }, { id: 'teal', label: '청록색' }, { id: 'yellow', label: '노란색' },
];
const HEIGHTS: { id: ChartHeight; label: string }[] = [{ id: 'small', label: '작게' }, { id: 'medium', label: '보통' }, { id: 'large', label: '크게' }, { id: 'extra_large', label: '매우 크게' }];
const NUMBER_COLORS = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
const REF_COLORS = ['gray', 'lightgray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
const NUMERIC_AGGS = ['sum', 'average', 'median', 'min', 'max', 'range'];
const DATE_KINDS = ['date', 'created_time', 'last_edited_time'];

function Section({ title, children, divider }: { title?: ReactNode; children: ReactNode; divider?: boolean }) {
  return (
    <div className={`nc-menu-section ${divider ? 'with-divider' : ''}`}>
      {title && <div className="nc-menu-section-title">{title}</div>}
      {children}
    </div>
  );
}

function sub(anchor: HTMLElement, items: MenuItemDef[], width = 250, search?: string) {
  return openNestedMenu(anchor, { width, search, sections: [{ items }] }, { placement: 'bottom-end', offset: 2 });
}

function Swatch({ color }: { color: string }) {
  return <span className="nc-chart-swatch" style={{ background: color }} />;
}

/** Calculations offered for a property in "Calculate" / "Choose what to display" submenus. */
export function aggregationsFor(p: PropertySchema | undefined): string[] {
  if (!p) return ['count'];
  if (isNumericProperty(p)) return [...NUMERIC_AGGS, 'count_values', 'unique'];
  if (p.type === 'checkbox') return ['checked', 'unchecked', 'percent_checked', 'percent_unchecked'];
  if (DATE_KINDS.includes(p.type)) return ['count_values', 'unique', 'empty', 'not_empty', 'earliest_date', 'latest_date'];
  return ['count_values', 'unique', 'empty', 'not_empty', 'percent_empty', 'percent_not_empty'];
}

function sortLabel(ms: MainSort | undefined, xProp: PropertySchema | undefined, yName: string): string {
  const name = xProp?.name ?? '';
  const date = !!xProp && DATE_KINDS.includes(xProp.type);
  const num = !!xProp && (xProp.type === 'number' || isNumericProperty(xProp));
  switch (ms ?? 'manual') {
    case 'x-ascending': return date ? '오래된 순 → 최신 순' : num ? `${name} 오름차순` : `${name} A → Z`;
    case 'x-descending': return date ? '최신 → 과거' : num ? `${name} 내림차순` : `${name} Z → A`;
    case 'y-ascending': return `${yName} 낮은 순`;
    case 'y-descending': return `${yName} 높음 → 낮음`;
    default: return '수동';
  }
}

/** Visible groups / Hidden groups with 👁 toggles. */
function GroupVisibility({ groups, ro, onToggle, onAll }: { groups: GroupResult[]; ro: boolean; onToggle: (g: GroupResult) => void; onAll: (hide: boolean) => void }) {
  if (!groups.length) return null;
  const shown = groups.filter((g) => !g.hidden);
  const hidden = groups.filter((g) => g.hidden);
  const row = (g: GroupResult) => (
    <div key={g.id} className="nc-menu-item nc-vis-row nc-chart-group-row" data-group-key={g.id}>
      <div className="nc-menu-item-inner">
        <div className="nc-menu-label"><GroupToken group={g} /></div>
        <span role="button" className={`nc-vis-eye ${ro ? 'disabled' : ''}`} aria-label={g.hidden ? '그룹 표시' : '그룹 숨기기'} onClick={() => !ro && onToggle(g)}><Icon name={g.hidden ? 'eyeSlash' : 'eye'} size={16} /></span>
      </div>
    </div>
  );
  const head = (label: string, action: string, hide: boolean) => (
    <div className="nc-chart-groups-head"><span>{label}</span>{!ro && <span role="button" className="nc-vs-section-action" onClick={() => onAll(hide)}>{action}</span>}</div>
  );
  return (
    <div className="nc-chart-groups" data-testid="chart-groups">
      {shown.length > 0 && head('표시된 그룹', '모두 숨기기', true)}
      {shown.map(row)}
      {hidden.length > 0 && head('숨긴 그룹', '모두 표시', false)}
      {hidden.map(row)}
    </div>
  );
}

export function ChartSettingsMain({ block, view, collection, readOnly, go }: ViewSettingsMainProps) {
  const schema = collection.schema;
  const cfg = chartConfigOf(view.format as Record<string, unknown> | undefined, schema);
  const fmt: ChartFormat = cfg.chartFormat ?? {};
  const ro = readOnly;
  const save = (next: ChartConfig, action = 'chartSettings.setChartConfig') => setFormat(view, { chart_config: next }, action);
  const setFmt = (patch: Partial<ChartFormat>) => save({ ...cfg, chartFormat: { ...fmt, ...patch } });
  const dc = cfg.dataConfig;
  const groups = dc.type === 'groups_reducer' ? dc : undefined;
  const xProp = groups ? schema[groups.groupBy.property] : undefined;
  const agg: ChartAggregation = dc.type === 'groups_reducer' || dc.type === 'number_reducer' ? dc.aggregationConfig.aggregation : { aggregator: 'count' };
  const yName = aggregationLabel(agg, schema);
  const stackGb = groups?.aggregationConfig.stackOptions?.groupBy;
  // groups of the X axis / slices and of the stacked "Group by", with their visibility
  const q = useViewQuery(collection, view);
  const saved = chartSavedGroupsOf(view.format as Record<string, unknown> | undefined);
  const lists = groups ? chartGroupLists(q.rows, cfg, schema, makeQueryContext(), saved) : { main: [], stack: [] };
  const toggleMain = (list: GroupResult[], hide: (g: GroupResult) => boolean) => {
    if (!groups) return;
    setSavedGroups(view, savedGroupsFrom(list.map((g) => ({ ...g, hidden: hide(g) })), groups.groupBy.property, saved.groups), { action: 'chartSettings.setGroupVisibility' });
  };
  const toggleStack = (list: GroupResult[], hide: (g: GroupResult) => boolean) => {
    if (!stackGb) return;
    setFormat(view, { chart_subgroups: savedGroupsFrom(list.map((g) => ({ ...g, hidden: hide(g) })), stackGb.property, saved.subgroups) }, 'chartSettings.setSubgroupVisibility');
  };
  const mainVisibility = (
    <GroupVisibility groups={lists.main} ro={ro} onToggle={(g) => toggleMain(lists.main, (x) => (x.id === g.id ? !x.hidden : !!x.hidden))} onAll={(hide) => toggleMain(lists.main, () => hide)} />
  );

  const setGroups = (patch: Partial<NonNullable<typeof groups>>) => {
    if (!groups) return;
    save({ ...cfg, dataConfig: { ...groups, ...patch } as ChartConfig['dataConfig'] });
  };
  const setAgg = (a: ChartAggregation) => {
    if (dc.type === 'groups_reducer') save({ ...cfg, dataConfig: { ...dc, aggregationConfig: { ...dc.aggregationConfig, aggregation: a } } });
    else if (dc.type === 'number_reducer') save({ ...cfg, dataConfig: { ...dc, aggregationConfig: { aggregation: a } } });
  };

  const groupablePropItems = (current: string | undefined, onPick: (id: string) => void, exclude?: string): MenuItemDef[] => {
    const ids = ['title', ...Object.keys(schema).filter((k) => k !== 'title')].filter((id) => schema[id] && id !== exclude && isGroupableForChart(schema[id]));
    return ids.map((id) => ({ id, label: schema[id].name, icon: <PropertyIcon prop={schema[id]} size={16} />, checked: id === current, onSelect: () => onPick(id) }));
  };

  const pickX = (e: React.MouseEvent<HTMLElement>) => sub(e.currentTarget, groupablePropItems(groups?.groupBy.property, (id) => {
    if (!groups) return;
    const gb: ChartGroupBy = groupByFor(id, schema, groups.groupBy.sort?.type === 'ascending' ? 'ascending' : 'manual');
    const stack = groups.aggregationConfig.stackOptions?.groupBy.property === id ? undefined : groups.aggregationConfig.stackOptions;
    setGroups({ groupBy: gb, aggregationConfig: { ...groups.aggregationConfig, stackOptions: stack } });
  }), 260, '속성 검색...');

  const yItems = (onPick: (a: ChartAggregation) => void, opts?: { none?: boolean }): MenuItemDef[] => {
    const out: MenuItemDef[] = [];
    if (opts?.none) out.push({ id: 'none', label: '없음', checked: !agg.property, onSelect: () => onPick({ aggregator: 'count' }) });
    else out.push({ id: 'count', label: '개수', icon: 'number', checked: !agg.property && agg.aggregator === 'count', onSelect: () => onPick({ aggregator: 'count' }) });
    const ids = ['title', ...Object.keys(schema).filter((k) => k !== 'title')].filter((id) => schema[id] && !['button'].includes(schema[id].type));
    for (const id of ids) {
      const p = schema[id];
      out.push({
        id, label: p.name, icon: <PropertyIcon prop={p} size={16} />, checked: agg.property === id,
        submenu: () => ({ width: 220, sections: [{ items: aggregationsFor(p).map((a) => ({ id: a, label: a === 'unique' ? '고유값' : AGG_LABEL[a] ?? a, checked: agg.property === id && agg.aggregator === a, onSelect: () => onPick({ aggregator: a, property: id }) })) }] }),
      });
    }
    return out;
  };

  const sortItems = (): MenuItemDef[] => {
    const cur = fmt.mainSort ?? 'manual';
    return (['manual', 'x-ascending', 'x-descending', 'y-ascending', 'y-descending'] as MainSort[]).map((m) => ({ id: m, label: sortLabel(m, xProp, yName), checked: cur === m, onSelect: () => setFmt({ mainSort: m }) }));
  };

  const colorRow = () => (
    <SettingsRow icon="ncChartColor" label="색상" value={THEMES.find((t) => t.id === (fmt.colorTheme ?? 'auto'))?.label} disabled={ro} onClick={(e) => sub(e.currentTarget, THEMES.map((t) => ({
      id: t.id, label: t.label, checked: (fmt.colorTheme ?? 'auto') === t.id, onSelect: () => setFmt({ colorTheme: t.id }),
      icon: t.id === 'auto' || t.id === 'colorful' ? <span className="nc-chart-swatch multi" /> : <Swatch color={chartColorVar(t.id === 'gray' ? 'gray' : t.id)} />,
    })))} />
  );

  const styleMenu = (e: React.MouseEvent<HTMLElement>) => {
    const items: MenuItemDef[] = [
      { id: 'height', label: '높이', right: <span className="nc-menu-value">{HEIGHTS.find((h) => h.id === (fmt.height ?? 'medium'))?.label}</span>, submenu: () => ({ width: 200, sections: [{ items: HEIGHTS.map((h) => ({ id: h.id, label: h.label, checked: (fmt.height ?? 'medium') === h.id, onSelect: () => setFmt({ height: h.id }) })) }] }) },
    ];
    if (cfg.type !== 'donut') {
      items.push(
        { id: 'grid', label: '눈금선', right: <span className="nc-menu-value">{({ none: '없음', horizontal: '가로', vertical: '세로', both: '둘 다' })[fmt.axisGridLine ?? 'horizontal']}</span>, submenu: () => ({ width: 200, sections: [{ items: (['none', 'horizontal', 'vertical', 'both'] as const).map((g) => ({ id: g, label: ({ none: '없음', horizontal: '가로', vertical: '세로', both: '둘 다' })[g], checked: (fmt.axisGridLine ?? 'horizontal') === g, onSelect: () => setFmt({ axisGridLine: g }) })) }] }) },
        { id: 'axisname', label: '축 이름', right: <span className="nc-menu-value">{({ none: '없음', x_axis: 'X축', y_axis: 'Y축', both: '둘 다' })[fmt.axisLabel ?? 'none']}</span>, submenu: () => ({ width: 200, sections: [{ items: (['none', 'x_axis', 'y_axis', 'both'] as const).map((g) => ({ id: g, label: ({ none: '없음', x_axis: 'X축', y_axis: 'Y축', both: '둘 다' })[g], checked: (fmt.axisLabel ?? 'none') === g, onSelect: () => setFmt({ axisLabel: g }) })) }] }) },
        { id: 'labels', label: '데이터 레이블', checked: fmt.axisShowDataLabels !== false, onSelect: () => setFmt({ axisShowDataLabels: fmt.axisShowDataLabels === false }) },
      );
      if (cfg.type === 'line') {
        items.push(
          { id: 'smooth', label: '곡선', checked: !!fmt.smoothLine, onSelect: () => setFmt({ smoothLine: !fmt.smoothLine }) },
          { id: 'fill', label: '그라데이션 영역', checked: !fmt.hideLineFillArea, onSelect: () => setFmt({ hideLineFillArea: !fmt.hideLineFillArea }) },
          { id: 'cumulative', label: '누적', checked: !!fmt.axisCumulative, onSelect: () => setFmt({ axisCumulative: !fmt.axisCumulative }) },
        );
      }
      if (stackGb) {
        items.push({ id: 'groupstyle', label: '그룹 스타일', right: <span className="nc-menu-value">{({ normal: '누적', side_by_side: '쌓지 않음', percent: '퍼센트' })[fmt.axisGroupStyle ?? 'normal']}</span>, submenu: () => ({ width: 200, sections: [{ items: (['normal', 'side_by_side', 'percent'] as const).map((g) => ({ id: g, label: ({ normal: '누적', side_by_side: '누적 안 함', percent: '퍼센트' })[g], checked: (fmt.axisGroupStyle ?? 'normal') === g, onSelect: () => setFmt({ axisGroupStyle: g }) })) }] }) });
      }
    } else {
      items.push(
        { id: 'donutlabels', label: '데이터 레이블', right: <span className="nc-menu-value">{({ none: '없음', value: 'Value (%)', name: 'Name', name_and_value: '라벨과 값(%)' })[fmt.donutDataLabels ?? 'value']}</span>, submenu: () => ({ width: 220, sections: [{ items: (['none', 'value', 'name', 'name_and_value'] as const).map((g) => ({ id: g, label: ({ none: '없음', value: 'Value (%)', name: 'Name', name_and_value: '레이블과 값 (%)' })[g], checked: (fmt.donutDataLabels ?? 'value') === g, onSelect: () => setFmt({ donutDataLabels: g }) })) }] }) },
        { id: 'showvalue', label: '값 표시', checked: !fmt.donutHideValue, onSelect: () => setFmt({ donutHideValue: !fmt.donutHideValue }) },
      );
    }
    // "Color by metric": bars / donut drawn in one color get darker with larger values
    const theme = fmt.colorTheme ?? 'auto';
    if ((cfg.type === 'donut' || ((cfg.type === 'column' || cfg.type === 'bar') && !stackGb)) && theme !== 'auto' && theme !== 'colorful') {
      items.push({ id: 'weight', label: '지표별 색상', checked: !!fmt.weightColorValue, onSelect: () => setFmt({ weightColorValue: !fmt.weightColorValue }) });
    }
    if (cfg.type === 'donut' || stackGb || cfg.type === 'line') {
      items.push({ id: 'legend', label: '범례', right: <span className="nc-menu-value">{fmt.hideLegend || fmt.legendPosition === 'off' ? '표시 안 함' : fmt.legendPosition === 'side' ? '옆' : '아래'}</span>, submenu: () => ({ width: 200, sections: [{ items: (['bottom', 'side', 'off'] as const).map((g) => ({ id: g, label: ({ bottom: '아래쪽', side: 'Side', off: '표시 안 함' })[g], checked: (fmt.hideLegend ? 'off' : fmt.legendPosition ?? 'bottom') === g, onSelect: () => setFmt({ legendPosition: g, hideLegend: g === 'off' }) })) }] }) });
    }
    sub(e.currentTarget, items, 260);
  };

  const rangeEditor = (e: React.MouseEvent<HTMLElement>) => openOverlay((close) => (
    <PopoverSurface width={260}>
      <RangeEditor min={fmt.yAxisMin} max={fmt.yAxisMax} onChange={(min, max) => setFmt({ yAxisMin: min, yAxisMax: max })} onReset={() => { setFmt({ yAxisMin: undefined, yAxisMax: undefined }); close(); }} />
    </PopoverSurface>
  ), { anchor: e.currentTarget, placement: 'bottom-end', parent: overlayParentOf(e.currentTarget) });

  const refEditor = (e: React.MouseEvent<HTMLElement>) => openOverlay(() => (
    <PopoverSurface width={320}>
      <RefLinesEditor lines={fmt.referenceLines ?? []} onChange={(lines) => setFmt({ referenceLines: lines.length ? lines : undefined })} />
    </PopoverSurface>
  ), { anchor: e.currentTarget, placement: 'bottom-end', parent: overlayParentOf(e.currentTarget) });

  const rangeValue = fmt.yAxisMin !== undefined || fmt.yAxisMax !== undefined ? '사용자 지정' : '자동';
  const refValue = (fmt.referenceLines ?? []).length === 1 ? '선 1개' : `선 ${(fmt.referenceLines ?? []).length}개`;
  const isBar = cfg.type === 'bar';

  const categoryRows = (
    <>
      <SettingsRow icon="ncChartXWhat" label="표시할 항목 선택" value={xProp?.name ?? '없음'} disabled={ro} onClick={pickX} />
      {xProp && DATE_KINDS.includes(xProp.type) && groups && (
        <SettingsRow icon="calendar" label="그룹 기준" value={({ day: '일', week: '주', month: '월', year: '연도', relative: '상대 날짜' } as Record<string, string>)[String(groups.groupBy.groupBy ?? 'month')] ?? '월'} disabled={ro} onClick={(e) => sub(e.currentTarget, (['day', 'week', 'month', 'year'] as const).map((g) => ({ id: g, label: g[0].toUpperCase() + g.slice(1), checked: (groups.groupBy.groupBy ?? 'month') === g, onSelect: () => setGroups({ groupBy: { ...groups.groupBy, groupBy: g } }) })))} />
      )}
      <SettingsRow icon="ncChartSort" label="정렬 기준" value={sortLabel(fmt.mainSort, xProp, yName)} disabled={ro} onClick={(e) => sub(e.currentTarget, sortItems(), 260)} />
      <SettingsToggle label={<span className="nc-chart-row-label"><Icon name="eyeOff" size={20} />0 값 숨기기</span>} on={!!fmt.axisHideEmptyGroups} disabled={ro} onChange={(v) => setFmt({ axisHideEmptyGroups: v })} />
      {mainVisibility}
    </>
  );
  const valueRows = (
    <>
      <SettingsRow icon="ncChartYWhat" label="표시할 항목 선택" value={yName} disabled={ro} onClick={(e) => sub(e.currentTarget, yItems(setAgg), 260, '속성 검색...')} />
      <SettingsRow icon="ncChartGroup" label="그룹 기준" value={stackGb ? schema[stackGb.property]?.name ?? '없음' : '없음'} disabled={ro || !groups} onClick={(e) => groups && sub(e.currentTarget, [
        { id: 'none', label: '없음', checked: !stackGb, onSelect: () => setGroups({ aggregationConfig: { ...groups.aggregationConfig, stackOptions: undefined } }) },
        ...groupablePropItems(stackGb?.property, (id) => {
          save({ ...cfg, chartFormat: { ...fmt, axisGroupStyle: fmt.axisGroupStyle ?? 'normal' }, dataConfig: { ...groups, aggregationConfig: { ...groups.aggregationConfig, stackOptions: { groupBy: groupByFor(id, schema) } } } });
        }, groups.groupBy.property),
      ], 260, '속성 검색...')} />
      {stackGb && <GroupVisibility groups={lists.stack} ro={ro} onToggle={(g) => toggleStack(lists.stack, (x) => (x.id === g.id ? !x.hidden : !!x.hidden))} onAll={(hide) => toggleStack(lists.stack, () => hide)} />}
      <SettingsRow icon={isBar ? 'ncChartRangeH' : 'ncChartRange'} label="범위" value={rangeValue} disabled={ro} onClick={rangeEditor} />
      <SettingsRow icon="ncChartRefLines" label="기준선" value={refValue} disabled={ro} onClick={refEditor} />
    </>
  );

  const exportChart = () => {
    const svg = document.querySelector(`[data-chart-view-id="${view.id}"] svg.nc-chart-svg`) as SVGSVGElement | null;
    if (!svg) return useUI.getState().toast('내보낼 항목이 없습니다');
    openChartExport(svg, view.name || 'chart');
  };

  return (
    <>
      <Section>
        <SettingsRow icon={viewIcon(view.type)} label="레이아웃" value="Chart" onClick={() => go('layout')} />
      </Section>
      <Section divider title="차트 유형">
        <div className="nc-chart-types" role="radiogroup" aria-label="차트 유형">
          {CHART_TYPE_ORDER.map((t) => (
            <div key={t} role="radio" aria-checked={cfg.type === t} aria-label={CHART_TYPE_LABEL[t]} data-tooltip={CHART_TYPE_LABEL[t]} className={`nc-chart-type ${cfg.type === t ? 'on' : ''} ${ro ? 'disabled' : ''}`} onClick={() => !ro && cfg.type !== t && save(switchChartType(cfg, t, schema))}>
              <Icon name={CHART_TYPE_ICON[t]} size={20} />
            </div>
          ))}
        </div>
      </Section>
      {cfg.type === 'number' ? (
        <>
          <Section>
            <SettingsToggle label={<span className="nc-chart-row-label"><Icon name="ncChartTitle" size={20} />차트 제목</span>} on={!fmt.hideTitle} disabled={ro} onChange={(v) => setFmt({ hideTitle: !v })} />
            {!fmt.hideTitle && <TitleInput value={fmt.valueLabel ?? ''} placeholder={numberChartTitle(agg, schema)} disabled={ro} onChange={(v) => save({ ...cfg, chartFormat: { ...fmt, valueLabel: v || undefined } }, 'chartSettings.setChartFormat.valueLabel')} />}
          </Section>
          <Section title="데이터">
            <SettingsRow icon="number" label="표시할 항목 선택" value={agg.property ? schema[agg.property]?.name ?? '없음' : '없음'} disabled={ro} onClick={(e) => sub(e.currentTarget, [
              { id: 'none', label: '없음', checked: !agg.property, onSelect: () => setAgg({ aggregator: 'count' }) },
              ...['title', ...Object.keys(schema).filter((k) => k !== 'title')].filter((id) => schema[id] && schema[id].type !== 'button').map((id) => ({
                id, label: schema[id].name, icon: <PropertyIcon prop={schema[id]} size={16} />, checked: agg.property === id,
                onSelect: () => setAgg({ aggregator: aggregationsFor(schema[id])[0], property: id }),
              })),
            ], 260, '속성 검색...')} />
            <SettingsRow icon="ncChartCalc" label="계산" value={!agg.property ? '전체 개수' : AGG_LABEL[String(agg.aggregator)] ?? String(agg.aggregator)} chevron={!!agg.property} disabled={ro || !agg.property} onClick={(e) => agg.property && sub(e.currentTarget, aggregationsFor(schema[agg.property]).map((a) => ({ id: a, label: a === 'unique' ? '고유 값' : AGG_LABEL[a] ?? a, checked: agg.aggregator === a, onSelect: () => setAgg({ aggregator: a, property: agg.property }) })))} />
            <SettingsRow icon="sliders" label="형식" value={fmt.numberFormatOverride ? NUMBER_FORMAT_LABEL[fmt.numberFormatOverride] ?? fmt.numberFormatOverride : '상속'} disabled={ro} onClick={(e) => sub(e.currentTarget, [
              { id: 'inherit', label: '상속', checked: !fmt.numberFormatOverride, onSelect: () => setFmt({ numberFormatOverride: undefined }) },
              {
                id: 'format', label: '숫자 형식', submenu: () => ({ width: 250, search: '형식 찾기…', sections: [{ items: NUMBER_FORMATS.map((f) => ({ id: f, label: NUMBER_FORMAT_LABEL[f] ?? f, checked: fmt.numberFormatOverride === f, onSelect: () => setFmt({ numberFormatOverride: f }) })) }] }),
              },
              {
                id: 'precision', label: '소수점 자릿수', submenu: () => ({ width: 200, sections: [{ items: PRECISIONS.map((p) => ({ id: p.id, label: p.label, checked: (fmt.numberPrecisionOverride ?? 'precision_uncapped') === p.id, onSelect: () => setFmt({ numberPrecisionOverride: p.id }) })) }] }),
              },
            ], 240)} />
          </Section>
          <Section title="스타일">
            <SettingsRow icon="ncChartColor" label="색상" value={fmt.numberColor ? fmt.numberColor[0].toUpperCase() + fmt.numberColor.slice(1) : '기본값'} disabled={ro} onClick={(e) => sub(e.currentTarget, NUMBER_COLORS.map((c) => ({ id: c, label: c === 'default' ? '기본' : c[0].toUpperCase() + c.slice(1), checked: (fmt.numberColor ?? 'default') === c, icon: <Swatch color={c === 'default' ? 'var(--lp-text-primary)' : c === 'gray' ? 'var(--lp-text-secondary)' : chartColorVar(c)} />, onSelect: () => setFmt({ numberColor: c === 'default' ? undefined : c }) })))} />
            <SettingsRow icon="ncChartHeight" label="높이" value={HEIGHTS.find((h) => h.id === (fmt.height ?? 'medium'))?.label} disabled={ro} onClick={(e) => sub(e.currentTarget, HEIGHTS.map((h) => ({ id: h.id, label: h.label, checked: (fmt.height ?? 'medium') === h.id, onSelect: () => setFmt({ height: h.id }) })))} />
          </Section>
        </>
      ) : cfg.type === 'donut' ? (
        <>
          <Section title="데이터">
            <SettingsRow icon="donutChart" label="표시할 항목 선택" value={xProp?.name ?? '없음'} disabled={ro} onClick={pickX} />
            <SettingsRow icon="ncChartSlice" label="조각 기준" value={yName} disabled={ro} onClick={(e) => sub(e.currentTarget, yItems(setAgg), 260, '속성 검색...')} />
            <SettingsRow icon="ncChartSort" label="정렬 기준" value={sortLabel(fmt.mainSort, xProp, yName)} disabled={ro} onClick={(e) => sub(e.currentTarget, sortItems(), 260)} />
            {mainVisibility}
          </Section>
          <Section title="스타일">
            {colorRow()}
            <SettingsRow icon="ncChartStyle" label="스타일 설정 더 보기" disabled={ro} onClick={styleMenu} />
          </Section>
        </>
      ) : (
        <>
          <Section title="X축">{isBar ? valueRows : categoryRows}</Section>
          <Section title="Y축">{isBar ? categoryRows : valueRows}</Section>
          <Section title="스타일">
            {colorRow()}
            <SettingsRow icon="ncChartStyle" label="스타일 설정 더 보기" disabled={ro} onClick={styleMenu} />
          </Section>
        </>
      )}
      <Section divider>
        <SettingsRow icon="databaseEmbed" label="데이터베이스" value={collectionName(collection)} chevron={false} />
        <SettingsRow icon="filter" label="필터" onClick={() => go('filter')} />
        <SettingsRow icon="archive" label="보관된 항목 표시" chevron={false} disabled />
      </Section>
      <Section divider>
        {cfg.type !== 'number' && (
          <SettingsRow icon="download" label="차트를 다음 형식으로 저장…" chevron={false} onClick={() => exportChart()} />
        )}
        <SettingsRow icon="link" label="레이아웃 링크 복사" chevron={false} onClick={() => { void navigator.clipboard?.writeText(viewLink(block, view.id)); useUI.getState().toast('보기 링크를 복사했습니다'); }} />
      </Section>
      <Section divider>
        {HELP_URL && <SettingsRow icon="questionMarkCircle" label="차트 알아보기" chevron={false} onClick={() => window.open(HELP_URL!, '_blank', 'noopener')} />}
      </Section>
    </>
  );
}

function TitleInput({ value, placeholder, disabled, onChange }: { value: string; placeholder: string; disabled: boolean; onChange: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <div className="nc-chart-title-input" data-menu-keys="ignore">
      <input className="nc-input-el" value={v} placeholder={placeholder} disabled={disabled} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onChange(v.trim())} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
    </div>
  );
}

function RangeEditor({ min, max, onChange, onReset }: { min?: number; max?: number; onChange: (min?: number, max?: number) => void; onReset: () => void }) {
  const [lo, setLo] = useState(min === undefined ? '' : String(min));
  const [hi, setHi] = useState(max === undefined ? '' : String(max));
  const commit = (l: string, h: string) => {
    const a = l.trim() === '' ? undefined : Number(l);
    const b = h.trim() === '' ? undefined : Number(h);
    onChange(Number.isFinite(a as number) ? a : undefined, Number.isFinite(b as number) ? b : undefined);
  };
  return (
    <div className="nc-chart-range" data-menu-keys="ignore">
      <div className="nc-menu-section-title">사용자 지정 기간 선택</div>
      <div className="nc-chart-range-row">
        <input className="nc-input-el" inputMode="decimal" placeholder="최소" value={lo} onChange={(e) => setLo(e.target.value)} onBlur={() => commit(lo, hi)} />
        <span>–</span>
        <input className="nc-input-el" inputMode="decimal" placeholder="최대" value={hi} onChange={(e) => setHi(e.target.value)} onBlur={() => commit(lo, hi)} />
      </div>
      <div role="button" className="nc-chart-range-reset" onClick={onReset}>초기화</div>
    </div>
  );
}

function RefLinesEditor({ lines, onChange }: { lines: ReferenceLine[]; onChange: (lines: ReferenceLine[]) => void }) {
  const [list, setList] = useState<ReferenceLine[]>(lines);
  const update = (next: ReferenceLine[]) => {
    setList(next);
    onChange(next);
  };
  return (
    <div className="nc-chart-refs" data-menu-keys="ignore">
      <div className="nc-menu-section-title">기준선</div>
      {!list.length && <div className="nc-chart-refs-empty">기준선은 차트에 목표와 임계값을 표시합니다.</div>}
      {list.map((r, i) => (
        <div key={r.id} className="nc-chart-ref">
          <input className="nc-input-el" style={{ width: 70 }} inputMode="decimal" placeholder="값" defaultValue={String(r.value)} onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) update(list.map((x, j) => (j === i ? { ...x, value: v } : x))); }} />
          <input className="nc-input-el" placeholder="레이블" defaultValue={r.label} onBlur={(e) => update(list.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          <div role="button" className="nc-chart-ref-color" aria-label="색상" onClick={(e) => openNestedMenu(e.currentTarget, { width: 180, sections: [{ items: REF_COLORS.map((c) => ({ id: c, label: c === 'gray' ? 'Black' : c[0].toUpperCase() + c.slice(1), icon: <Swatch color={chartColorVar(c)} />, checked: r.color === c, onSelect: () => update(list.map((x, j) => (j === i ? { ...x, color: c } : x))) })) }] })}><Swatch color={chartColorVar(r.color)} /></div>
          <div role="button" className="nc-chart-ref-style" onClick={() => update(list.map((x, j) => (j === i ? { ...x, dashStyle: x.dashStyle === 'Dash' ? 'Solid' : 'Dash' } : x)))}>{r.dashStyle === 'Dash' ? 'Dash' : 'Solid'}</div>
          <div role="button" className="nc-chart-ref-del" aria-label="삭제" onClick={() => update(list.filter((_, j) => j !== i))}><Icon name="trash" size={14} /></div>
        </div>
      ))}
      {list.length < 10 ? (
        <div role="button" className="nc-chart-ref-add" onClick={() => update([...list, { id: crypto.randomUUID(), value: 0, label: '', color: 'gray', dashStyle: 'Dash' }])}><Icon name="plus" size={14} />기준선 만들기</div>
      ) : <div className="nc-chart-refs-empty">이 차트에는 기준선을 최대 10개까지 추가할 수 있습니다</div>}
    </div>
  );
}

