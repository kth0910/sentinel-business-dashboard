// 매출 블록들이 같은 날짜 데이터를 한 번만 불러오고, 구분 변경 후 함께 새로고침하도록 묶는다.
import { useEffect, useState } from 'react';
import { biz, type SalesView } from './api.ts';

const cache = new Map<string, Promise<SalesView>>();
const EVENT = 'biz:sales-updated';

function load(date: string): Promise<SalesView> {
  let p = cache.get(date);
  if (!p) {
    p = biz.salesView(date);
    cache.set(date, p);
    p.catch(() => cache.delete(date));
  }
  return p;
}

/** 구분 변경 뒤 호출: 캐시를 비우고 열려 있는 매출 블록을 모두 다시 불러온다. */
export function refreshSales() {
  cache.clear();
  window.dispatchEvent(new Event(EVENT));
}

export function useSalesView(date: string | undefined): { data: SalesView | null; error: string | null } {
  const [state, setState] = useState<{ data: SalesView | null; error: string | null }>({ data: null, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const on = () => setTick((t) => t + 1);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  useEffect(() => {
    if (!date) return;
    let live = true;
    load(date)
      .then((data) => live && setState({ data, error: null }))
      .catch((e) => live && setState({ data: null, error: e?.message ?? '불러오지 못했습니다' }));
    return () => { live = false; };
  }, [date, tick]);
  return state;
}

export function blockDate(format: unknown): string | undefined {
  const d = (format as any)?.biz?.date;
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined;
}

export const shortDate = (d: string | null | undefined) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8))}` : '');
