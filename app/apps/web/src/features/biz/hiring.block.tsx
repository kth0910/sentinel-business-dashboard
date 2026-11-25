// 채용 현황 블록 (biz_hiring): 직접 입력, 다음 날짜 페이지가 이 내용을 이어받는다(설계 5.2).
import { registerBlock, type BlockProps } from '../editor/Block.tsx';
import { bizData, Field, isolate, updateBiz } from './fields.tsx';
import { addRow, keyed, patchRow, removeRow } from './listEdit.ts';
import { BizBlock, BizTable, FilterNote, useFilteredRows, type ColDef } from './table.tsx';
import './biz.css';

interface HiringRow { id?: string; role: string; status: string; note: string }
interface Hiring { sites: string; rows: HiringRow[]; applicants: number | null }

const COLS: ColDef[] = [
  { key: 'role', label: '직군', width: 170, value: (r: HiringRow) => r.role },
  { key: 'status', label: '현황', width: 200, value: (r: HiringRow) => r.status },
  { key: 'note', label: '비고', width: 260, value: (r: HiringRow) => r.note },
];
const DELETE_COL: ColDef = { key: 'delete', label: '', width: 56 };

const EMPTY: Hiring = { sites: '', rows: [], applicants: null };

function HiringBlock({ block, readOnly }: BlockProps) {
  const data = bizData<Hiring>(block, EMPTY);
  const allRows = keyed(data.rows);
  const rows = useFilteredRows(block, allRows, COLS);
  const update = (change: (d: Hiring) => Partial<Hiring>) => updateBiz<Hiring>(block.id, EMPTY, (d) => ({ ...d, ...change(d) }));
  const save = (patch: Partial<Hiring>) => update(() => patch);
  const setRow = (id: string, patch: Partial<HiringRow>) => update((d) => ({ rows: patchRow(d.rows, id, patch) }));

  return (
    <BizBlock block={block} readOnly={readOnly} biz="hiring">
      <div className="biz-block-head">
        <h3>채용 현황</h3>
        <FilterNote block={block} readOnly={readOnly} shown={rows.length} total={allRows.length} />
      </div>
      <div className="biz-row">
        <span className="biz-note">구인 사이트</span>
        <Field ariaLabel="구인 사이트" value={data.sites} readOnly={readOnly} placeholder="예: saramin.co.kr, jobkorea.co.kr" onCommit={(v) => save({ sites: v })} />
      </div>
      <BizTable block={block} cols={readOnly ? COLS : [...COLS, DELETE_COL]} readOnly={readOnly} filterRows={allRows}>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td><Field ariaLabel={`${i + 1}행 직군`} value={r.role} readOnly={readOnly} onCommit={(v) => setRow(r.id, { role: v })} /></td>
                <td><Field ariaLabel={`${i + 1}행 현황`} value={r.status} readOnly={readOnly} onCommit={(v) => setRow(r.id, { status: v })} /></td>
                <td><Field ariaLabel={`${i + 1}행 비고`} value={r.note} readOnly={readOnly} onCommit={(v) => setRow(r.id, { note: v })} /></td>
                {!readOnly && <td><button {...isolate} type="button" className="biz-link" aria-label={`${i + 1}행 삭제`} onClick={() => update((d) => ({ rows: removeRow(d.rows, r.id) }))}>삭제</button></td>}
              </tr>
            ))}
      </BizTable>
      <div className="biz-row">
        {!readOnly && <button {...isolate} type="button" className="biz-link" onClick={() => update((d) => ({ rows: addRow(d.rows, { role: '', status: '해당자 없음', note: '' }) }))}>+ 직군 추가</button>}
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
    </BizBlock>
  );
}

registerBlock(['biz_hiring'], HiringBlock);
