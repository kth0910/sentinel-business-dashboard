// 변동사항 블록 (biz_changes): 전일 대비 바뀐 영업 건, '기존' 값 표시, 구분 변경과 관리(설계 5.4, 7.2).
import { useState } from 'react';
import type { FieldDiff } from '@nc/biz';
import { useUI } from '../../lib/store/ui.ts';
import { registerBlock, type BlockProps } from '../editor/Block.tsx';
import { arrow, biz, signed, type StoredChange } from './api.ts';
import { CategoryManager } from './CategoryManager.tsx';
import { isolate } from './fields.tsx';
import { blockDate, refreshSales, shortDate, useSalesView } from './sales.ts';
import './biz.css';

const PAGE = 50;

function before(c: StoredChange, field: FieldDiff['field']) {
  const d = c.diffs.find((x) => x.field === field);
  if (!d) return null;
  const v = field === 'amount' ? Number(d.before ?? 0).toLocaleString('ko-KR') : d.before || '없음';
  return <span className="old">기존 {v}</span>;
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
      {data && !data.hasSnapshot && <p className="biz-note">이 날짜에 올린 엑셀이 없습니다.</p>}
      {data?.baseline && <p className="biz-note">기준 데이터 — 다음 업로드부터 변동이 표시됩니다.</p>}
      {data?.hasSnapshot && !data.baseline && rows.length === 0 && <p className="biz-note">전일 대비 변동이 없습니다.</p>}
      {rows.length > 0 && (
        <div className="biz-table-wrap">
          <table className="biz-table wide">
            <thead>
              <tr><th>고객</th><th>구분</th><th>제품</th><th className="num">공급가</th><th className="num">증감액</th><th>확도</th><th>진행사항</th><th>영업대표</th></tr>
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
                    <td className="num">{c.after ? c.after.amount.toLocaleString('ko-KR') : '삭제됨'}{before(c, 'amount')}</td>
                    <td className={`num biz-delta ${c.delta > 0 ? 'up' : c.delta < 0 ? 'down' : ''}`}>{c.delta ? `${signed(c.delta)} ${arrow(c.delta)}` : '—'}</td>
                    <td>{r.probability || '—'}{before(c, 'probability')}</td>
                    <td>{r.progress}{before(c, 'progress')}</td>
                    <td>{r.rep}</td>
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
