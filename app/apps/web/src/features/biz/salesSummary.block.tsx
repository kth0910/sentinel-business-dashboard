// 매출 요약 블록 (biz_sales_summary): 당일 증감액, 연·분기·월 실적과 목표(설계 5.4).
// 당일 증감액 = 변동사항 표 증감액의 합. 실적은 받아온 데이터로 계산하거나 '실적 입력'으로 직접 넣는다.
import { useEffect, useState } from 'react';
import type { ActualPeriod, Summary, Targets } from '@nc/biz';
import { useUI } from '../../lib/store/ui.ts';
import { registerBlock, type BlockProps } from '../editor/Block.tsx';
import { arrow, biz, signed, won } from './api.ts';
import { isolate } from './fields.tsx';
import { blockDate, refreshSales, shortDate, useSalesView } from './sales.ts';
import { parseAmount } from './saleEdit.ts';
import './biz.css';
import { BizBlock } from './table.tsx';

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

/** 실적 직접 입력: 넣은 값은 이 날짜부터 같은 기간(연·분기·월)이 끝날 때까지 유지된다. */
function ActualsEditor({ date, s, onDone }: { date: string; s: Summary; onDone: () => void }) {
  const periods: [ActualPeriod, string, number][] = [
    ['annual', `${s.year}년 실적`, s.annualActual], ['quarter', `${s.quarter}분기 실적`, s.quarterActual], ['month', `${s.month}월 실적`, s.monthActual],
  ];
  const initial = Object.fromEntries(periods.map(([p, , v]) => [p, v.toLocaleString('ko-KR')])) as Record<ActualPeriod, string>;
  const [vals, setVals] = useState(initial);
  const [reset, setReset] = useState<Partial<Record<ActualPeriod, boolean>>>({});
  const save = async () => {
    try {
      for (const [p, label] of periods) {
        if (reset[p]) { await biz.setActual(date, p, null); continue; }
        if (vals[p].trim() === initial[p]) continue;
        const n = parseAmount(vals[p]);
        if (n === null) throw new Error(`${label}은 0 이상의 숫자로 넣으세요`);
        await biz.setActual(date, p, n);
      }
      refreshSales();
      onDone();
    } catch (e: any) {
      useUI.getState().toast(e?.message ?? '저장하지 못했습니다');
    }
  };
  return (
    <div className="biz-targets">
      <p className="biz-note">넣은 실적은 이 날짜부터 그 기간(연·분기·월)이 끝날 때까지 유지됩니다.</p>
      <div className="biz-target-grid">
        {periods.map(([p, label]) => {
          const computed = s.edited?.[p];
          return (
            <label key={p} className="biz-target-field">
              <span className="biz-note">{label}</span>
              <input {...isolate} className="biz-input biz-num" inputMode="numeric" value={vals[p]} placeholder="0"
                onChange={(e) => { setVals({ ...vals, [p]: e.target.value }); setReset({ ...reset, [p]: false }); }} />
              {computed !== undefined && !reset[p] && (
                <span className="biz-form-hint">
                  계산값 {won(computed)}
                  <button {...isolate} type="button" className="biz-link" onClick={() => { setReset({ ...reset, [p]: true }); setVals({ ...vals, [p]: computed.toLocaleString('ko-KR') }); }}>계산값으로</button>
                </span>
              )}
              {reset[p] && <span className="biz-form-hint">저장하면 계산값으로 돌아갑니다</span>}
            </label>
          );
        })}
      </div>
      <div className="biz-row">
        <button {...isolate} type="button" className="biz-btn biz-btn-primary" onClick={() => void save()}>실적 저장</button>
        <button {...isolate} type="button" className="biz-btn" onClick={onDone}>취소</button>
      </div>
    </div>
  );
}

function SalesSummaryBlock({ block, readOnly }: BlockProps) {
  const date = blockDate(block.format);
  const { data, error } = useSalesView(date);
  const [editTargets, setEditTargets] = useState(false);
  const [editActuals, setEditActuals] = useState(false);
  if (!date) return <div className="biz-block" contentEditable={false}><p className="biz-note">날짜가 없는 매출 블록입니다. 날짜별 매출 페이지에서 사용하세요.</p></div>;

  const s = data?.summary;
  const card = (period: ActualPeriod, label: string, actual: number, target: number) => (
    <div className="biz-kpi">
      <span className="biz-note">{label}{s?.edited?.[period] !== undefined && <span className="biz-tag hand biz-ml" title={`계산값: ${won(s.edited[period]!)}`}>직접 입력</span>}</span>
      <b>{won(actual)}</b>
      <span className="biz-note">{target > 0 ? `목표 ${won(target)} · 달성 ${rate(actual, target)}` : '목표 미설정'}</span>
    </div>
  );

  return (
    <BizBlock block={block} readOnly={readOnly} biz="sales-summary">
      <div className="biz-block-head">
        <h3>{s ? `${s.year}년 본영업 매출` : '본영업 매출'}</h3>
      </div>
      {error && <p className="biz-note">{error}</p>}
      {data && !data.hasSnapshot && data.basisDate && (
        <p className="biz-note">실적 계산은 {shortDate(data.basisDate)} 데이터 기준</p>
      )}
      {data && s && (
        <>
          <div className="biz-today">
            <span className="biz-note">당일 증감액</span>
            <b className={`biz-delta ${data.dayDelta > 0 ? 'up' : data.dayDelta < 0 ? 'down' : ''}`}>{data.hasSnapshot || data.changes.length ? `${signed(data.dayDelta)}원 ${arrow(data.dayDelta)}` : '—'}</b>
            <span className="biz-note">
              {data.baseline && !data.changes.length ? '기준 데이터 — 다음 날부터 비교'
                : data.changes.length ? `변동사항 ${data.changes.length}건${data.hasSnapshot && data.prevDate ? ` · ${shortDate(data.prevDate)} 대비` : ''}` : ''}
            </span>
          </div>
          <div className="biz-kpis">
            {card('annual', `${s.year}년 실적`, s.annualActual, s.annualTarget)}
            {card('quarter', `${s.quarter}분기 실적`, s.quarterActual, s.quarterTarget)}
            {card('month', `${s.month}월 실적`, s.monthActual, s.monthTarget)}
          </div>
          {!readOnly && !editTargets && !editActuals && (
            <span className="biz-row">
              <button {...isolate} type="button" className="biz-link" onClick={() => setEditActuals(true)}>실적 입력</button>
              <button {...isolate} type="button" className="biz-link" onClick={() => setEditTargets(true)}>목표 설정</button>
            </span>
          )}
          {editActuals && <ActualsEditor date={date} s={s} onDone={() => setEditActuals(false)} />}
          {editTargets && <TargetsEditor year={s.year} onDone={() => setEditTargets(false)} />}
        </>
      )}
    </BizBlock>
  );
}

registerBlock(['biz_sales_summary'], SalesSummaryBlock);
