// Code block. Block padding 8px; box r10 with a background
// rgba(124, 45, 18, 0.03) (--lp-bg-secondary-transparent), padding 36px 22px around the leaf; leaf SFMono 13.6px/20.4px (85%).
// Hover action bar (top-right, 4px inset): "<Language> ▾" 12px graTexAccPri | copy | wrap | •••; Mermaid adds
// Display (Code/Preview/Split, default split_view), Expand diagram, Download image. Caption below (14px/19.6px).
// Keys: Enter = newline (keeps indentation), Tab = "\t", Shift+Tab = outdent line. Language picker: 240px,
// "Find a language…", 88 languages, opens above the button.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { BlockRecord } from '@nc/shared/records.ts';
import { toPlainText, type RichText } from '@nc/shared/richtext.ts';
import { registerBlock, type BlockProps } from '../Block.tsx';
import { RichTextEditable, type LeafApi } from '../RichTextEditable.tsx';
import { makeTextHandlers, insertTextAtSelection, commitText } from '../textHandlers.ts';
import { openMenu, type MenuItemDef } from '../../../components/Menu.tsx';
import { Icon } from '../../../components/Icon.tsx';
import { getBlock, run, setFormat, setProperty } from '../../../lib/blocks.ts';
import { useEditor } from '../editorState.ts';
import { openBlockMenu } from '../BlockMenu.tsx';
import { CODE_LANGUAGES } from './codeLanguages.ts';
import { highlightCode } from './codeHighlight.ts';
import { renderMermaid, svgToJpeg } from './mermaid.ts';
import { registerBlockMenu } from './registry.ts';
import { PREF, setPref } from '../prefs.ts';
import { ActionBar, ActionButton, ActionDivider, Caption, copyText, openLightbox, showCaption, toast, downloadUrl, LiveSwitch } from './shared.tsx';

type PreviewFormat = 'code' | 'preview' | 'split_view';

function languageOf(b: BlockRecord): string {
  return b.properties?.language?.[0]?.[0] ?? 'Plain Text';
}

export function setLanguage(ids: string[], lang: string) {
  run('setCodeLanguage', (tx) => { for (const id of ids) setProperty(tx, id, 'language', [[lang]]); });
  setPref(PREF.codeLanguage, lang); // CodeBlockDefaultLanguage
}

export function openLanguagePicker(blockIds: string[], anchor: HTMLElement | DOMRect, placement: 'top-start' | 'bottom-start' | 'right-start' = 'top-start') {
  const b = getBlock(blockIds[0]);
  const current = b ? languageOf(b) : '';
  return openMenu(anchor as any, {
    search: '언어 찾기…', width: 240, maxHeight: '50vh',
    sections: [{ items: CODE_LANGUAGES.map((l) => ({ label: l, checked: l === current, onSelect: () => setLanguage(blockIds, l) })) }],
  }, { placement, offset: 8 });
}

export function toggleWrap(ids: string[]) {
  const b = getBlock(ids[0]);
  const next = !(b?.format?.code_wrap === true);
  run('toggleWrapCode', (tx) => { for (const id of ids) setFormat(tx, id, { code_wrap: next }); });
  setPref(PREF.codeWrap, next); // CodeBlockDefaultCodeWrap
}

export function copyCode(blockId: string) {
  const text = toPlainText(getBlock(blockId)?.properties?.title as RichText | undefined);
  void copyText(text, '복사됨');
}

export function formatCode(blockId: string) {
  const b = getBlock(blockId);
  if (!b) return;
  const lang = languageOf(b).toLowerCase();
  const text = toPlainText(b.properties?.title as RichText | undefined);
  let out: string | null = null;
  try {
    if (lang === 'json') out = JSON.stringify(JSON.parse(text), null, 2);
    else if (['javascript', 'typescript', 'css', 'scss', 'less', 'html', 'xml', 'markup', 'java', 'c', 'c++', 'c#', 'go', 'rust', 'swift', 'kotlin', 'php'].includes(lang)) out = reindentBraces(text);
  } catch {
    out = null;
  }
  if (out == null) {
    toast(lang === 'json' ? '서식을 적용할 수 없습니다. JSON 형식이 올바르지 않습니다.' : `${languageOf(b)}은(는) 코드 서식을 지원하지 않습니다`);
    return;
  }
  if (out !== text) run('formatCode', (tx) => setProperty(tx, blockId, 'title', out ? [[out]] : []));
}

/** Minimal brace-based re-indentation (2 spaces) for C-like languages and markup. */
function reindentBraces(src: string): string {
  let depth = 0;
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  return lines.map((raw) => {
    const line = raw.trim();
    if (!line) return '';
    const closes = /^[}\])]/.test(line) || /^<\//.test(line) ? 1: 0;
    depth = Math.max(0, depth - closes);
    const out = '  '.repeat(depth) + line;
    const open = (line.match(/[{[(]/g) ?? []).length - (line.match(/[}\])]/g) ?? []).length + closes;
    const tagOpen = (line.match(/<[a-zA-Z][^/>]*>/g) ?? []).length - (line.match(/<\/[a-zA-Z]/g) ?? []).length + (/^<\//.test(line) ? 1: 0);
    depth = Math.max(0, depth + open + (tagOpen > 0 ? tagOpen : 0) - (tagOpen < 0 ? 0 : 0));
    return out;
  }).join('\n');
}

function setPreviewFormat(blockId: string, f: PreviewFormat) {
  run('setCodePreviewFormat', (tx) => setFormat(tx, blockId, { code_preview_format: f }));
}

function MermaidPreview({ code, only }: { code: string; only: boolean }) {
  const [state, setState] = useState<{ svg?: string; error?: string }>({});
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      if (!code.trim()) {
        setState({});
        return;
      }
      void renderMermaid(code).then((r) => {
        if (!alive) return;
        // keep the last good diagram while the source is mid-edit
        setState((prev) => (r.svg ? r : { svg: prev.svg, error: r.error }));
      });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [code]);
  return (
    <>
      <div className={`nc-mermaid-preview ${only ? 'only' : ''}`} contentEditable={false} dangerouslySetInnerHTML={{ __html: state.svg ?? '' }} />
      {state.error && !state.svg && <div className="nc-mermaid-error">{state.error}</div>}
    </>
  );
}

function CodeBlock({ block, readOnly }: BlockProps) {
  const handlers = useMemo(() => makeTextHandlers(block.id), [block.id]);
  const language = languageOf(block);
  const wrap = block.format?.code_wrap === true;
  const lineNumbers = block.format?.code_line_numbers === true;
  const isMermaid = language.toLowerCase() === 'mermaid';
  const preview = (block.format?.code_preview_format as PreviewFormat | undefined) ?? 'split_view';
  const text = toPlainText(block.properties?.title as RichText | undefined);
  const renderer = useMemo(() => (el: HTMLElement, value: RichText) => highlightCode(el, value, language), [language]);
  const langRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const showCode = !isMermaid || preview !== 'preview';
  const showPreview = isMermaid && preview !== 'code';
  const lines = lineNumbers ? text.split('\n').length : 0;

  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>, api: LeafApi) => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Tab' && !mod && !e.altKey) {
      e.preventDefault();
      if (!e.shiftKey) insertTextAtSelection(block.id, 'title', api, '\t');
      else outdentLine(block.id, api);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !mod && !e.altKey && !e.nativeEvent.isComposing && !useEditor.getState().slash) {
      e.preventDefault();
      const sel = api.selection() ?? { start: 0, end: 0 };
      const value = toPlainText(api.value());
      const lineStart = value.lastIndexOf('\n', sel.start - 1) + 1;
      const indent = /^[\t ]*/.exec(value.slice(lineStart, sel.start))?.[0] ?? '';
      insertTextAtSelection(block.id, 'title', api, '\n' + indent);
      return;
    }
    handlers.onKeyDown(e, api);
  };

  return (
    <div className="nc-bpad">
      <div className={`nc-code-box nc-blk-hoverable ${showCode ? '' : 'preview-only'}`} role="figure" aria-label="코드 블록">
        {!readOnly && (
          <ActionBar className="nc-code-actionbar">
            <div ref={langRef} role="button" tabIndex={0} aria-label="언어 선택" className="nc-blk-action with-text nc-code-lang-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => langRef.current && openLanguagePicker([block.id], langRef.current)}>
              {language}
              <Icon name="chevronDown" size={12} />
            </div>
            <ActionDivider />
            {isMermaid && (
              <>
                <ActionButton icon={preview === 'code' ? 'code' : preview === 'preview' ? 'previewEye' : 'splitView'} tooltip="표시" label="미리보기 형식 선택" onClick={(e) => openMenu(e.currentTarget, {
                  width: 200,
                  sections: [{ items: ([['code', '코드', 'code'], ['preview', '미리보기', 'previewEye'], ['split_view', '분할', 'splitView']] as const).map(([f, label, icon]) => ({ label, icon, checked: preview === f, onSelect: () => setPreviewFormat(block.id, f) })) }],
                })} />
                <ActionButton icon="zoomIn" tooltip="다이어그램 확대" onClick={() => {
                  void renderMermaid(text).then((r) => r.svg && openLightbox(() => <div className="nc-lightbox-diagram" dangerouslySetInnerHTML={{ __html: r.svg! }} />));
                }} />
                <ActionButton icon="download" tooltip="이미지 다운로드" label="다이어그램 이미지 다운로드" onClick={() => {
                  void renderMermaid(text).then(async (r) => {
                    if (!r.svg) return toast('다이어그램에 오류가 있습니다');
                    const blob = await svgToJpeg(r.svg);
                    if (!blob) return toast('다이어그램을 내보내지 못했습니다');
                    const url = URL.createObjectURL(blob);
                    downloadUrl(url, 'diagram.jpeg');
                    setTimeout(() => URL.revokeObjectURL(url), 5000);
                  });
                }} />
              </>
            )}
            <ActionButton icon={copied ? 'check' : 'copy'} tooltip="복사" label="코드 복사" onClick={() => { copyCode(block.id); setCopied(true); setTimeout(() => setCopied(false), 1500); }} />
            <ActionButton icon="arrowTurnDownLeft" tooltip={wrap ? '코드 줄바꿈 끄기' : '코드 줄바꿈'} active={wrap} onClick={() => toggleWrap([block.id])} />
            <ActionButton icon="ellipsis" tooltip="추가 작업" label="블록 옵션 열기" onClick={(e) => openBlockMenu([block.id], e.currentTarget.getBoundingClientRect())} />
          </ActionBar>
        )}
        {showCode && (
          <div className="nc-code-scroll" style={lineNumbers ? { paddingInlineStart: 26, position: 'relative' } : undefined}>
            {lineNumbers && (
              <div className="nc-code-lines" style={{ top: 0 }} aria-hidden>
                {Array.from({ length: lines }, (_, i) => <div key={i}>{i + 1}</div>)}
              </div>
            )}
            <RichTextEditable
              blockId={block.id}
              value={block.properties?.title as RichText | undefined}
              readOnly={readOnly}
              className={`nc-code-leaf-2 language-${language.toLowerCase().replace(/[^a-z0-9]/g, '')} ${wrap ? 'wrap' : ''}`}
              spellCheck={false}
              placeholder=" "
              renderer={renderer}
              onChange={(next, info) => {
                // code is literal text: no markdown shortcuts, no "/" or "@" menus
                commitText(block.id, 'title', next, info.caret);
              }}
              onKeyDown={onKeyDown}
              onPaste={(e, api) => {
                const plain = e.clipboardData.getData('text/plain');
                if (plain) {
                  e.preventDefault();
                  insertTextAtSelection(block.id, 'title', api, plain.replace(/\r\n?/g, '\n'));
                } else handlers.onPaste(e, api);
              }}
            />
          </div>
        )}
        {showPreview && <MermaidPreview code={text} only={!showCode} />}
      </div>
      <Caption block={block} readOnly={readOnly} />
    </div>
  );
}

function outdentLine(blockId: string, api: LeafApi) {
  const sel = api.selection() ?? { start: 0, end: 0 };
  const value = toPlainText(api.value());
  const lineStart = value.lastIndexOf('\n', sel.start - 1) + 1;
  const m = /^(\t| {1,2})/.exec(value.slice(lineStart));
  if (!m) return;
  const next = value.slice(0, lineStart) + value.slice(lineStart + m[1].length);
  commitText(blockId, 'title', next ? [[next]] : [], Math.max(lineStart, sel.start - m[1].length), { coalesce: false, action: 'outdentCodeLine' });
  useEditor.getState().requestFocus(blockId, Math.max(lineStart, sel.start - m[1].length));
}

registerBlock(['code'], CodeBlock);

// Code block menu: Turn into, Caption ⌘⌥M, Copy code, Wrap code,
// Language ▸, Format code — then the shared Copy link / Duplicate / Move to / Delete … items.
registerBlockMenu(['code'], ({ ids, block, turnInto }) => {
  const items: MenuItemDef[] = [
    turnInto,
    { label: '캡션', icon: 'caption', shortcut: '⌘⌥M', onSelect: () => showCaption(block.id) },
    { label: '코드 복사', icon: 'copyCode', onSelect: () => copyCode(block.id) },
    { label: '코드 줄바꿈', icon: 'arrowTurnDownLeft', right: <LiveSwitch blockId={block.id} get={(b) => b.format?.code_wrap === true} />, onSelect: () => { toggleWrap(ids); return false; } },
    {
      label: '언어', icon: 'curlyBraces',
      submenu: () => ({
        search: '언어 찾기…', width: 240, maxHeight: '50vh',
        sections: [{ items: CODE_LANGUAGES.map((l) => ({ label: l, checked: l === languageOf(block), onSelect: () => setLanguage(ids, l) })) }],
      }),
    },
    { label: '코드 서식 지정', icon: 'lightning', onSelect: () => formatCode(block.id) },
    {
      label: '줄 번호', icon: 'listNumber', right: <LiveSwitch blockId={block.id} get={(b) => b.format?.code_line_numbers === true} />,
      onSelect: () => { const on = getBlock(block.id)?.format?.code_line_numbers === true; run('toggleCodeLineNumbers', (tx) => { for (const id of ids) setFormat(tx, id, { code_line_numbers: !on }); }); return false; },
    },
  ];
  return items;
});

// ⌘⌥M inside a code/media block reveals the caption
const w = window as any;
if (w.__ncCaptionKey) window.removeEventListener('keydown', w.__ncCaptionKey, true);
w.__ncCaptionKey = (e: KeyboardEvent) => {
  if (!(e.metaKey || e.ctrlKey) || !e.altKey || e.code !== 'KeyM') return;
  const f = useEditor.getState().focused;
  const sel = useEditor.getState().selectedBlocks;
  const id = f?.blockId ?? sel[0];
  const b = getBlock(id);
  if (!b || !['code', 'image', 'video', 'audio', 'file', 'pdf', 'bookmark', 'embed', 'equation'].includes(b.type)) return;
  e.preventDefault();
  e.stopPropagation();
  showCaption(b.id);
};
window.addEventListener('keydown', w.__ncCaptionKey, true);
