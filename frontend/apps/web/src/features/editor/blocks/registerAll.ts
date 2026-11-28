// Registers every block renderer and database view. Any file named *.block.tsx (blocks) or *.view.tsx
// (database views) under src/features is picked up automatically — add new types without editing this file.
// Non-text blocks live in editor/blocks/*.block.tsx.
import './icons.tsx';
import './blocks.css';
import './TextBlocks.tsx';
import '../../database/DatabaseBlock.tsx';
import '../atoms.ts';
import { AI_ENABLED } from '../../ai/enabled.ts';

// AI_ENABLED가 꺼져 있으면 AI 블록(AI 블록·에이전트 채팅·AI 이미지·회의록)은 등록하지 않는다. 코드는 그대로 둔다.
import.meta.glob(
  [
    '../../**/*.block.tsx',
    '!../../ai/AiBlock.block.tsx',
    '!../../agents/AgentChat.block.tsx',
    '!../../aiImage/AiImage.block.tsx',
    '!./ai.block.tsx',
    '!../../meetings/MeetingNotes.block.tsx',
  ],
  { eager: true },
);
// eager glob은 조건문 안에 있어도 최상단 정적 import로 끌어올려지므로, 지연 로더로 두고 AI_ENABLED일 때만 호출한다.
if (AI_ENABLED) {
  const aiBlocks = import.meta.glob(
    [
      '../../ai/AiBlock.block.tsx',
      '../../agents/AgentChat.block.tsx',
      '../../aiImage/AiImage.block.tsx',
      './ai.block.tsx',
      '../../meetings/MeetingNotes.block.tsx',
    ],
  );
  for (const load of Object.values(aiBlocks)) void load();
}
import.meta.glob('../../**/*.view.tsx', { eager: true });
