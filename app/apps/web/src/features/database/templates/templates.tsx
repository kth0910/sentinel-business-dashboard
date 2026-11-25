import { HELP_URL } from '@nc/shared/brand.ts';
// Database templates: the template "•••" menu (Set as default… with the "For all views /
// Only on this view" choice, Edit, Duplicate every…, Duplicate, Delete), the repeat menu:
// Day, Weekday, Week, 2 Weeks, Month, 3 Months, 6 Months, Year, Custom…, Off), the yellow template banner
// ("You’re editing a template in ‹db›" + "Duplicate every…")
// and the template list in the body of an empty database page.
import { useState } from 'react';
import type { BlockRecord, CollectionRecord, CollectionViewRecord } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { duplicateCaption, presetOf, presetRecurrence, RECURRENCE_PRESETS, recurrenceLabel, type Recurrence, type RecurrencePreset } from '@nc/shared/automation/index.ts';
import { Icon } from '../../../components/Icon.tsx';
import { openMenu, type MenuItemDef } from '../../../components/Menu.tsx';
import { openOverlay } from '../../../components/overlay.tsx';
import { useUI } from '../../../lib/store/ui.ts';
import { records } from '../../../lib/store/records.ts';
import { openPeek } from '../../../lib/router.ts';
import { useCollection } from '../../../lib/hooks.ts';
import { PageIcon } from '../../shell/PageIcon.tsx';
import { confirmDialog } from '../../page/confirm.tsx';
import { overlayIdOf } from '../properties/PropertyMenus.tsx';
import { applyTemplate, deleteTemplate, duplicateTemplate, setDefaultTemplate } from '../actions.ts';
import { collectionTemplates } from '../data.ts';
import { setTemplateRecurrence, templateRepeat, useAutomations } from '../automations/api.ts';
import { openRecurrenceEditor } from '../automations/recurrence.tsx';
import { userTimeZone } from '../advanced/context.ts';
import './templates.css';

const nameOf = (b: BlockRecord | undefined) => toPlainText(b?.properties?.title) || '제목 없음';
const collectionName = (c: CollectionRecord | undefined) => toPlainText(c?.name as any) || '제목 없음';

async function setRepeat(templateId: string, rec: Recurrence | null) {
  try {
    await setTemplateRecurrence(templateId, rec);
    if (rec) useUI.getState().toast(`${duplicateCaption(rec)} · ${recurrenceLabel(rec)}`);
  } catch (e) {
    useUI.getState().toast((e as Error)?.message || '이 템플릿은 반복할 수 없습니다.');
  }
}

/** "Duplicate every…" items: presets, Custom…, Off. */
export function repeatItems(templateId: string, anchor: () => HTMLElement | null): MenuItemDef[] {
  const cur = templateRepeat(templateId);
  const rec = cur?.trigger.type === 'recurrence' ? cur.trigger.recurrence : null;
  const preset = presetOf(rec);
  const items: MenuItemDef[] = RECURRENCE_PRESETS.map((p) => ({
    id: p.id, label: p.label, checked: !!cur && preset === p.id,
    onSelect: () => void setRepeat(templateId, presetRecurrence(p.id as RecurrencePreset, Date.now(), userTimeZone(), rec?.time ?? '09:00')),
  }));
  items.push({ id: 'custom', label: '사용자 지정…', checked: !!cur && !preset, onSelect: () => {
    const a = anchor();
    if (a) setTimeout(() => openRecurrenceEditor(a, { value: rec, onSave: (r) => void setRepeat(templateId, r), onDelete: cur ? () => void setRepeat(templateId, null) : undefined, deleteLabel: '반복 취소' }), 0);
  } });
  if (cur) items.push({ id: 'off', label: '표시 안 함', icon: 'xMarkSmall', onSelect: () => void setRepeat(templateId, null) });
  return items;
}

/** Set as default: "Use “X” as default template when creating new pages?" — all views / this view. */
export function openSetDefaultDialog(t: BlockRecord, collection: CollectionRecord, view: CollectionViewRecord | undefined) {
  openOverlay((close) => (
    <div className="nc-confirm nc-tpl-default" role="alertdialog" style={{ width: 300 }}>
      <div className="nc-confirm-message">Use “{nameOf(t)}” as default template when creating new pages?</div>
      <div className="nc-confirm-buttons">
        <button className="nc-dialog-btn primary" autoFocus onClick={() => {
          setDefaultTemplate(undefined, collection.id, t.id);
          // views without their own choice follow the data source default
          if (view && (view.format as any)?.collection_view_default_template) setDefaultTemplate(view, collection.id, null);
          close();
        }}>For all views in “{collectionName(collection)}”</button>
        {view && <button className="nc-dialog-btn outline" onClick={() => { setDefaultTemplate(view, collection.id, t.id); close(); }}>Only on “{view.name || '제목 없음'}” view</button>}
        <button className="nc-dialog-btn outline" onClick={close}>취소</button>
      </div>
    </div>
  ), { placement: 'center', backdrop: 'dim' });
}

/** Template "•••" menu. */
export function openTemplateItemMenu(anchor: HTMLElement, opts: { t: BlockRecord; collection: CollectionRecord; view: CollectionViewRecord | undefined; isDefault: boolean }) {
  const { t, collection, view } = opts;
  return openMenu(anchor, {
    width: 240,
    sections: [{ items: [
      // the dialog opens after the menu closed (a menu choice closes every overlay)
      { id: 'default', label: '기본값으로 설정', icon: 'checkmarkSquare', checked: opts.isDefault, onSelect: () => (opts.isDefault ? setDefaultTemplate(view, collection.id, null) : void setTimeout(() => openSetDefaultDialog(t, collection, view), 0)) },
      { id: 'edit', label: '편집', icon: 'pencilLine', onSelect: () => openPeek(t.id, 'center_peek') },
      { id: 'repeat', label: '반복 복제…', icon: 'arrowSquareLeftRight', submenu: () => ({ width: 200, sections: [{ items: repeatItems(t.id, () => anchor) }] }) },
      { id: 'dup', label: '복제', icon: 'duplicate', onSelect: () => void duplicateTemplate(collection.id, t.id) },
      { id: 'del', label: '삭제', icon: 'trash', onSelect: async () => { if (await confirmDialog({ message: '이 템플릿을 삭제할까요?', confirmLabel: '삭제' })) { if (templateRepeat(t.id)) await setRepeat(t.id, null); deleteTemplate(collection.id, t.id); } } },
    ] }],
  }, { placement: 'right-start', backdrop: 'transparent', parent: overlayIdOf(anchor) });
}

/** Caption under a repeating template in the template menu ("Duplicate weekly"). */
export function templateCaption(templateId: string): string | undefined {
  const a = templateRepeat(templateId);
  return a && a.status === 'active' && a.trigger.type === 'recurrence' ? duplicateCaption(a.trigger.recurrence) : undefined;
}

// ------------------------------------------------------------------ banner

export function TemplateBanner({ page, collection, readOnly }: { page: BlockRecord; collection: CollectionRecord; readOnly?: boolean }) {
  useAutomations(collection.id, { includeTemplateRepeats: true });
  const repeat = templateRepeat(page.id);
  const rec = repeat?.trigger.type === 'recurrence' ? repeat.trigger.recurrence : null;
  const host = records.get<BlockRecord>('block', collection.parent_id);
  const [open, setOpen] = useState(false);
  return (
    <div className="nc-tpl-banner" role="note">
      <div className="nc-tpl-banner-text">
        <span>{readOnly ? '다음 위치의 템플릿을 보고 있습니다' : '템플릿 편집 중:'}</span>
        <a role="link" className="nc-tpl-banner-db" href={host ? `/${host.id.replace(/-/g, '')}` : undefined} onClick={(e) => { e.preventDefault(); if (host) openPeek(host.id, 'side_peek'); }}>
          <PageIcon block={host} size={20} fallback="collection" />
          <span>{collectionName(collection)}</span>
        </a>
        {HELP_URL && (<span role="button" className="nc-tpl-banner-help" aria-label="자세히 알아보기" data-tooltip="데이터베이스 템플릿 알아보기" onClick={() => window.open(HELP_URL!, '_blank', 'noopener')}><Icon name="questionMarkCircle" size={16} /></span>)}
      </div>
      {!readOnly && (
        <span
          role="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          className={`nc-tpl-repeat ${rec ? 'on' : ''}`}
          data-tooltip={rec ? recurrenceLabel(rec) : undefined}
          onClick={(e) => {
            setOpen(true);
            const el = e.currentTarget;
            openMenu(el, { width: 180, sections: [{ items: repeatItems(page.id, () => el) }] }, { placement: 'bottom-start', backdrop: 'transparent', onClose: () => setOpen(false) });
          }}
        >
          {rec ? duplicateCaption(rec) : '복제 주기…'}
          <Icon name="arrowChevronSingleDownSmall" size={14} />
        </span>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ empty row page: template list

export function EmptyRowTemplates({ page }: { page: BlockRecord }) {
  const collection = useCollection(page.parent_table === 'collection' ? page.parent_id : undefined);
  if (!collection || page.is_template) return null;
  const templates = collectionTemplates(collection);
  if (!templates.length) return null;
  return (
    <div className="nc-empty-row-templates" role="listbox" aria-label="템플릿">
      {templates.map((t) => (
        <div key={t.id} role="option" className="nc-empty-row-template-item" onMouseDown={(e) => e.preventDefault()} onClick={() => void applyTemplate(page.id, t.id)}>
          <PageIcon block={t} size={20} />
          <span>{nameOf(t)}</span>
        </div>
      ))}
    </div>
  );
}
