import { HELP_URL } from '@nc/shared/brand.ts';
// View settings › Manage datasets:
// Source — the data sources this database owns: name · "N views" · ••• (Move to, Copy dataset ID, Delete)
// + Create dataset (New blank dataset, Import CSV, Suggested templates, Link an existing dataset)
// Linked — other databases' sources shown here: name · "N views" · delete the linked views
// + Link an existing dataset
// Explore datasets
import { useState } from 'react';
import type { BlockRecord, CollectionRecord, ViewType } from '@nc/shared/records.ts';
import { compactId } from '@nc/shared/ids.ts';
import { useBlock, useTableVersion } from '../../../lib/hooks.ts';
import { records } from '../../../lib/store/records.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { api } from '../../../lib/api.ts';
import { Icon } from '../../../components/Icon.tsx';
import { openMenu } from '../../../components/Menu.tsx';
import { openOverlay, PopoverSurface } from '../../../components/overlay.tsx';
import { confirmDialog } from '../../page/confirm.tsx';
import { VSHeader as Header, VSRow as Row, VSSection as Section } from '../chrome/ViewSettings.tsx';
import { openLinkedSourcePicker } from '../chrome/LinkedSourcePicker.tsx';
import { templateSchema, type Template } from '../chrome/NewDatabasePanel.tsx';
import { addDataSource, addLinkedView, blockSources, moveDataSource, removeLinkedSource, sourceName, trashDataSource } from './sources.ts';
import { choiceDialog, openDatabasePicker } from './DatabasePicker.tsx';
import '../dbv.css';

const nViews = (n: number) => (n === 1 ? '보기 1개' : `보기 ${n}개`);

function selectView(block: BlockRecord, viewId: string) {
  window.dispatchEvent(new CustomEvent('nc:select-view', { detail: { blockId: block.id, viewId } }));
}

/** “Create dataset” menu and panel content. */
export function openAddDataSource(anchor: HTMLElement, block: BlockRecord, onDone?: () => void) {
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.csv,text/csv';
  const created = (res: { viewId: string } | null) => {
    if (res) selectView(block, res.viewId);
    onDone?.();
  };
  return openOverlay((close) => <AddSourceMenu block={block} close={close} onCreated={created} fileInput={fileInput} />, { anchor, placement: 'bottom-start', offset: 4 });
}

function AddSourceMenu({ block, close, onCreated, fileInput }: { block: BlockRecord; close: () => void; onCreated: (r: { viewId: string } | null) => void; fileInput: HTMLInputElement }) {
  const [q, setQ] = useState('');
  const templates = ([
    { id: 'tasks', label: '작업 트래커', icon: 'checkmarkSquare', tile: 'green' },
    { id: 'projects', label: '프로젝트', icon: 'refresh', tile: 'blue' },
    { id: 'skills', label: '스킬', icon: 'magicWand', tile: 'gray' },
  ] as const).filter((t) => !q || t.label.toLowerCase().includes(q.toLowerCase()));
  const fromTemplate = (t: Template) => {
    const tpl = templateSchema(t);
    close();
    onCreated(addDataSource(block, { name: tpl.name, schema: tpl.schema, views: tpl.views.map((v) => ({ type: v.type as ViewType, name: v.name, groupBy: v.groupBy })) }));
  };
  const importCsv = () => {
    fileInput.onchange = async () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      const res = addDataSource(block, { name: f.name.replace(/\.csv$/i, '') });
      if (!res) return;
      try {
        // the new source must reach the server before the rows go in
        await new Promise((r) => setTimeout(r, 200));
        const out = await api<{ rows: number }>('importCsvToCollection', { collectionId: res.collectionId, csv: await f.text() });
        useUI.getState().toast(`${out.rows}개 행을 가져왔습니다`);
      } catch (err) {
        useUI.getState().toast(err instanceof Error ? err.message : '가져오지 못했습니다');
      }
      onCreated(res);
    };
    close();
    fileInput.click();
  };
  return (
    <PopoverSurface width={300} className="nc-add-source-menu" maxHeight="min(520px, 70vh)">
      <div className="nc-vs-header">
        <span className="nc-vs-title">데이터 소스 만들기</span>
        <span role="button" className="nc-panel-close" aria-label="닫기" onClick={close}><Icon name="xMarkSmall" size={14} /></span>
      </div>
      <div className="nc-vs-search" data-menu-keys="ignore"><div className="nc-input focused"><input autoFocus placeholder="검색…" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
      <div className="lit-scroller vertical nc-menu-scroll">
        <div className="nc-menu-section">
          <div role="menuitem" className="nc-menu-item nc-new-db-row tall" onClick={() => { close(); onCreated(addDataSource(block, { name: q.trim() || undefined })); }}>
            <div className="nc-menu-item-inner"><span className="nc-new-db-tile"><Icon name="plusSmall" size={16} /></span><div className="nc-menu-label">{q.trim() ? `새 “${q.trim()}” 데이터 소스` : '새 빈 데이터 소스'}</div></div>
          </div>
          {!q && (
            <div role="menuitem" className="nc-menu-item nc-new-db-row tall" onClick={importCsv}>
              <div className="nc-menu-item-inner"><span className="nc-new-db-icon"><Icon name="download" size={20} /></span><div className="nc-menu-label">CSV 가져오기</div></div>
            </div>
          )}
        </div>
        {templates.length > 0 && (
          <div className="nc-menu-section no-divider">
            <div className="nc-menu-section-title">추천</div>
            {templates.map((t) => (
              <div key={t.id} role="menuitem" className="nc-menu-item nc-new-db-row tall" onClick={() => fromTemplate(t.id)}>
                <div className="nc-menu-item-inner"><span className={`nc-new-db-tile tile-${t.tile}`}><Icon name={t.icon} size={16} /></span><div className="nc-menu-label">{t.label}</div></div>
              </div>
            ))}
          </div>
        )}
        <div className="nc-menu-section with-divider">
          <div role="menuitem" className="nc-menu-item nc-new-db-row" onClick={(e) => {
            const anchor = e.currentTarget.closest('.nc-add-source-menu') as HTMLElement | null;
            close();
            linkExisting(anchor ?? document.body, block, (id) => onCreated({ viewId: id }));
          }}>
            <div className="nc-menu-item-inner"><span className="nc-new-db-icon"><Icon name="arrowDiagonalUpRight" size={16} /></span><div className="nc-menu-label">기존 데이터 소스 연결</div></div>
          </div>
        </div>
      </div>
    </PopoverSurface>
  );
}

/** Link another database's source into this block (source → "New view" step). */
export function linkExisting(anchor: HTMLElement, block: BlockRecord, onDone?: (viewId: string) => void) {
  const { owned, linked } = blockSources(block);
  openLinkedSourcePicker(anchor, {
    exclude: [...owned, ...linked].map((c) => c.id),
    onPick: (target, choice) => {
      const live = records.get<BlockRecord>('block', block.id) ?? block;
      const id = addLinkedView(live, target, { type: choice.type, copyViewId: choice.copyViewId });
      if (id) {
        selectView(live, id);
        onDone?.(id);
      }
    },
  });
}

function sourceMenu(anchor: HTMLElement, block: BlockRecord, c: CollectionRecord, viewCount: number, canDelete: boolean) {
  const name = sourceName(c) || '제목 없음';
  openMenu(anchor, {
    width: 240,
    sections: [
      { items: [
        { id: 'move', label: '옮기기', icon: 'arrowTurnUpRight', onSelect: () => {
          setTimeout(() => openDatabasePicker(anchor, { exclude: [block.id], title: '데이터 소스 보내기…', onPick: async (to) => {
            const how = viewCount > 0 ? await choiceDialog({
              message: `데이터 소스 ${name} 보내는 중`,
              description: viewCount === 1 ? '이 데이터베이스에 이 데이터 소스를 사용하는 보기가 1개 있습니다.' : `이 데이터 소스를 사용하는 보기가 ${viewCount}개 있습니다.`,
              choices: [
                { key: 'views', label: viewCount === 1 ? '데이터 소스와 보기 1개 이동' : `데이터 소스와 보기 ${viewCount}개 이동`, primary: true },
                { key: 'only', label: '데이터 소스만 보내기' },
              ],
            }) : 'views';
            if (!how) return;
            const live = records.get<BlockRecord>('block', block.id) ?? block;
            moveDataSource(live, c.id, to, how === 'views');
          } }), 0);
        } },
        { id: 'copy', label: '데이터 소스 ID 복사', icon: 'copy', onSelect: () => { void navigator.clipboard?.writeText(compactId(c.id)); useUI.getState().toast(`${name} ID를 복사했습니다`); } },
      ] },
      ...(canDelete ? [{ items: [
        { id: 'delete', label: '삭제', icon: 'trash', danger: true, onSelect: async () => {
          await new Promise((r) => setTimeout(r, 0)); // after the menu closed (it closes overlays opened above it)
          const ok = await confirmDialog({
            message: `${name}을(를) 휴지통으로 이동할까요?`,
            description: `데이터 소스와 ${nViews(viewCount)}을(를) 휴지통으로 이동합니다`,
            confirmLabel: '데이터 소스를 휴지통으로 이동',
          });
          if (ok) trashDataSource(records.get<BlockRecord>('block', block.id) ?? block, c.id);
        } },
      ] }] : []),
    ],
  }, { placement: 'bottom-end' });
}

/** The Manage datasets page of the view settings panel. */
export function ManageDataSourcesPage({ block: blockIn, readOnly, onBack, close }: { block: BlockRecord; readOnly: boolean; onBack: () => void; close: () => void }) {
  useTableVersion(['collection', 'collection_view']);
  const block = useBlock(blockIn.id) ?? blockIn;
  const { owned, linked, views } = blockSources(block);
  const total = owned.length + linked.length;
  const openFirst = (c: CollectionRecord) => {
    const v = views.get(c.id)?.[0];
    if (v) selectView(block, v.id);
  };
  const rowFor = (c: CollectionRecord, kind: 'owned' | 'linked') => {
    const n = views.get(c.id)?.length ?? 0;
    return (
      <div key={c.id} role="menuitem" className="nc-menu-item nc-vs-row nc-source-row" data-testid="data-source-row" onClick={() => openFirst(c)}>
        <div className="nc-menu-item-inner">
          <div className="nc-menu-icon"><Icon name="collection" size={20} /></div>
          <div className="nc-menu-label nc-ellipsis">{sourceName(c) || '제목 없음'}</div>
          <span className="nc-menu-value">{nViews(n)}</span>
          {!readOnly && kind === 'owned' && (
            <span role="button" className="nc-source-more" aria-label="데이터 소스 작업" onClick={(e) => { e.stopPropagation(); sourceMenu(e.currentTarget, block, c, n, total > 1); }}>
              <Icon name="ellipsisSmall" size={16} />
            </span>
          )}
          {!readOnly && kind === 'linked' && total > 1 && (
            <span role="button" className="nc-source-more" aria-label="연결된 보기 제거" data-tooltip={n === 1 ? '연결된 보기 삭제' : `연결된 보기 ${n}개 삭제`} onClick={(e) => { e.stopPropagation(); removeLinkedSource(block, c.id); }}>
              <Icon name="trash" size={16} />
            </span>
          )}
        </div>
      </div>
    );
  };
  return (
    <>
      <Header title="데이터 소스 관리" onBack={onBack} close={close} />
      <Section title="위치">
        {owned.map((c) => rowFor(c, 'owned'))}
        {!readOnly && <Row icon="plus" label="데이터 소스 만들기" chevron={false} onClick={(e) => openAddDataSource(e.currentTarget, block)} />}
      </Section>
      <Section divider title="연결됨">
        {linked.map((c) => rowFor(c, 'linked'))}
        {!readOnly && <Row icon="plus" label="기존 데이터 소스 연결" chevron={false} onClick={(e) => linkExisting(e.currentTarget, block)} />}
      </Section>
      <Section divider>
        {HELP_URL && <Row icon="questionMarkCircle" label="데이터 소스 알아보기" chevron={false} onClick={() => window.open(HELP_URL!, '_blank', 'noopener')} />}
      </Section>
    </>
  );
}
