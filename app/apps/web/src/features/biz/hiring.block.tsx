// 채용 현황 블록 (biz_hiring): 직접 입력, 다음 날짜 페이지가 이 내용을 이어받는다(설계 5.2).
// 현황은 직군별 지원자 수(숫자)만 넣고, 지원자는 그 합계를 자동으로 보여 준다(직접 입력 불가).
import { useEffect } from 'react';
import { registerBlock, type BlockProps } from '../editor/Block.tsx';
import { bizData, Field, isolate, updateBiz } from './fields.tsx';
import { applicantTotal, isLegacyRow, normalizeRow, splitStatus, type HiringRow } from './hiringCount.ts';
import { addRow, keyed, patchRow, removeRow } from './listEdit.ts';
import { BizBlock, BizTable, FilterNote, useFilteredRows, type ColDef } from './table.tsx';
import './biz.css';

/** applicants는 rows 현황의 합계를 저장해 둔 값(다른 곳에서 읽을 수 있게). 화면은 항상 rows로 다시 계산한다. */
interface Hiring { sites: string; rows: HiringRow[]; applicants: number | null }

const COLS: ColDef[] = [
  { key: 'role', label: '직군', width: 170, value: (r: HiringRow) => r.role },
  { key: 'status', label: '현황', width: 120, num: true, value: (r: HiringRow) => splitStatus(r.status).count },
  { key: 'note', label: '비고', width: 260, value: (r: HiringRow) => r.note },
];
const DELETE_COL: ColDef = { key: 'delete', label: '', width: 56 };

const EMPTY: Hiring = { sites: '', rows: [], applicants: null };

/** 저장할 때마다 현황을 숫자로 맞추고 지원자 합계를 다시 계산한다 */
const normalize = (d: Hiring): Hiring => {
  const rows = (d.rows ?? []).map(normalizeRow);
  return { ...d, rows, applicants: applicantTotal(rows) };
};

const toCount = (v: string): number => Math.max(0, Math.round(Number(v.replace(/,/g, ''))) || 0);

function HiringBlock({ block, readOnly }: BlockProps) {
  const data = bizData<Hiring>(block, EMPTY);
  const allRows = keyed((data.rows ?? []).map(normalizeRow));
  const rows = useFilteredRows(block, allRows, COLS);
  const total = applicantTotal(allRows);
  const update = (change: (d: Hiring) => Partial<Hiring>) => updateBiz<Hiring>(block.id, EMPTY, (d) => {
    const base = normalize(d);
    return normalize({ ...base, ...change(base) });
  });
  const save = (patch: Partial<Hiring>) => update(() => patch);
  const setRow = (id: string, patch: Partial<HiringRow>) => update((d) => ({ rows: patchRow(d.rows, id, patch) }));

  // 예전 글자 현황("해당자 3명 · 전화면접 예정")이 남아 있으면 한 번 숫자로 바꿔 저장한다(남는 글자는 비고로)
  const legacy = (data.rows ?? []).some(isLegacyRow) || (data.rows?.length ? data.applicants !== applicantTotal(data.rows) : false);
  useEffect(() => {
    if (!readOnly && legacy) update(() => ({}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legacy, readOnly, block.id]);

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
                <td className="num">
                  <Field
                    ariaLabel={`${i + 1}행 현황(지원자 수)`} type="number" className="biz-num" placeholder="0" readOnly={readOnly}
                    value={String(splitStatus(r.status).count)} onCommit={(v) => setRow(r.id, { status: toCount(v) })}
                  />
                </td>
                <td><Field ariaLabel={`${i + 1}행 비고`} value={r.note} readOnly={readOnly} onCommit={(v) => setRow(r.id, { note: v })} /></td>
                {!readOnly && <td><button {...isolate} type="button" className="biz-link" aria-label={`${i + 1}행 삭제`} onClick={() => update((d) => ({ rows: removeRow(d.rows, r.id) }))}>삭제</button></td>}
              </tr>
            ))}
      </BizTable>
      <div className="biz-row">
        {!readOnly && <button {...isolate} type="button" className="biz-link" onClick={() => update((d) => ({ rows: addRow(d.rows, { role: '', status: 0, note: '' }) }))}>+ 직군 추가</button>}
        <span className="biz-row biz-push" title="직군별 현황을 더한 값입니다">
          <span className="biz-note">지원자</span>
          <b className="biz-applicants" aria-label={`지원자 ${total}명(현황 합계)`}>{total.toLocaleString('ko-KR')}</b>
          <span className="biz-note">명</span>
        </span>
      </div>
    </BizBlock>
  );
}

registerBlock(['biz_hiring'], HiringBlock);
