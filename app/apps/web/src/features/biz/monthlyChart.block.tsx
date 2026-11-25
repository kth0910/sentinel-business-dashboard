// 월별 확정 매출 차트 (biz_monthly_chart): 막대 = 월별 확정 매출, 선 = 월 목표(설정된 경우).
import { useEffect, useRef } from 'react';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { registerBlock, type BlockProps } from '../editor/Block.tsx';
import { won } from './api.ts';
import { blockDate, useSalesView } from './sales.ts';
import './biz.css';
import { BizBlock } from './table.tsx';

echarts.use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

const MONTHS = Array.from({ length: 12 }, (_, i) => `${i + 1}월`);
const toManwon = (n: number) => Math.round(n / 10000);

function MonthlyChartBlock({ block, readOnly }: BlockProps) {
  const date = blockDate(block.format);
  const { data } = useSalesView(date);
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!el.current || !data) return;
    const chart = echarts.init(el.current);
    const hasTargets = data.monthTargets.some((v) => v > 0);
    chart.setOption({
      grid: { left: 56, right: 16, top: 32, bottom: 28 },
      legend: { top: 0, right: 0, itemWidth: 12, itemHeight: 8, textStyle: { fontSize: 12 } },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => won(v * 10000) },
      xAxis: { type: 'category', data: MONTHS, axisTick: { show: false } },
      yAxis: { type: 'value', name: '만원', nameTextStyle: { fontSize: 11 }, axisLabel: { fontSize: 11 } },
      series: [
        { name: '확정 매출', type: 'bar', data: data.monthly.map(toManwon), itemStyle: { color: '#2563eb', borderRadius: [3, 3, 0, 0] }, barMaxWidth: 28 },
        ...(hasTargets ? [{ name: '월 목표', type: 'line', data: data.monthTargets.map(toManwon), itemStyle: { color: '#b45309' }, symbolSize: 6 }] : []),
      ],
    });
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el.current);
    return () => { ro.disconnect(); chart.dispose(); };
  }, [data]);

  if (!date) return <div className="biz-block" contentEditable={false}><p className="biz-note">날짜가 없는 매출 블록입니다.</p></div>;
  const year = date.slice(0, 4);
  return (
    <BizBlock block={block} readOnly={readOnly} biz="monthly-chart">
      <div className="biz-block-head">
        <h3>{year}년 월별 확정 매출</h3>
      </div>
      <div ref={el} className="biz-chart" role="img" aria-label={`${year}년 월별 확정 매출 막대그래프`} />
    </BizBlock>
  );
}

registerBlock(['biz_monthly_chart'], MonthlyChartBlock);
