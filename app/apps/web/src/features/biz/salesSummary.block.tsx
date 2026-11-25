// 매출 요약 블록 (biz_sales_summary): 당일 증감액, 연·분기·월 실적과 목표, 엑셀 업로드(설계 5.4).
import { useEffect, useState } from 'react';
import type { Targets } from '@nc/biz';
import { useUI } from '../../lib/store/ui.ts';
import { registerBlock, type BlockProps } from '../editor/Block.tsx';
import { arrow, biz, signed, won } from './api.ts';
import { ExcelUpload } from './ExcelUpload.tsx';
import { isolate } from './fields.tsx';
import { blockDate, refreshSales, shortDate, useSalesView } from './sales.ts';
import './biz.css';

const rate = (actual: number, target: number) => (target > 0 ? `${Math.round((actual / target) * 100)}%` : '목표 미설정');

function TargetsEditor({ year, onDone }: { year: number; onDone: () => void }) {
  const [t, setT] = useState<Targets | null>(null);
  useEffect(() => { void biz.getTargets(year).then((r) => setT(r.targets)); }, [year]);
  if (!t) return <p className="biz-note">불러오는 중…</p>;
  const num = (v: string) => Math.max(0, Number(v.replace(/[^\d]/g, '')) || 0);
  const field = (label: string, value: number, set: (n: number) => void) => (
    <label className="biz-target-field">
      <span className="biz-note">{label}</span>
      <input {...isolate} className="biz-input biz-num" inputMode="numeric" value={value ? value.toLocaleString('ko-KR') : ''} placeholder="0" onChange={(e) => set(num(e.target.value))} />
    </label>
  );
  const save = async () => {
    try {
      await biz.setTargets(t);
      refreshSales();
      onDone();
    } catch (e: any) {
      useUI.getState().toast(e?.message ?? '저장하지 못했습니다');
    }
  };
  return (
    <div className="biz-targets">
      <div className="biz-target-grid">
        {field(`${year}년 연간 목표`, t.annual, (n) => setT({ ...t, annual: n }))}
        {t.quarters.map((q, i) => field(`${i + 1}분기 목표`, q, (n) => setT({ ...t, quarters: t.quarters.map((x, j) => (j === i ? n : x)) as Targets['quarters'] })))}
        {t.months.map((m, i) => field(`${i + 1}월 목표`, m, (n) => setT({ ...t, months: t.months.map((x, j) => (j === i ? n : x)) })))}
      </div>
      <div className="biz-row">
        <button {...isolate} type="button" className="biz-btn biz-btn-primary" onClick={() => void save()}>목표 저장</button>
        <button {...isolate} type="button" className="biz-btn" onClick={onDone}>취소</button>
      </div>
    </div>
  );
}

function SalesSummaryBlock({ block, readOnly }: BlockProps) {
  const date = blockDate(block.format);
  const { data, error } = useSalesView(date);
  const [editTargets, setEditTargets] = useState(false);
  if (!date) return <div className="biz-block" contentEditable={false}><p className="biz-note">날짜가 없는 매출 블록입니다. 날짜별 매출 페이지에서 사용하세요.</p></div>;

  const s = data?.summary;
  const card = (label: string, actual: number, target: number) => (
    <div className="biz-kpi">
      <span className="biz-note">{label}</span>
      <b>{won(actual)}</b>
      <span className="biz-note">{target > 0 ? `목표 ${won(target)} · 달성 ${rate(actual, target)}` : '목표 미설정'}</span>
    </div>
  );

  return (
    <div className="biz-block" contentEditable={false} data-biz="sales-summary">
      <div className="biz-block-head">
        <h3>{s ? `${s.year}년 본영업 매출` : '본영업 매출'}</h3>
        <span className="biz-row">
          <span className="biz-tag auto">자동 계산 · 확도 '확정' 기준</span>
          {!readOnly && <ExcelUpload date={date} />}
        </span>
      </div>
      {error && <p className="biz-note">{error}</p>}
      {data && !data.hasSnapshot && (
        <p className="biz-note">
          {shortDate(date)} 엑셀 미반영{data.basisDate ? ` · ${shortDate(data.basisDate)} 데이터로 표시` : ' · 엑셀을 올리면 매출이 표시됩니다'}
        </p>
      )}
      {data && s && (
        <>
          <div className="biz-today">
            <span className="biz-note">당일 증감액</span>
            <b className={`biz-delta ${data.dayDelta > 0 ? 'up' : data.dayDelta < 0 ? 'down' : ''}`}>{data.hasSnapshot ? `${signed(data.dayDelta)}원 ${arrow(data.dayDelta)}` : '—'}</b>
            <span className="biz-note">
              {data.baseline ? '기준 데이터 — 다음 업로드부터 비교' : data.prevDate ? `변동 ${data.changes.length}건 · ${shortDate(data.prevDate)} 대비` : ''}
            </span>
          </div>
          <div className="biz-kpis">
            {card(`${s.year}년 실적`, s.annualActual, s.annualTarget)}
            {card(`${s.quarter}분기 실적`, s.quarterActual, s.quarterTarget)}
            {card(`${s.month}월 실적`, s.monthActual, s.monthTarget)}
          </div>
          {!readOnly && !editTargets && <button {...isolate} type="button" className="biz-link" onClick={() => setEditTargets(true)}>목표 설정</button>}
          {editTargets && <TargetsEditor year={s.year} onDone={() => setEditTargets(false)} />}
        </>
      )}
    </div>
  );
}

registerBlock(['biz_sales_summary'], SalesSummaryBlock);
