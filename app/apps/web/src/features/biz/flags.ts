// 업무관리 시연판에서 뺀 litpage 기능(설계 11.2). 화면 진입점을 숨기는 데 쓴다.
// AI는 워크스페이스 설정 ai_enabled=false(서버 정책), 외부 공개는 allow_public_pages=false로도 막는다.
export const TRIM = {
  ai: true,
  comments: true,
  publish: true,
  automations: true,
  webhooks: true,
} as const;

/** '/' 메뉴에서 뺄 항목 id (features/editor/slashItems.ts, aiImage). */
export const HIDDEN_SLASH_IDS = [
  'ai-meeting-notes', 'ai-meeting-notes-2', 'ai-block', 'ask-ai', 'ai-skill', 'ai-image', 'comment',
  'db-board', 'db-gallery', 'db-feed', 'db-dashboard', 'db-map', 'form',
];
