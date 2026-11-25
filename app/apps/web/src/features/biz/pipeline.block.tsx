// 진행 중 영업 건 블록 (biz_pipeline): 본 영업 중 진행사항 '진행'·'장기관리', 영업개시일 최신순.
import { useState } from 'react';
import { registerBlock, type BlockProps } from '../editor/Block.tsx';
import { isolate } from './fields.tsx';
import { blockDate, shortDate, useSalesView } from './sales.ts';
import './biz.css';

const PAGE = 50;

function PipelineBlock({ block }: BlockProps) {
  const date = blockDate(block.format);
  const { data } = useSalesView(date);
  const [shown, setShown] = useState(PAGE);
  if (!date) return <div className="biz-block" contentEditable={false}><p className="biz-note">날짜가 없는 매출 블록입니다.</p></div>;
  const rows = data?.pipeline ?? [];
  const total = rows.reduce((a, r) => a + r.amount, 0);

  return (
    <div className="biz-block" contentEditable={false} data-biz="pipeline">
      <div className="biz-block-head">
        <h3>진행 중 영업 건 · {rows.length.toLocaleString('ko-KR')}건</h3>
        <span className="biz-note">공급가 합 {total.toLocaleString('ko-KR')}원{data?.basisDate ? ` · ${shortDate(data.basisDate)} 기준` : ''}</span>
      </div>
      {data && rows.length === 0 && <p className="biz-note">진행 중인 건이 없습니다.</p>}
      {rows.length > 0 && (
        <div className="biz-table-wrap">
          <table className="biz-table wide">
            <thead><tr><th>고객</th><th>제품</th><th className="num">공급가</th><th>확도</th><th>진행사항</th><th>영업대표</th><th>영업개시일</th></tr></thead>
            <tbody>
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
            </tbody>
          </table>
        </div>
      )}
      {rows.length > shown && <button {...isolate} type="button" className="biz-link" onClick={() => setShown((n) => n + PAGE)}>더 보기 ({(rows.length - shown).toLocaleString('ko-KR')}건 남음)</button>}
    </div>
  );
}

registerBlock(['biz_pipeline'], PipelineBlock);
