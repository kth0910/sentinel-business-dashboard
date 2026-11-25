// '/' 메뉴의 "업무" 묶음과 시연판에서 뺀 항목 숨김. 블록 타입은 없고 *.block.tsx 자동 로드를 쓴다.
import { newId } from '@nc/shared/ids.ts';
import type { BlockType } from '@nc/shared/records.ts';
import { getLocation } from '../../lib/router.ts';
import { hideSlashItemWhen, registerSlashItems } from '../editor/blocks/registry.ts';
import { place, type SlashContext, type SlashItem } from '../editor/slashItems.ts';
import { biz, today } from './api.ts';
import { HIDDEN_SLASH_IDS } from './flags.ts';
import { openMenu } from '../../components/Menu.tsx';
import { cachedCustomBlocks, deleteCustomBlock, insertCustomBlock, renameCustomBlock, type CustomBlock } from './customBlocks.ts';

for (const id of HIDDEN_SLASH_IDS) hideSlashItemWhen(id, () => true);

const defaultHiring = () => ({ sites: '', rows: ['전략기획실', '엔지니어', '경리 및 총무', '경영지원', '병역일터'].map((role) => ({ id: newId(), role, status: '해당자 없음', note: '' })), applicants: null });

/** 지금 보고 있는 페이지가 날짜별 업무 페이지면 그 날짜, 아니면 오늘. */
async function currentDate(): Promise<string> {
  const route = getLocation().route;
  if (route.name !== 'page') return today();
  try {
    return (await biz.pageDate(route.pageId)).date ?? today();
  } catch {
    return today();
  }
}

function salesItem(id: string, label: string, type: BlockType, hint: string): SlashItem {
  return {
    id, label, section: '업무', icon: 'chartBarXAxis', hint, keywords: ['업무', '매출', label],
    apply: (ctx: SlashContext) => void currentDate().then((date) => place(ctx, type, { format: { biz: { date } }, addTextAfter: true })),
  };
}

registerSlashItems((): SlashItem[] => [
  {
    id: 'biz-hiring', label: '채용 현황', section: '업무', icon: 'page', hint: '직군별 현황과 지원자 수', keywords: ['업무', '채용', '인사', 'hiring'],
    apply: (ctx) => void place(ctx, 'biz_hiring', { format: { biz: defaultHiring() }, addTextAfter: true }),
  },
  {
    id: 'biz-schedule', label: '일정', section: '업무', icon: 'calendar', hint: '오전·오후 일정', keywords: ['업무', '일정', 'schedule'],
    apply: (ctx) => void place(ctx, 'biz_schedule', { format: { biz: { items: [] } }, addTextAfter: true }),
  },
  salesItem('biz-sales-summary', '매출 요약', 'biz_sales_summary', '당일 증감액, 실적과 목표'),
  salesItem('biz-changes', '변동사항', 'biz_changes', '전일 대비 바뀐 영업 건'),
  salesItem('biz-monthly-chart', '월별 매출 차트', 'biz_monthly_chart', '월별 확정 매출'),
  salesItem('biz-pipeline', '진행 중 영업 건', 'biz_pipeline', '본 영업 진행·장기관리'),
  ...customItems(),
]);

/** 사용자가 저장한 업무 블록(블록 메뉴 › 업무 블록으로 저장)과 관리 항목. */
function customItems(): SlashItem[] {
  const list = cachedCustomBlocks();
  if (!list.length) return [];
  return [
    ...list.map((c): SlashItem => ({
      id: `biz-custom-${c.id}`, label: c.name, section: '업무', icon: 'duplicate', hint: '저장한 업무 블록', keywords: ['업무', '사용자', c.name],
      apply: (ctx) => void insertCustomBlock(c.id, ctx.blockId, ctx.empty),
    })),
    {
      id: 'biz-custom-manage', label: '업무 블록 관리', section: '업무', icon: 'slidersTwo', hint: '저장한 블록 이름 변경·삭제', keywords: ['업무', '관리', '사용자 블록'],
      apply: (ctx) => manageMenu(ctx.anchor, list),
    },
  ];
}

function manageMenu(anchor: DOMRect, list: CustomBlock[]) {
  openMenu(anchor, {
    width: 260,
    sections: [{
      title: '저장한 업무 블록',
      items: list.map((c) => ({
        label: c.name, icon: 'duplicate',
        submenu: () => ({ sections: [{ items: [
          { label: '이름 변경', icon: 'pencilLine', onSelect: () => void renameCustomBlock(c) },
          { label: '삭제', icon: 'trash', danger: true, onSelect: () => void deleteCustomBlock(c) },
        ] }] }),
      })),
    }],
  });
}
