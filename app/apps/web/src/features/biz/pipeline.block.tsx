// 진행 중 영업 건 블록 (biz_pipeline): 본 영업 중 진행사항 '진행'·'장기관리', 영업개시일 최신순.
import { useState } from 'react';
import { registerBlock, type BlockProps } from '../editor/Block.tsx';
import { isolate } from './fields.tsx';
import { blockDate, shortDate, useSalesView } from './sales.ts';
import { BizBlock, BizTable, type ColDef } from './table.tsx';
import './biz.css';

const PAGE = 50;

const COLS: ColDef[] = [
  { key: 'customer', label: '고객', width: 160 }, { key: 'product', label: '제품', width: 190 }, { key: 'amount', label: '공급가', width: 130, num: true },
  { key: 'probability', label: '확도', width: 80 }, { key: 'progress', label: '진행사항', width: 90 }, { key: 'rep', label: '영업대표', width: 90 },
  { key: 'startDate', label: '영업개시일', width: 110 },
];

function PipelineBlock({ block, readOnly }: BlockProps) {
  const date = blockDate(block.format);
  const { data } = useSalesView(date);
  const [shown, setShown] = useState(PAGE);
  if (!date) return <div className="biz-block" contentEditable={false}><p className="biz-note">날짜가 없는 매출 블록입니다.</p></div>;
  const rows = data?.pipeline ?? [];
  const total = rows.reduce((a, r) => a + r.amount, 0);

  return (
    <BizBlock block={block} readOnly={readOnly} biz="pipeline">
      <div className="biz-block-head">
        <h3>진행 중 영업 건 · {rows.length.toLocaleString('ko-KR')}건</h3>
        <span className="biz-row">
          <span className="biz-note">공급가 합 {total.toLocaleString('ko-KR')}원{data?.basisDate ? ` · ${shortDate(data.basisDate)} 기준` : ''}</span>
        </span>
      </div>
      {data && rows.length === 0 && <p className="biz-note">진행 중인 건이 없습니다.</p>}
      {rows.length > 0 && (
        <BizTable block={block} cols={COLS} readOnly={readOnly}>
              {rows.slice(0, shown).map((r) => (
                <tr key={r.key}>
                  <td className="wrap">{r.customer}</td>
                  <td className="wrap">{r.product}{r.isCloud && <span className="biz-tag auto biz-ml">클라우드</span>}</td>
                  <td className="num">{r.amount.toLocaleString('ko-KR')}</td>
                  <td>{r.probability || '—'}</td>
                  <td>{r.progress}</td>
                  <td>{r.rep}</td>
                  <td>{r.startDate ?? '—'}</td>
                </tr>
              ))}
        </BizTable>
      )}
      {rows.length > shown && <button {...isolate} type="button" className="biz-link" onClick={() => setShown((n) => n + PAGE)}>더 보기 ({(rows.length - shown).toLocaleString('ko-KR')}건 남음)</button>}
    </BizBlock>
  );
}

registerBlock(['biz_pipeline'], PipelineBlock);
