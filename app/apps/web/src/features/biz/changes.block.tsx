// 변동사항 블록 (biz_changes): 전일 대비 바뀐 영업 건, '기존' 값 표시(설계 5.4, 7.2).
// 행을 누르면 수정 창(editDialog.tsx): 고객명·구분·제품·순매출·증감액·확도·가중치·매출 구분·매출일정.
// '+ 행 추가'로 직접 적은 행을 넣는다(매출 데이터가 없는 날에도). 당일 증감액은 표 증감액의 합.
import { useState } from 'react';
import type { Category, FieldDiff, SalesRow } from '@nc/biz';
import { registerBlock, type BlockProps } from '../editor/Block.tsx';
import { arrow, biz, type SalesView, type StoredChange } from './api.ts';
import { amountText, openRowProps, openSaleEditor, rowSpec, Shown, type EditSpec } from './editDialog.tsx';
import { isolate } from './fields.tsx';
import { blockDate, shortDate, useSalesView } from './sales.ts';
import { BizBlock, BizTable, FilterNote, useFilteredRows, type ColDef } from './table.tsx';
import './biz.css';

const PAGE = 50;

const rowOf = (c: StoredChange) => c.after ?? c.before!;
const catLabel = (categories: Category[], id: string) => categories.find((x) => x.id === id)?.label ?? id;

/** 열 정의(필터 값 포함). 구분은 이름으로 거른다. */
function colsFor(categories: Category[]): ColDef[] {
  return [
    { key: 'customer', label: '고객명', width: 150, value: (c: StoredChange) => rowOf(c).customer },
    { key: 'category', label: '구분', width: 150, value: (c: StoredChange) => catLabel(categories, c.categoryId) },
    { key: 'product', label: '제품', width: 170, value: (c: StoredChange) => rowOf(c).product },
    { key: 'amount', label: '순매출', width: 140, num: true, value: (c: StoredChange) => c.after?.amount ?? null },
    { key: 'delta', label: '증감액', width: 140, num: true, value: (c: StoredChange) => c.delta },
    { key: 'probability', label: '확도', width: 100, value: (c: StoredChange) => rowOf(c).probability },
    { key: 'weight', label: '가중치', width: 130, value: (c: StoredChange) => rowOf(c).weight },
    { key: 'revenueType', label: '매출 구분', width: 100, value: (c: StoredChange) => rowOf(c).revenueType },
    { key: 'revenueDate', label: '매출일정', width: 120, value: (c: StoredChange) => rowOf(c).revenueDate },
  ];
}

const won = (v: unknown) => `${Number(v ?? 0).toLocaleString('ko-KR')}원`;
const dash = (v: unknown) => (v === null || v === undefined || v === '' ? '-' : String(v));

/** 값 칸: 전일 대비 바뀌었으면 파란색 + 아래에 '기존 : 이전 값'. 직접 고친 값은 점선 밑줄. */
function Cell({ c, field, fmt = dash, extra }: { c: StoredChange; field: FieldDiff['field'] | 'customer' | 'product'; fmt?: (v: unknown) => string; extra?: React.ReactNode }) {
  const d = c.after ? c.diffs.find((x) => x.field === field) : undefined;
  const r: SalesRow = rowOf(c);
  return (
    <>
      <span className={d ? 'chg' : undefined}><Shown row={r} field={field} fmt={fmt} />{extra}</span>
      {d && <span className="old">기존 : {fmt(d.before)}</span>}
    </>
  );
}

function specsFor(r: SalesRow, c: { categoryId: string; delta: number; autoDelta?: number }, data: SalesView, gone: boolean, blank = false): EditSpec[] {
  const o = data.options;
  return [
    rowSpec(r, 'customer', '고객명', 'text', o, gone),
    {
      field: 'category', label: '구분', kind: 'category', value: catLabel(data.categories, c.categoryId),
      choices: data.categories.map((x) => ({ value: x.label, id: x.id, removable: !x.system, editable: !x.system })),
    },
    rowSpec(r, 'product', '제품', 'option', o, gone),
    rowSpec(r, 'amount', '순매출', 'number', o, gone),
    { field: 'delta', label: '증감액', kind: 'delta', value: blank ? '' : amountText(c.delta), original: c.autoDelta !== undefined ? amountText(c.autoDelta) : undefined },
    rowSpec(r, 'probability', '확도', 'option', o, gone),
    rowSpec(r, 'weight', '가중치', 'option', o, gone),
    rowSpec(r, 'revenueType', '매출 구분', 'option', o, gone),
    rowSpec(r, 'revenueDate', '매출일정', 'date', o, gone),
  ];
}

function openEditor(date: string, c: StoredChange, data: SalesView) {
  const r = rowOf(c);
  const gone = !c.after;
  openSaleEditor({
    title: '변동 건 수정', subtitle: [r.customer, r.product].filter(Boolean).join(' · '), date, saleKey: c.key,
    specs: specsFor(r, c, data, gone), categories: data.categories,
    note: gone ? '오늘 데이터에서 빠진 건이라 구분과 증감액만 고칠 수 있습니다.' : '증감액은 본영업 매출의 당일 증감액에 바로 반영됩니다.',
    remove: {
      confirm: c.entry ? '이 행을 지울까요?' : '이 변동을 표에서 지울까요?\n받아온 데이터에서 나온 변동이라 데이터를 다시 받아도 표시되지 않고, 당일 증감액에서도 빠집니다.',
      run: () => biz.deleteChange(date, c.key),
    },
  });
}

/** 빈 행 */
const BLANK: SalesRow = {
  key: '', code: 0, product: '', division: '본 영업', rep: '', customer: '', contractor: '', amount: 0, progress: '',
  contractDate: null, startDate: null, probability: '', isCloud: false, weight: '', revenueType: '', revenueDate: null,
};

function openNew(date: string, data: SalesView) {
  const specs = specsFor(BLANK, { categoryId: 'unclassified', delta: 0 }, data, false, true).map((s) => (s.field === 'amount' ? { ...s, value: '' } : s));
  openSaleEditor({
    title: '변동 건 추가', date, saleKey: '', specs, categories: data.categories, create: true,
    note: '증감액은 본영업 매출의 당일 증감액에 바로 반영됩니다.',
    submit: (edit) => biz.addChange(date, edit),
  });
}

function ChangesBlock({ block, readOnly }: BlockProps) {
  const date = blockDate(block.format);
  const { data, error } = useSalesView(date);
  const [shown, setShown] = useState(PAGE);
  if (!date) return <div className="biz-block" contentEditable={false}><p className="biz-note">날짜가 없는 매출 블록입니다.</p></div>;

  const all = data?.changes ?? [];
  const cols = colsFor(data?.categories ?? []);
  const rows = useFilteredRows(block, all, cols);
  return (
    <BizBlock block={block} readOnly={readOnly} biz="changes">
      <div className="biz-block-head">
        <h3>변동사항{data?.prevDate && data.hasSnapshot ? ` · ${shortDate(data.prevDate)} 대비` : ''}</h3>
        <span className="biz-row">
          <FilterNote block={block} readOnly={readOnly} shown={rows.length} total={all.length} />
          {!readOnly && data && <button {...isolate} type="button" className="biz-btn" onClick={() => openNew(date, data)}>+ 행 추가</button>}
        </span>
      </div>
      {error && <p className="biz-note">{error}</p>}
      {data?.baseline && all.length === 0 && <p className="biz-note">기준 데이터 — 다음 날부터 변동이 표시됩니다.</p>}
      {data && !data.baseline && all.length === 0 && <p className="biz-note">변동사항이 없습니다.{readOnly ? '' : " '+ 행 추가'로 직접 적을 수 있습니다."}</p>}
      {data && all.length > 0 && (
        <BizTable block={block} cols={cols} readOnly={readOnly} className="biz-changes" filterRows={all}>
              {rows.slice(0, shown).map((c) => {
                const r = rowOf(c);
                return (
                  <tr key={c.key} {...openRowProps(readOnly, () => openEditor(date, c, data))}>
                    <td className="wrap"><Cell c={c} field="customer" /></td>
                    <td>{catLabel(data.categories, c.categoryId)}</td>
                    <td className="wrap"><Cell c={c} field="product" extra={r.isCloud && <span className="biz-tag auto biz-ml">클라우드</span>} /></td>
                    <td className="num">{c.after ? <Cell c={c} field="amount" fmt={won} /> : <><span>삭제됨</span><span className="old">기존 : {won(c.before?.amount)}</span></>}</td>
                    <td className={`num biz-delta ${c.delta > 0 ? 'up' : c.delta < 0 ? 'down' : ''}`}>
                      <span className={c.autoDelta !== undefined ? 'biz-edited' : undefined} title={c.autoDelta !== undefined ? `직접 입력함 · 계산값: ${won(c.autoDelta)}` : undefined}>
                        {c.delta ? `${won(Math.abs(Math.round(c.delta)))}${arrow(c.delta)}` : '-'}
                      </span>
                    </td>
                    <td><Cell c={c} field="probability" /></td>
                    <td><Cell c={c} field="weight" /></td>
                    <td><Cell c={c} field="revenueType" /></td>
                    <td><Cell c={c} field="revenueDate" /></td>
                  </tr>
                );
              })}
        </BizTable>
      )}
      {rows.length > shown && <button {...isolate} type="button" className="biz-link" onClick={() => setShown((n) => n + PAGE)}>더 보기 ({(rows.length - shown).toLocaleString('ko-KR')}건 남음)</button>}
    </BizBlock>
  );
}

registerBlock(['biz_changes'], ChangesBlock);
