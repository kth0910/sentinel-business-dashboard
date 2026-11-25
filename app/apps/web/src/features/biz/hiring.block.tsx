// 채용 현황 블록 (biz_hiring): 직접 입력, 다음 날짜 페이지가 이 내용을 이어받는다(설계 5.2).
import { registerBlock, type BlockProps } from '../editor/Block.tsx';
import { bizData, Field, isolate, saveBiz } from './fields.tsx';
import './biz.css';

interface HiringRow { role: string; status: string; note: string }
interface Hiring { sites: string; rows: HiringRow[]; applicants: number | null }

const EMPTY: Hiring = { sites: '', rows: [], applicants: null };

function HiringBlock({ block, readOnly }: BlockProps) {
  const data = bizData<Hiring>(block, EMPTY);
  const save = (patch: Partial<Hiring>) => saveBiz(block, { ...data, ...patch });
  const setRow = (i: number, patch: Partial<HiringRow>) => save({ rows: data.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  return (
    <div className="biz-block" contentEditable={false} data-biz="hiring">
      <div className="biz-block-head">
        <h3>채용 현황</h3>
        <span className="biz-tag hand">직접 입력 · 전일 내용 반영</span>
      </div>
      <div className="biz-row">
        <span className="biz-note">구인 사이트</span>
        <Field ariaLabel="구인 사이트" value={data.sites} readOnly={readOnly} placeholder="예: saramin.co.kr, jobkorea.co.kr" onCommit={(v) => save({ sites: v })} />
      </div>
      <div className="biz-table-wrap">
        <table className="biz-table">
          <thead><tr><th style={{ width: '28%' }}>직군</th><th style={{ width: '32%' }}>현황</th><th>비고</th>{!readOnly && <th aria-label="행 삭제" />}</tr></thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={i}>
                <td><Field ariaLabel={`${i + 1}행 직군`} value={r.role} readOnly={readOnly} onCommit={(v) => setRow(i, { role: v })} /></td>
                <td><Field ariaLabel={`${i + 1}행 현황`} value={r.status} readOnly={readOnly} onCommit={(v) => setRow(i, { status: v })} /></td>
                <td><Field ariaLabel={`${i + 1}행 비고`} value={r.note} readOnly={readOnly} onCommit={(v) => setRow(i, { note: v })} /></td>
                {!readOnly && <td><button {...isolate} type="button" className="biz-link" aria-label={`${i + 1}행 삭제`} onClick={() => save({ rows: data.rows.filter((_, j) => j !== i) })}>삭제</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="biz-row">
        {!readOnly && <button {...isolate} type="button" className="biz-link" onClick={() => save({ rows: [...data.rows, { role: '', status: '해당자 없음', note: '' }] })}>+ 직군 추가</button>}
        <span className="biz-row biz-push">
          <span className="biz-note">지원자</span>
          <Field
            ariaLabel="지원자 수" type="number" className="biz-narrow" placeholder="0" readOnly={readOnly}
            value={data.applicants === null ? '' : String(data.applicants)}
            onCommit={(v) => save({ applicants: v.trim() === '' ? null : Math.max(0, Math.round(Number(v)) || 0) })}
          />
          <span className="biz-note">명</span>
        </span>
      </div>
    </div>
  );
}

registerBlock(['biz_hiring'], HiringBlock);
