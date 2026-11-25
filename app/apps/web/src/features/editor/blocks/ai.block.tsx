// AI meeting notes (meeting_notes / legacy transcription) and AI block placeholders — UI shells only; the AI
// feature wires behavior through the `nc:meeting-notes` and `nc:ask-ai` events. Strings from i18n
// Tabs Summary / Notes / Transcript, "Start transcribing", and a notes placeholder.
// Registered only when no other module already provides these types, so the AI feature's renderers win.
import { useState } from 'react';
import type { BlockRecord } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { blockRegistry, registerBlock, BlockList, type BlockProps } from '../Block.tsx';
import { Icon } from '../../../components/Icon.tsx';
import { createBlockIn, run } from '../../../lib/blocks.ts';
import { useEditor } from '../editorState.ts';
import { toast } from './shared.tsx';

type Tab = 'summary' | 'notes' | 'transcript';

function emit(name: string, detail: Record<string, unknown>): boolean {
  // returns true when some listener handled (cancelled) the event
  return !window.dispatchEvent(new CustomEvent(name, { detail, cancelable: true }));
}

function MeetingNotesBlock({ block, depth, readOnly }: BlockProps) {
  const [tab, setTab] = useState<Tab>('notes');
  const title = toPlainText(block.properties?.title) || '회의록';
  const created = new Date(block.created_time || Date.now());
  const state = (block.format?.transcription_state as string | undefined) ?? 'transcription_not_started';
  return (
    <div className="nc-bpad">
      <div className="nc-tabs-card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div className="nc-ai-card-ic" style={{ width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--lp-bg-interactive-transparent)' }}>
            <Icon name="paperMicrophone" size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{title}</div>
            <div style={{ fontSize: 12, color: 'var(--lp-text-secondary)' }}>{created.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', year: 'numeric' })} at {created.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })}</div>
          </div>
          {!readOnly && (
            <button
              className="nc-blk-btn primary"
              onClick={() => {
                if (!emit('nc:meeting-notes', { blockId: block.id, action: state === 'transcription_in_progress' ? 'stop' : 'start' })) toast('AI 회의록을 사용하려면 CoolNotion! 데스크톱 앱이나 연결된 AI 서비스가 필요합니다.');
              }}
            >
              <Icon name="mic" size={14} />
              {state === 'transcription_in_progress' ? '중지' : '녹취 시작'}
            </button>
          )}
        </div>
        <div className="nc-tabs-strip" role="tablist">
          {(['summary', 'notes', 'transcript'] as Tab[]).map((t) => (
            <div key={t} role="tab" aria-selected={tab === t} className={`nc-tab-pill ${tab === t ? 'selected' : ''}`} onClick={() => setTab(t)}>
              {t === 'summary' ? '요약' : t === 'notes' ? '노트' : '녹취록'}
            </div>
          ))}
        </div>
        <div className="nc-tab-panel">
          {tab === 'notes' && (block.content?.length ? (
            <BlockList parentId={block.id} ids={block.content} depth={depth + 1} readOnly={readOnly} />
          ) : (
            <div role="button" className="nc-tab-empty" onMouseDown={(e) => {
              if (readOnly) return;
              e.preventDefault();
              let id = '';
              run('meetingNotes.addNote', (tx) => { id = createBlockIn(tx, { type: 'text', parentId: block.id, parentTable: 'block' }); });
              useEditor.getState().requestFocus(id, 0);
            }}>CoolNotion! AI가 노트와 녹취록을 요약해 줍니다</div>
          ))}
          {tab === 'summary' && <div className="nc-tab-empty" style={{ cursor: 'default' }}>여기에 요약을 작성하세요…</div>}
          {tab === 'transcript' && <div className="nc-tab-empty" style={{ cursor: 'default' }}>녹취록이 여기에 표시됩니다…</div>}
        </div>
      </div>
    </div>
  );
}

function AiBlock({ block, readOnly }: BlockProps) {
  const [prompt, setPrompt] = useState('');
  const text = toPlainText(block.properties?.title);
  return (
    <div className="nc-bpad">
      <div className="nc-ai-card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
        {text ? <div style={{ whiteSpace: 'pre-wrap', fontSize: 16, lineHeight: 1.5 }}>{text}</div> : null}
        {!readOnly && (
          <div className="nc-ai-input">
            <Icon name="aiFace" size={18} />
            <input
              placeholder="AI에게 무엇이든 작성해 달라고 요청하세요…"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && prompt.trim() && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (!emit('nc:ask-ai', { blockId: block.id, prompt: prompt.trim(), target: 'ai_block' })) toast('이 워크스페이스에는 CoolNotion! AI가 연결되어 있지 않습니다.');
                  setPrompt('');
                }
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function registerIfMissing(types: string[], comp: (p: BlockProps) => React.ReactNode) {
  const missing = types.filter((t) => !blockRegistry[t]);
  if (missing.length) registerBlock(missing, comp as any);
}

registerIfMissing(['meeting_notes', 'transcription'], MeetingNotesBlock);
registerIfMissing(['ai_block'], AiBlock);

export type { BlockRecord };
