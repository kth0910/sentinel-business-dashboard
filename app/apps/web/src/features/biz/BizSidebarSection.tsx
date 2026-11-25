// 사이드바 맨 위 "업무" 묶음: 캘린더, 오늘 업무보고, 오늘 매출 현황.
import { Icon } from '../../components/Icon.tsx';
import { navigate, openPage, spaceDomain, useLocation } from '../../lib/router.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { biz, today, type DailyKind } from './api.ts';

export function BizSidebarSection() {
  const spaceId = useSession((s) => s.spaceId);
  const { route } = useLocation();
  if (!spaceId) return null;

  const openToday = async (kind: DailyKind) => {
    try {
      openPage((await biz.ensurePage(spaceId, today(), kind)).pageId);
    } catch (e: any) {
      useUI.getState().toast(e?.message ?? '페이지를 열 수 없습니다');
    }
  };

  const item = (label: string, icon: string, onClick: () => void, active = false) => (
    <div role="button" tabIndex={0} className={`nc-sb-row ${active ? 'selected' : ''}`} onClick={onClick} onKeyDown={(e) => { if (e.key === 'Enter') onClick(); }}>
      <div className="nc-sb-row-inner">
        <div className="nc-sb-row-icon"><Icon name={icon} size={20} /></div>
        <div className="nc-sb-row-label">{label}</div>
      </div>
    </div>
  );

  return (
    <div className="biz-sb" aria-label="업무">
      <div className="biz-sb-title">업무</div>
      {item('캘린더', 'calendar', () => navigate(`/${spaceDomain(spaceId)}/calendar`), route.name === 'calendar')}
      {item('오늘 업무보고', 'page', () => void openToday('report'))}
      {item('오늘 매출 현황', 'chartBarXAxis', () => void openToday('sales'))}
    </div>
  );
}
