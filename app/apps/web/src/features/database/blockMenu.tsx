// Block menu entries for database blocks:
// inline and full-page database actions, including changing layout and duplicating a database.
// inline database (collection_view) → "Change to entry" (becomes a full-page database where it is)
// full-page database child (collection_view_page) → "Change to inline table", "Launch in a new tab"
// Duplicate › "Make a copy with content" ⌘D / "Make an empty copy" on databases that own their data (width 275)

import type { BlockRecord } from '@nc/shared/records.ts';
import { roleAtLeast } from '@nc/shared/permissions.ts';
import { registerBlockMenu, registerDuplicateItem } from '../editor/blocks/registry.ts';
import { getBlock, run } from '../../lib/blocks.ts';
import { records } from '../../lib/store/records.ts';
import { pageUrl } from '../../lib/router.ts';
import { useEditor } from '../editor/editorState.ts';
import { duplicateDatabaseBlock, ownsData } from './duplicate.ts';

function canEdit(b: BlockRecord): boolean {
  return roleAtLeast(records.role('block', b.id), 'read_and_write') && !(b.format as { block_locked?: boolean } | undefined)?.block_locked;
}

/** Change a database block between inline and full page in place (same parent, same position, same views). */
export function setDatabaseBlockType(blockId: string, type: 'collection_view' | 'collection_view_page') {
  const b = getBlock(blockId);
  if (!b || b.type === type) return;
  run(type === 'collection_view_page' ? 'actionRegistry.turnCollectionViewIntoCollectionViewPage' : 'actionRegistry.viewCollectionViewInline', (tx) => {
    tx.update('block', blockId, [], { type });
  });
  useEditor.getState().clearBlockSelection();
}

registerBlockMenu(['collection_view'], ({ block }) => (canEdit(block) ? [
  { label: '항목으로 전환', icon: 'arrowSquarePathUpDown', onSelect: () => setDatabaseBlockType(block.id, 'collection_view_page') },
  // features/import/MergeCsv.tsx: column mapping, rows added to this database's data source
  ...(ownsData(block) ? [{ label: 'CSV와 병합', icon: 'fileCsv', description: '헤더 행이 필요합니다', onSelect: () => { void import('../import/MergeCsv.tsx').then((m) => m.openMergeCsv(block.id)); } }] : []),
] : []));

registerBlockMenu(['collection_view_page'], ({ block }) => [
  ...(canEdit(block) ? [{ label: '인라인 테이블로 전환', icon: 'arrowSquarePathUpDown', onSelect: () => setDatabaseBlockType(block.id, 'collection_view') }] : []),
  { label: '새 탭에서 열기', icon: 'openAsPage', onSelect: () => { window.open(pageUrl(block.id), '_blank'); } },
]);

registerDuplicateItem(['collection_view', 'collection_view_page'], ({ block }) => {
  if (!ownsData(block)) return null; // a linked view duplicates as another linked view
  return {
    label: '복제', icon: 'duplicate', shortcut: '⌘D',
    submenu: () => ({
      width: 275,
      role: 'menu',
      sections: [{ items: [
        { label: '내용과 함께 복사본 만들기', shortcut: '⌘D', onSelect: () => { duplicateDatabaseBlock(block.id, true); } },
        { label: '빈 사본 만들기', onSelect: () => { duplicateDatabaseBlock(block.id, false); } },
      ] }],
    }),
  };
});
