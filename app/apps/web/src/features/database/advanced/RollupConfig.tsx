
// Calculate › (Show original, Show unique values, Count ›, Percent ›, More options › / Date ›), Number format,
// Decimal places and Show as (Number / Bar / Ring) for numeric results.
import type { PropertySchema } from '@nc/shared/records.ts';
import {
  AGGREGATION_BUCKETS, AGGREGATION_LABEL, AGGREGATIONS_BY_TYPE, aggregationValueType, aggregatorName, type Aggregator, type AggregationSpec,
} from '@nc/shared/relation/index.ts';
import { NUMBER_FORMATS } from '@nc/shared/formula/index.ts';
import { openOverlay, type Anchor } from '../../../components/overlay.tsx';
import { openMenu, type MenuItemDef } from '../../../components/Menu.tsx';
import { useCollection, useTableVersion } from '../../../lib/hooks.ts';
import { getCollection } from './context.ts';
import { propertyIconFor } from './formulaComplete.ts';
import { updateRollup } from './relations.ts';
import { ConfigRow, ShowAsPicker } from './ui.tsx';
import './advanced.css';

export const NUMBER_FORMAT_LABEL: Record<string, string> = {
  number: '숫자', number_with_commas: '쉼표 있는 숫자', percent: '퍼센트', dollar: '미국 달러', australian_dollar: '호주 달러',
  canadian_dollar: '캐나다 달러', singapore_dollar: '싱가포르 달러', euro: '유로', pound: '파운드', yen: '엔', ruble: '루블', rupee: '루피',
  won: '원', yuan: '위안', real: '헤알', lira: '리라', rupiah: '루피아', franc: '프랑', hong_kong_dollar: '홍콩 달러',
  new_zealand_dollar: '뉴질랜드 달러', krona: '스웨덴 크로나', norwegian_krone: '노르웨이 크로네', mexican_peso: '멕시코 페소', rand: '랜드',
  new_taiwan_dollar: '대만 달러', danish_krone: '덴마크 크로네', zloty: 'Złoty', baht: '바트', forint: '포린트', koruna: '코루나',
  shekel: '셰켈', chilean_peso: '칠레 페소', philippine_peso: '필리핀 페소', dirham: '디르함', colombian_peso: '콜롬비아 페소',
  riyal: '리얄', ringgit: '링깃', leu: '레우', argentine_peso: '아르헨티나 페소', uruguayan_peso: '우루과이 페소', peruvian_sol: '페루 솔',
  vietnamese_dong: '베트남 동', pakistani_rupee: '파키스탄 루피', nigerian_naira: '나이지리아 나이라', bitcoin: '비트코인',
};

export const PRECISIONS: { id: string; label: string }[] = [
  { id: 'precision_uncapped', label: '기본' }, { id: 'precision_0', label: '1' }, { id: 'precision_1', label: '1.0' }, { id: 'precision_2', label: '1.00' },
  { id: 'precision_3', label: '1.000' }, { id: 'precision_4', label: '1.0000' }, { id: 'precision_5', label: '1.00000' },
];

const NUMERIC_RESULT = new Set<Aggregator>(['count', 'count_values', 'unique', 'empty', 'not_empty', 'percent_empty', 'percent_not_empty', 'sum', 'average', 'median', 'min', 'max', 'range', 'checked', 'unchecked', 'percent_checked', 'percent_unchecked', 'count_per_group', 'percent_per_group']);

export function aggregationLabel(spec: AggregationSpec | undefined): string {
  const a = aggregatorName(spec);
  if (typeof spec === 'object') return `${AGGREGATION_LABEL[a]} (${spec.groupName})`;
  return AGGREGATION_LABEL[a] ?? '원본 표시';
}


export function calculateMenu(targetType: string | undefined, current: AggregationSpec | undefined, onPick: (spec: AggregationSpec) => void, statusGroups?: string[]): MenuItemDef[] {
  const valueType = aggregationValueType(targetType);
  const allowed = new Set<Aggregator>(['show_original', ...(AGGREGATIONS_BY_TYPE[valueType] ?? AGGREGATIONS_BY_TYPE.text)]);
  const cur = aggregatorName(current);
  const item = (a: Aggregator): MenuItemDef => ({ id: a, label: AGGREGATION_LABEL[a], checked: cur === a && typeof current !== 'object', onSelect: () => onPick(a) });
  const bucket = (label: string, list: Aggregator[]): MenuItemDef | null => {
    const items = list.filter((a) => allowed.has(a) && a !== 'count_per_group' && a !== 'percent_per_group').map(item);
    const perGroup = list.find((a) => (a === 'count_per_group' || a === 'percent_per_group') && allowed.has(a));
    if (perGroup && statusGroups?.length) {
      items.push({
        id: perGroup, label: AGGREGATION_LABEL[perGroup],
        submenu: () => ({ sections: [{ items: statusGroups.map((g) => ({ label: g, checked: typeof current === 'object' && current.operator === perGroup && current.groupName === g, onSelect: () => onPick({ operator: perGroup as 'count_per_group', groupName: g }) })) }] }),
      });
    }
    if (!items.length) return null;
    return { id: label, label, submenu: () => ({ width: 250, sections: [{ items }] }) };
  };
  const out: MenuItemDef[] = [item('show_original')];
  if (allowed.has('show_unique')) out.push(item('show_unique'));
  for (const b of [bucket('개수', AGGREGATION_BUCKETS.count), bucket('퍼센트', AGGREGATION_BUCKETS.percent), bucket('더 보기', AGGREGATION_BUCKETS.more), bucket('날짜', AGGREGATION_BUCKETS.date)]) if (b) out.push(b);
  return out;
}

function parentOf(el: Element | null): number | undefined {
  const o = el?.closest('[data-overlay-id]') as HTMLElement | null;
  return o ? Number(o.dataset.overlayId) : undefined;
}


export function RollupConfigBody({ collectionId, propertyId }: { collectionId: string; propertyId: string }) {
  useTableVersion(['collection']);
  const col = useCollection(collectionId);
  const ps = col?.schema[propertyId];
  if (!col || !ps) return null;
  const relId = ps.relation_property as string | undefined;
  const rel = relId ? col.schema[relId] : undefined;
  const target = getCollection(rel?.collection_id as string | undefined);
  const targetPropId = ps.target_property as string | undefined;
  const tps: PropertySchema | undefined = targetPropId ? target?.schema[targetPropId] : undefined;
  const spec = ps.aggregation as AggregationSpec | undefined;
  const agg = aggregatorName(spec);
  const numeric = NUMERIC_RESULT.has(agg) || (agg === 'show_original' && tps?.type === 'number');
  const relations = Object.entries(col.schema).filter(([, p]) => p.type === 'relation');
  const set = (patch: Partial<PropertySchema>) => updateRollup(collectionId, propertyId, patch);
  const showAs = (ps.show_as as { type?: string } | undefined)?.type ?? 'number';
  const menu = (e: React.MouseEvent<HTMLDivElement>, def: Parameters<typeof openMenu>[1]) => openMenu(e.currentTarget, def, { placement: 'right-start', parent: parentOf(e.currentTarget) });
  return (
    <div className="nc-menu-section nc-adv-config" data-menu-keys="ignore">
      <ConfigRow icon="relation" label="관계형" value={rel?.name ?? '선택'} onClick={(e) => menu(e, {
        width: 280,
        sections: [{ items: relations.length ? relations.map(([id, p]) => ({ label: p.name, icon: 'relation', checked: id === relId, onSelect: () => set({ relation_property: id, target_property: 'title', target_property_type: 'title', aggregation: 'show_original' }) })) : [{ label: '이 데이터 소스에 관계형이 없습니다', disabled: true }] }],
      })} />
      <ConfigRow icon="rollup" label="속성" value={tps?.name ?? (targetPropId === 'title' && target ? target.schema.title?.name ?? '이름' : '선택')} disabled={!rel} tooltip={rel ? undefined : '먼저 관계형을 선택하세요.'} onClick={(e) => target && menu(e, {
        width: 280, search: '필드 찾기…',
        
        sections: [{ items: Object.entries(target.schema).map(([id, p]) => ({ label: p.name, icon: propertyIconFor(p.type), checked: id === targetPropId, disabled: p.type === 'rollup' && id !== targetPropId, onSelect: () => set({ target_property: id, target_property_type: p.type, aggregation: 'show_original' }) })) }],
      })} />
      <ConfigRow icon="formula" label="계산" value={aggregationLabel(spec)} disabled={!rel || !targetPropId} tooltip={rel && targetPropId ? undefined : '관계형 속성과 필드를 먼저 선택하세요.'} onClick={(e) => menu(e, {
        width: 200,
        sections: [{ items: calculateMenu(tps?.type ?? (targetPropId === 'title' ? 'title' : undefined), spec, (s) => set({ aggregation: s as unknown as string }), tps?.type === 'status' ? (tps.groups ?? []).map((g) => g.name) : undefined) }],
      })} />
      {numeric && (
        <>
          <ConfigRow icon={<span style={{ width: 20 }} />} label="숫자 형식" value={NUMBER_FORMAT_LABEL[(ps.number_format as string) ?? 'number'] ?? '숫자'} onClick={(e) => menu(e, {
            width: 250, search: '검색',
            sections: [{ items: NUMBER_FORMATS.map((f) => ({ label: NUMBER_FORMAT_LABEL[f] ?? f, checked: ((ps.number_format as string) ?? 'number') === f, onSelect: () => set({ number_format: f }) })) }],
          })} />
          <ConfigRow icon={<span style={{ width: 20 }} />} label="소수점 자릿수" value={PRECISIONS.find((p) => p.id === ((ps.number_precision as string) ?? 'precision_uncapped'))?.label ?? '기본값'} onClick={(e) => menu(e, {
            width: 200,
            sections: [{ items: PRECISIONS.map((p) => ({ label: p.label, checked: ((ps.number_precision as string) ?? 'precision_uncapped') === p.id, onSelect: () => set({ number_precision: p.id }) })) }],
          })} />
          <div className="nc-menu-section-title" style={{ marginTop: 10 }}>표시 방식</div>
          <ShowAsPicker value={showAs} onChange={(v) => set({ show_as: v === 'number' ? undefined : { type: v, color: 'green', maxValue: agg.startsWith('percent') ? 1 : 100, showValue: true } })} />
          <div className="nc-rollup-hint">이 속성을 표시하는 모든 보기에 변경 사항이 적용됩니다.</div>
        </>
      )}
    </div>
  );
}

function RollupPanel({ collectionId, propertyId, close }: { collectionId: string; propertyId: string; close: () => void }) {
  return (
    <div className="nc-rel-panel" style={{ width: 300 }} role="dialog" aria-label="롤업">
      <RollupConfigBody collectionId={collectionId} propertyId={propertyId} />
      <div className="nc-rel-foot">
        <ConfigRow icon="check" label="완료" chevron={false} onClick={close} />
      </div>
    </div>
  );
}


export function openRollupConfig(anchor: Anchor | null | undefined, opts: { collectionId: string; propertyId: string; onClose?: () => void }): () => void {
  return openOverlay((close) => <RollupPanel collectionId={opts.collectionId} propertyId={opts.propertyId} close={close} />, {
    anchor: anchor ?? undefined, placement: anchor ? 'right-start' : 'center', backdrop: 'transparent', onClose: opts.onClose,
  });
}
