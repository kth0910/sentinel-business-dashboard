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
if (AI_ENABLED) {
  import.meta.glob(
    [
      '../../ai/AiBlock.block.tsx',
      '../../agents/AgentChat.block.tsx',
      '../../aiImage/AiImage.block.tsx',
      './ai.block.tsx',
      '../../meetings/MeetingNotes.block.tsx',
    ],
    { eager: true },
  );
}
import.meta.glob('../../**/*.view.tsx', { eager: true });
