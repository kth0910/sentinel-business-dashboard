// 진행 중 영업 건 블록 (biz_pipeline): 본 영업 중 진행사항 '진행'·'장기관리', 영업개시일 최신순. 행을 누르면 수정 창.
import { useState } from 'react';
import { registerBlock, type BlockProps } from '../editor/Block.tsx';
import { isolate } from './fields.tsx';
import { blockDate, shortDate, useSalesView } from './sales.ts';
import type { SalesView } from './api.ts';
import type { SalesRow } from '@nc/biz';
import { BizBlock, BizTable, FilterNote, useFilteredRows, type ColDef } from './table.tsx';
import { amountText, openRowProps, openSaleEditor, rowSpec, Shown } from './editDialog.tsx';
import './biz.css';

const PAGE = 50;

const COLS: ColDef[] = [
  { key: 'customer', label: '고객', width: 160, value: (r: SalesRow) => r.customer },
  { key: 'product', label: '제품', width: 190, value: (r: SalesRow) => r.product },
  { key: 'amount', label: '공급가', width: 130, num: true, value: (r: SalesRow) => r.amount },
  { key: 'probability', label: '확도', width: 80, value: (r: SalesRow) => r.probability },
  { key: 'progress', label: '진행사항', width: 90, value: (r: SalesRow) => r.progress },
  { key: 'rep', label: '영업대표', width: 90, value: (r: SalesRow) => r.rep },
  { key: 'startDate', label: '영업개시일', width: 110, value: (r: SalesRow) => r.startDate },
];

function openEditor(date: string, r: SalesRow, data: SalesView) {
  const o = data.options;
  openSaleEditor({
    title: '영업 건 수정', subtitle: `${r.customer} · ${r.product}`, date, saleKey: r.key, categories: data.categories,
    specs: [
      rowSpec(r, 'customer', '고객', 'text', o),
      rowSpec(r, 'product', '제품', 'option', o),
      rowSpec(r, 'amount', '공급가', 'number', o),
      rowSpec(r, 'probability', '확도', 'option', o),
      rowSpec(r, 'progress', '진행사항', 'option', o),
      rowSpec(r, 'rep', '영업대표', 'text', o),
      rowSpec(r, 'startDate', '영업개시일', 'date', o),
    ],
  });
}

function PipelineBlock({ block, readOnly }: BlockProps) {
  const date = blockDate(block.format);
  const { data } = useSalesView(date);
  const [shown, setShown] = useState(PAGE);
  if (!date) return <div className="biz-block" contentEditable={false}><p className="biz-note">날짜가 없는 매출 블록입니다.</p></div>;
  const all = data?.pipeline ?? [];
  const rows = useFilteredRows(block, all, COLS);
  const total = rows.reduce((a, r) => a + r.amount, 0);

  return (
    <BizBlock block={block} readOnly={readOnly} biz="pipeline">
      <div className="biz-block-head">
        <h3>진행 중 영업 건 · {all.length.toLocaleString('ko-KR')}건</h3>
        <span className="biz-row">
          <FilterNote block={block} readOnly={readOnly} shown={rows.length} total={all.length} />
          <span className="biz-note">공급가 합 {total.toLocaleString('ko-KR')}원{data?.basisDate ? ` · ${shortDate(data.basisDate)} 기준` : ''}</span>
        </span>
      </div>
      {data && all.length === 0 && <p className="biz-note">진행 중인 건이 없습니다.</p>}
      {data && all.length > 0 && (
        <BizTable block={block} cols={COLS} readOnly={readOnly} filterRows={all}>
              {rows.slice(0, shown).map((r) => (
                <tr key={r.key} {...openRowProps(readOnly, () => openEditor(date, r, data))}>
                  <td className="wrap"><Shown row={r} field="customer" /></td>
                  <td className="wrap"><Shown row={r} field="product" />{r.isCloud && <span className="biz-tag auto biz-ml">클라우드</span>}</td>
                  <td className="num"><Shown row={r} field="amount" fmt={amountText} /></td>
                  <td><Shown row={r} field="probability" /></td>
                  <td><Shown row={r} field="progress" /></td>
                  <td><Shown row={r} field="rep" /></td>
                  <td><Shown row={r} field="startDate" /></td>
                </tr>
              ))}
        </BizTable>
      )}
      {rows.length > shown && <button {...isolate} type="button" className="biz-link" onClick={() => setShown((n) => n + PAGE)}>더 보기 ({(rows.length - shown).toLocaleString('ko-KR')}건 남음)</button>}
    </BizBlock>
  );
}

registerBlock(['biz_pipeline'], PipelineBlock);
