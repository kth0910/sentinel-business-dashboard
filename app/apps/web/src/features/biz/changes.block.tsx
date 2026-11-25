// 변동사항 블록 (biz_changes): 전일 대비 바뀐 영업 건, '기존' 값 표시, 구분 변경과 관리(설계 5.4, 7.2).
import { useState } from 'react';
import type { FieldDiff } from '@nc/biz';
import { useUI } from '../../lib/store/ui.ts';
import { registerBlock, type BlockProps } from '../editor/Block.tsx';
import { arrow, biz, type StoredChange } from './api.ts';
import { CategoryManager } from './CategoryManager.tsx';
import { isolate } from './fields.tsx';
import { blockDate, refreshSales, shortDate, useSalesView } from './sales.ts';
import './biz.css';

const PAGE = 50;

const won = (v: unknown) => `${Number(v ?? 0).toLocaleString('ko-KR')}원`;

/** 바뀐 칸: 새 값은 파란색, 아래에 '기존 : 이전 값'. 안 바뀐 칸은 값만. */
function Cell({ c, field, value, fmt = (v) => (v === null || v === undefined || v === '' ? '-' : String(v)) }: {
  c: StoredChange; field: FieldDiff['field']; value: unknown; fmt?: (v: unknown) => string;
}) {
  const d = c.after ? c.diffs.find((x) => x.field === field) : undefined;
  return (
    <>
      <span className={d ? 'chg' : undefined}>{fmt(value)}</span>
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

  const rows = data?.changes ?? [];
  return (
    <div className="biz-block" contentEditable={false} data-biz="changes">
      <div className="biz-block-head">
        <h3>변동사항{data?.prevDate && data.hasSnapshot ? ` · ${shortDate(data.prevDate)} 대비` : ''}</h3>
        <span className="biz-row">
          {!readOnly && data && <button {...isolate} type="button" className="biz-btn" onClick={() => setManaging((v) => !v)}>구분 관리</button>}
        </span>
      </div>
      {managing && data && <CategoryManager categories={data.categories} onClose={() => setManaging(false)} />}
      {error && <p className="biz-note">{error}</p>}
      {data && !data.hasSnapshot && <p className="biz-note">이 날짜의 매출 데이터가 없습니다.</p>}
      {data?.baseline && <p className="biz-note">기준 데이터 — 다음 날부터 변동이 표시됩니다.</p>}
      {data?.hasSnapshot && !data.baseline && rows.length === 0 && <p className="biz-note">전일 대비 변동이 없습니다.</p>}
      {rows.length > 0 && (
        <div className="biz-table-wrap">
          <table className="biz-table wide biz-changes">
            <thead>
              <tr><th>고객명</th><th>구분</th><th>제품</th><th className="num">순매출</th><th className="num">증감액</th><th>확도</th><th>가중치</th><th>매출 구분</th><th>매출일정</th></tr>
            </thead>
            <tbody>
              {rows.slice(0, shown).map((c) => {
                const r = c.after ?? c.before!;
                return (
                  <tr key={c.key}>
                    <td className="wrap">{r.customer}</td>
                    <td>
                      {readOnly
                        ? data!.categories.find((x) => x.id === c.categoryId)?.label
                        : (
                          <select {...isolate} className="biz-select" aria-label={`${r.customer} 구분`} value={c.categoryId} onChange={(e) => void setCategory(c, e.target.value)}>
                            {data!.categories.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                          </select>
                        )}
                    </td>
                    <td className="wrap">{r.product}{r.isCloud && <span className="biz-tag auto biz-ml">클라우드</span>}</td>
                    <td className="num">{c.after ? <Cell c={c} field="amount" value={c.after.amount} fmt={won} /> : <><span>삭제됨</span><span className="old">기존 : {won(c.before?.amount)}</span></>}</td>
                    <td className={`num biz-delta ${c.delta > 0 ? 'up' : c.delta < 0 ? 'down' : ''}`}>{c.delta ? `${won(Math.abs(Math.round(c.delta)))}${arrow(c.delta)}` : '-'}</td>
                    <td><Cell c={c} field="probability" value={r.probability} /></td>
                    <td><Cell c={c} field="weight" value={r.weight} /></td>
                    <td><Cell c={c} field="revenueType" value={r.revenueType} /></td>
                    <td><Cell c={c} field="revenueDate" value={r.revenueDate} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > shown && <button {...isolate} type="button" className="biz-link" onClick={() => setShown((n) => n + PAGE)}>더 보기 ({(rows.length - shown).toLocaleString('ko-KR')}건 남음)</button>}
    </div>
  );
}

registerBlock(['biz_changes'], ChangesBlock);
