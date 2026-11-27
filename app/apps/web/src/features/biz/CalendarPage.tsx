// 첫 화면: 월 달력. 날짜별 업무보고·매출 반영 여부와 당일 매출 증감액(설계 5.1).
import { useEffect, useMemo, useState } from 'react';
import { openPage } from '../../lib/router.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { arrow, biz, signed, today, type CalendarDay, type DailyKind } from './api.ts';
import './biz.css';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const WEEKDAYS_FULL = WEEKDAYS.map((w) => `${w}요일`);

const monthOf = (date: string) => date.slice(0, 7);

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function CalendarPage() {
  const spaceId = useSession((s) => s.spaceId);
  const [month, setMonth] = useState(monthOf(today()));
  const [days, setDays] = useState<CalendarDay[]>([]);
  const [selected, setSelected] = useState(today());
  const [busy, setBusy] = useState<DailyKind | null>(null);

  useEffect(() => {
    let live = true;
    biz.calendar(month).then((r) => live && setDays(r.days)).catch(() => live && setDays([]));
    return () => { live = false; };
  }, [month]);

  // 디자인처럼 앞뒤 달 날짜를 회색으로 채워 주 단위로 맞춘다.
  const { lead, trail } = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const first = new Date(y, m - 1, 1).getDay();
    const total = new Date(y, m, 0).getDate();
    const prevTotal = new Date(y, m - 1, 0).getDate();
    const used = first + total;
    return {
      lead: Array.from({ length: first }, (_, i) => prevTotal - first + 1 + i),
      trail: Array.from({ length: (7 - (used % 7)) % 7 }, (_, i) => i + 1),
    };
  }, [month]);

  const open = async (kind: DailyKind) => {
    if (!spaceId) return;
    setBusy(kind);
    try {
      const { pageId } = await biz.ensurePage(spaceId, selected, kind);
      openPage(pageId);
    } catch (e: any) {
      useUI.getState().toast(e?.message ?? '페이지를 열 수 없습니다');
    } finally {
      setBusy(null);
    }
  };

  const day = days.find((d) => d.date === selected);
  const [y, m] = month.split('-').map(Number);

  return (
    <div className="biz-cal">
      <div className="biz-cal-bar">
        <div className="biz-cal-legend">
          <span><i className="biz-dot report" />업무보고</span>
          <span><i className="biz-dot sales" />매출 반영</span>
          <span>▲ 증가 · ▼ 감소</span>
        </div>
        <button type="button" className="biz-btn" onClick={() => { setMonth(monthOf(today())); setSelected(today()); }}>오늘</button>
      </div>

      <div className="biz-cal-card">
        <div className="biz-cal-title">
          <button type="button" className="biz-cal-arrow" aria-label="이전 달" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
          <h1 aria-label={`${y}년 ${m}월`}>
            <span className="biz-cal-year">{y}</span>
            <span className="biz-cal-month">{m}월</span>
          </h1>
          <button type="button" className="biz-cal-arrow" aria-label="다음 달" onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
        </div>

        <div className="biz-cal-grid" role="grid" aria-label={`${y}년 ${m}월 달력`}>
          {WEEKDAYS.map((w, i) => (
            <div key={w} className="biz-cal-wd" role="columnheader" aria-label={WEEKDAYS_FULL[i]}>
              <span className="full">{WEEKDAYS_FULL[i]}</span><span className="short">{w}</span>
            </div>
          ))}
          {lead.map((n) => <div key={`lead-${n}`} className="biz-cal-cell other" aria-hidden="true"><span className="biz-cal-num">{n}</span></div>)}
          {days.map((d) => {
            const num = Number(d.date.slice(8));
            const isToday = d.date === today();
            return (
              <button
                key={d.date}
                type="button"
                className={`biz-cal-cell ${d.date === selected ? 'selected' : ''} ${isToday ? 'today' : ''}`}
                onClick={() => setSelected(d.date)}
                aria-pressed={d.date === selected}
                aria-current={isToday ? 'date' : undefined}
                aria-label={`${m}월 ${num}일${isToday ? ' (오늘)' : ''}`}
              >
                <span className="biz-cal-num">{num}</span>
                <span className="biz-cal-marks">
                  {d.reportPageId && <i className="biz-dot report" title="업무보고" />}
                  {d.hasSnapshot && <i className="biz-dot sales" title="매출 반영" />}
                </span>
                <span className={`biz-delta ${d.dayDelta > 0 ? 'up' : d.dayDelta < 0 ? 'down' : ''}`}>{d.dayDelta !== 0 ? `${signed(d.dayDelta)} ${arrow(d.dayDelta)}` : ''}</span>
              </button>
            );
          })}
          {trail.map((n) => <div key={`trail-${n}`} className="biz-cal-cell other" aria-hidden="true"><span className="biz-cal-num">{n}</span></div>)}
        </div>
      </div>

      <section className="biz-cal-day" aria-label="선택한 날짜">
        <h2>{Number(selected.slice(5, 7))}월 {Number(selected.slice(8))}일 ({WEEKDAYS[new Date(`${selected}T00:00:00`).getDay()]})</h2>
        <div className="biz-cal-actions">
          <button type="button" disabled={busy !== null} onClick={() => open('report')}>
            <b>일일 업무보고</b>
            <span>{day?.reportPageId ? '작성됨' : '새로 작성'}</span>
          </button>
          <button type="button" disabled={busy !== null} onClick={() => open('sales')}>
            <b>본영업 목표매출 관리 현황</b>
            <span>{day?.hasSnapshot ? `매출 반영 · 증감 ${signed(day.dayDelta)} ${arrow(day.dayDelta)}` : day?.dayDelta ? `증감 ${signed(day.dayDelta)} ${arrow(day.dayDelta)}` : '매출 미반영'}</span>
          </button>
        </div>
      </section>
    </div>
  );
}
