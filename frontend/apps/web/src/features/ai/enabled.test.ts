import { beforeAll, describe, expect, it } from 'vitest';
import { AI_ENABLED } from './enabled.ts';

// jsdom에는 matchMedia가 없는데 화면 저장소가 불러올 때 읽는다. 스텁을 둔 뒤 앱 모듈을 불러온다.
let slashItems: typeof import('../editor/slashItems.ts');
let router: typeof import('../../lib/router.ts');
beforeAll(async () => {
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false, onchange: null })) as typeof window.matchMedia;
  slashItems = await import('../editor/slashItems.ts');
  router = await import('../../lib/router.ts');
});

// 소스 전체를 문자열로 읽는다(테스트 파일 제외). fileURLToPath는 jsdom에서 쓸 수 없어 vite 로더를 쓴다.
const sources = import.meta.glob(['../../**/*.{ts,tsx}', '!../../**/*.test.{ts,tsx}'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
// glob 키는 이 파일(src/features/ai) 기준 상대 경로다. src 기준 경로('features/shell/Workspace.tsx')로 바꿔 찾는다.
const bySrcPath = Object.fromEntries(Object.entries(sources).map(([key, text]) => [new URL(key, 'http://x/src/features/ai/').pathname.replace('/src/', ''), text]));
const source = (path: string) => bySrcPath[path];

// AI 진입점: 각 파일은 AI_ENABLED로 AI를 막는다(AI 코드는 지우지 않는다).
const GATED = [
  'features/editor/blocks/registerAll.ts',
  'features/ai/mount.tsx',
  'features/ai/sidebarAi.ts',
  'features/shell/Workspace.tsx',
  'features/shell/Topbar.tsx',
  'features/page/PageView.tsx',
  'features/page/ShareMenu.tsx',
  'features/page/Cover.tsx',
  'features/page/PageMenu.tsx',
  'features/page/GetStartedBar.tsx',
  'features/meetings/entry.ts',
  'features/editor/BlockMenu.tsx',
  'features/editor/slashItems.ts',
  'features/editor/inline/TextActionMenu.tsx',
  'features/editor/blocks/media.block.tsx',
  'features/editor/blocks/media/MediaPicker.tsx',
  'features/comments/comments.tsx',
  'features/settings/SettingsModal.tsx',
  'features/settings/searchIndex.ts',
  'features/settings/sections/features.tsx',
  'features/settings/sections/preferences.tsx',
  'features/database/advanced/FormulaEditor.tsx',
  'features/database/chrome/Toolbar.tsx',
  'features/database/chrome/RelationFeatures.tsx',
  'features/database/properties/PropertyMenus.tsx',
  'lib/router.ts',
];

describe('AI 기능 숨기기', () => {
  it('AI_ENABLED는 꺼져 있다', () => {
    expect(AI_ENABLED).toBe(false);
  });

  it.each(GATED)('%s 는 AI_ENABLED를 참조한다', (path) => {
    expect(source(path), `${path} 소스를 찾지 못했다`).toBeTypeOf('string');
    expect(source(path)).toContain('AI_ENABLED');
  });

  it('AI 코드는 지워지지 않았다', () => {
    for (const path of ['features/ai/AiBlock.block.tsx', 'features/agents/AgentChat.block.tsx', 'features/aiImage/AiImage.block.tsx', 'features/editor/blocks/ai.block.tsx', 'features/meetings/MeetingNotes.block.tsx', 'features/ai/ChatView.tsx']) {
      expect(source(path), path).toBeTypeOf('string');
    }
  });

  it('슬래시 메뉴에 AI 항목이 없다', () => {
    const { AI_SLASH_IDS, slashCatalog } = slashItems;
    const ids = slashCatalog().map((i) => i.id);
    expect(AI_SLASH_IDS.length).toBeGreaterThan(0);
    for (const id of AI_SLASH_IDS) expect(ids).not.toContain(id);
    expect(ids).toContain('text');
  });

  it('registerAll 이후 블록 레지스트리에 AI 블록 타입이 없다', async () => {
    await import('../editor/blocks/registerAll.ts');
    await new Promise((r) => setTimeout(r, 1500)); // AI_ENABLED가 켜지면 지연 로더가 끝날 시간을 준다
    const { blockRegistry } = await import('../editor/Block.tsx');
    for (const type of ['ai_block', 'agent_chat', 'meeting_notes', 'transcription']) expect(blockRegistry[type], type).toBeUndefined();
    expect(blockRegistry.text).toBeDefined();
  }, 60_000);

  it('다른 영역이 등록한 AI 슬래시 항목(ai-image 등)도 메뉴에서 빠진다', async () => {
    const { registerSlashItems } = await import('../editor/blocks/registry.ts');
    const fake = (id: string) => ({ id, label: id, section: 'AI', icon: 'aiFace', apply: () => {} });
    registerSlashItems(() => slashItems.AI_SLASH_IDS.map(fake));
    const ids = slashItems.slashCatalog().map((i) => i.id);
    for (const id of slashItems.AI_SLASH_IDS) expect(ids).not.toContain(id);
    expect(slashItems.AI_SLASH_IDS).toContain('ai-image');
  });

  it('빈 텍스트 블록 안내문에 AI 문구가 없다', async () => {
    const { textPlaceholder } = await import('../editor/blocks/TextBlocks.tsx');
    expect(textPlaceholder('text')).toBe('‘/’를 입력해 명령 열기');
    expect(source('features/editor/textHandlers.ts')).toContain('AI_ENABLED');
  });

  it.each(['/ws/chat', '/ws/chat/abc', '/ws/meetings', '/ws/library', '/ws/library/skills', '/agent/0123456789abcdef0123456789abcdef'])('%s 는 홈으로 보낸다', (path) => {
    expect(router.parseLocation(path, '', '').route).toEqual({ name: 'root' });
  });

  it('AI가 아닌 경로는 그대로 둔다', () => {
    expect(router.parseLocation('/ws/tasks', '', '').route).toEqual({ name: 'tasks', domain: 'ws' });
    expect(router.parseLocation('/ws', '', '').route).toEqual({ name: 'home', domain: 'ws' });
  });
});
