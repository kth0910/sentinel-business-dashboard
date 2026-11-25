// 변동사항 블록 (biz_changes): 전일 대비 바뀐 영업 건, '기존' 값 표시, 구분 변경과 관리(설계 5.4, 7.2).
import { useState } from 'react';
import type { Category, EditableField, FieldDiff } from '@nc/biz';
import { EditCell } from './editCell.tsx';
import { useUI } from '../../lib/store/ui.ts';
import { registerBlock, type BlockProps } from '../editor/Block.tsx';
import { arrow, biz, type StoredChange } from './api.ts';
import { CategoryManager } from './CategoryManager.tsx';
import { isolate } from './fields.tsx';
import { blockDate, refreshSales, shortDate, useSalesView } from './sales.ts';
import { BizBlock, BizTable, FilterNote, useFilteredRows, type ColDef } from './table.tsx';
import './biz.css';

const PAGE = 50;

const rowOf = (c: StoredChange) => c.after ?? c.before!;

/** 열 정의(필터 값 포함). 구분은 이름으로 거른다. */
function colsFor(categories: Category[]): ColDef[] {
  const label = (id: string) => categories.find((x) => x.id === id)?.label ?? id;
  return [
    { key: 'customer', label: '고객명', width: 150, value: (c: StoredChange) => rowOf(c).customer },
    { key: 'category', label: '구분', width: 150, value: (c: StoredChange) => label(c.categoryId) },
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

/** 바뀐 칸: 새 값은 파란색, 아래에 '기존 : 이전 값'. 안 바뀐 칸은 값만. */
/** 값 칸: 전일 대비 바뀌었으면 파란색 + '기존', 직접 고칠 수 있음(삭제된 건은 제외). */
function Cell({ c, date, field, readOnly, fmt = (v) => (v === null || v === undefined || v === '' ? '-' : String(v)), extra }: {
  c: StoredChange; date: string; field: EditableField; readOnly?: boolean; fmt?: (v: unknown) => string; extra?: React.ReactNode;
}) {
  const d = c.after ? c.diffs.find((x) => x.field === (field as FieldDiff['field'])) : undefined;
  const r = c.after ?? c.before!;
  return (
    <>
      <span className={d ? 'chg' : undefined}>
        {c.after
          ? <EditCell date={date} row={c.after} field={field} readOnly={readOnly} fmt={fmt}>{fmt((c.after as any)[field])}{extra}</EditCell>
          : <>{fmt((r as any)[field])}{extra}</>}
      </span>
      {d && <span className="old">기존 : {fmt(d.before)}</span>}
    </>
  );
}

function ChangesBlock({ block, readOnly }: BlockProps) {
  const date = blockDate(block.format);
  const { data, error } = useSalesView(date);
  const [managing, setManaging] = useState(false);
  const [shown, setShown] = useState(PAGE);
  if (!date) return <div className="biz-block" contentEditable={false}><p className="biz-note">날짜가 없는 매출 블록입니다.</p></div>;

  const setCategory = async (c: StoredChange, categoryId: string) => {
    try {
      await biz.setChangeCategory(date, c.key, categoryId);
      refreshSales();
    } catch (e: any) {
      useUI.getState().toast(e?.message ?? '구분을 바꾸지 못했습니다');
    }
  };

  const all = data?.changes ?? [];
  const cols = colsFor(data?.categories ?? []);
  const rows = useFilteredRows(block, all, cols);
  return (
    <BizBlock block={block} readOnly={readOnly} biz="changes">
      <div className="biz-block-head">
        <h3>변동사항{data?.prevDate && data.hasSnapshot ? ` · ${shortDate(data.prevDate)} 대비` : ''}</h3>
        <span className="biz-row">
          <FilterNote block={block} readOnly={readOnly} shown={rows.length} total={all.length} />
          {!readOnly && data && <button {...isolate} type="button" className="biz-btn" onClick={() => setManaging((v) => !v)}>구분 관리</button>}
        </span>
      </div>
      {managing && data && <CategoryManager categories={data.categories} onClose={() => setManaging(false)} />}
      {error && <p className="biz-note">{error}</p>}
      {data && !data.hasSnapshot && <p className="biz-note">이 날짜의 매출 데이터가 없습니다.</p>}
      {data?.baseline && <p className="biz-note">기준 데이터 — 다음 날부터 변동이 표시됩니다.</p>}
      {data?.hasSnapshot && !data.baseline && all.length === 0 && <p className="biz-note">전일 대비 변동이 없습니다.</p>}
      {all.length > 0 && (
        <BizTable block={block} cols={cols} readOnly={readOnly} className="biz-changes" filterRows={all}>
              {rows.slice(0, shown).map((c) => {
                const r = c.after ?? c.before!;
                return (
                  <tr key={c.key}>
                    <td className="wrap"><Cell c={c} date={date} field="customer" readOnly={readOnly} /></td>
                    <td>
                      {readOnly
                        ? data!.categories.find((x) => x.id === c.categoryId)?.label
                        : (
                          <select {...isolate} className="biz-select" aria-label={`${r.customer} 구분`} value={c.categoryId} onChange={(e) => void setCategory(c, e.target.value)}>
                            {data!.categories.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                          </select>
                        )}
                    </td>
                    <td className="wrap"><Cell c={c} date={date} field="product" readOnly={readOnly} extra={r.isCloud && <span className="biz-tag auto biz-ml">클라우드</span>} /></td>
                    <td className="num">{c.after ? <Cell c={c} date={date} field="amount" readOnly={readOnly} fmt={won} /> : <><span>삭제됨</span><span className="old">기존 : {won(c.before?.amount)}</span></>}</td>
                    <td className={`num biz-delta ${c.delta > 0 ? 'up' : c.delta < 0 ? 'down' : ''}`}>{c.delta ? `${won(Math.abs(Math.round(c.delta)))}${arrow(c.delta)}` : '-'}</td>
                    <td><Cell c={c} date={date} field="probability" readOnly={readOnly} /></td>
                    <td><Cell c={c} date={date} field="weight" readOnly={readOnly} /></td>
                    <td><Cell c={c} date={date} field="revenueType" readOnly={readOnly} /></td>
                    <td><Cell c={c} date={date} field="revenueDate" readOnly={readOnly} /></td>
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
