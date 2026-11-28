
// and every "New chat" shortcut disappear (the saved layout is kept, so they come back when AI is turned on again).
import { useMemo } from 'react';
import type { SidebarLayout } from '../shell/sidebar/model.ts';
import { useCurrentSpace } from '../../lib/hooks.ts';
import { policyFromSpaceSettings } from './aiApi.ts';
import { AI_ENABLED } from './enabled.ts';

// AI_ENABLED가 꺼져 있으면 채팅·회의록 탭, AI 바로가기(새 채팅·라이브러리·스킬·회의록)와 AI 섹션(채팅·에이전트·AI 회의록)을 숨긴다.
const AI_SHORTCUTS = new Set(['new_chat', 'chat_thread', 'library', 'new_meeting_note', 'meeting_notes', 'skills']);
const AI_SECTIONS = new Set(['chats', 'pinned_chats', 'agents', 'ai_meeting_notes']);

function hideAllAi(layout: SidebarLayout): SidebarLayout {
  const tabs = layout.tabs
    .filter((tab) => tab.icon !== 'chat' && tab.icon !== 'meetings')
    .map((tab) => ({
      ...tab,
      shortcuts: tab.shortcuts.filter((s) => !AI_SHORTCUTS.has(s.type)),
      sections: tab.sections.filter((x) => !AI_SECTIONS.has(x.type)),
    }));
  return { ...layout, tabs: tabs.length ? tabs : layout.tabs.slice(0, 1) };
}

export function useAiSidebarLayout(layout: SidebarLayout): SidebarLayout {
  const space = useCurrentSpace();
  const enabled = policyFromSpaceSettings(space?.settings as Record<string, unknown> | undefined).enabled;
  return useMemo(() => {
    if (!AI_ENABLED) return hideAllAi(layout);
    if (enabled) return layout;
    const tabs = layout.tabs
      .filter((tab, _i, all) => tab.icon !== 'chat' || all.every((x) => x.icon === 'chat'))
      .map((tab) => (tab.shortcuts.some((s) => s.type === 'new_chat') ? { ...tab, shortcuts: tab.shortcuts.filter((s) => s.type !== 'new_chat') } : tab));
    return { ...layout, tabs };
  }, [layout, enabled]);
}
