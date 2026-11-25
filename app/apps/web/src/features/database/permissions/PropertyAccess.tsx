import { HELP_URL } from '@nc/shared/brand.ts';
// “Property access” dialog: default access for a property and exceptions for specific people.
// people / groups / person properties / the page creator, "Preview as", Clear / Cancel / Save. The rule is stored on the
// property (schema[prop].property_permissions); the server redacts and enforces it (apps/server propaccess.ts, dbaccess.ts).
import { useMemo, useState } from 'react';
import type { BlockRecord, CollectionRecord, PropertySchema, SpaceRecord, UserRecord } from '@nc/shared/records.ts';
import {
  DEFAULT_ACCESS_OPTIONS, DYNAMIC_OVERRIDE_ROLE_OPTIONS, MAX_RESTRICTED_PROPERTIES, OVERRIDE_ROLE_OPTIONS, groupIdsOf, hasPropertyRule,
  propertyAccessSource, propertyPermissionsOf, propertyRoleLabel, type PropertyPermissionOverride, type PropertyPermissions,
} from '@nc/shared/database/index.ts';
import { roleAtLeast } from '@nc/shared/permissions.ts';
import { Icon } from '../../../components/Icon.tsx';
import type { MenuItemDef, MenuSectionDef } from '../../../components/Menu.tsx';
import { openOverlay } from '../../../components/overlay.tsx';
import { run } from '../../../lib/blocks.ts';
import { useCollection } from '../../../lib/hooks.ts';
import { records } from '../../../lib/store/records.ts';
import { useSession } from '../../../lib/store/session.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { UserAvatar } from '../../presence/Avatar.tsx';
import { confirmDialog } from '../../page/confirm.tsx';
import { useCollectionAccess } from '../access.ts';
import { openNestedMenu } from '../menus.ts';
import { PropertyIcon } from '../properties/PropertyCell.tsx';
import './permissions.css';

type Group = { id: string; name: string; member_ids?: string[] };

function spaceOf(c: CollectionRecord | undefined): SpaceRecord | undefined {
  return c ? records.get<SpaceRecord>('space', c.space_id) : undefined;
}

function members(space: SpaceRecord | undefined): UserRecord[] {
  const ids = (space?.permissions ?? []).filter((p) => p.type === 'user_permission' && p.user_id && p.role !== 'none').map((p) => p.user_id!);
  return [...new Set(ids)].map((id) => records.get<UserRecord>('lit_user', id)).filter((u): u is UserRecord => !!u);
}

function groupsOf(space: SpaceRecord | undefined): Group[] {
  return ((space?.settings as { groups?: Group[] } | undefined)?.groups ?? []).filter((g) => g && g.id);
}

const sameOverride = (a: PropertyPermissionOverride, b: PropertyPermissionOverride) =>
  a.type === b.type && a.user_id === b.user_id && a.group_id === b.group_id && a.property_info?.property_id === b.property_info?.property_id;

function normalize(p: PropertyPermissions | undefined): PropertyPermissions {
  return { default_access: p?.default_access ?? 'inherit', overrides: [...(p?.overrides ?? [])] };
}

function PropertyAccess({ collectionId, propId, close }: { collectionId: string; propId: string; close: () => void }) {
  const c = useCollection(collectionId) as CollectionRecord | undefined;
  const prop = c?.schema[propId];
  const access = useCollectionAccess(collectionId);
  const canManage = roleAtLeast(access.role, 'editor');
  const me = useSession((s) => s.userId);
  const initial = useMemo(() => normalize(propertyPermissionsOf(prop)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [draft, setDraft] = useState<PropertyPermissions>(initial);
  const [preview, setPreview] = useState(false);
  const [previewUser, setPreviewUser] = useState<string | null>(me);
  const space = spaceOf(c);
  const people = useMemo(() => members(space), [space]);
  const groups = useMemo(() => groupsOf(space), [space]);
  if (!c || !prop) return null;
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const overrides = draft.overrides ?? [];
  const personProps = Object.entries(c.schema).filter(([id, p]) => id !== propId && p.type === 'person');
  const otherRestricted = Object.entries(c.schema).filter(([id, p]) => id !== propId && hasPropertyRule(p)).length;
  const willRestrict = draft.default_access !== 'inherit' || overrides.length > 0;
  const overLimit = willRestrict && !hasPropertyRule(prop) && otherRestricted >= MAX_RESTRICTED_PROPERTIES;

  const setDefault = (anchor: HTMLElement) => openNestedMenu(anchor, {
    width: 300,
    sections: [{ items: DEFAULT_ACCESS_OPTIONS.map((o) => ({ id: o.id, label: o.label, description: o.description, checked: draft.default_access === o.id, onSelect: () => setDraft({ ...draft, default_access: o.id }) })) }],
  }, { placement: 'bottom-end' });

  const overrideName = (o: PropertyPermissionOverride): { name: string; sub?: string; icon: React.ReactNode } => {
    if (o.type === 'user_permission') {
      const u = records.get<UserRecord>('lit_user', o.user_id ?? '');
      return { name: (u?.name || u?.email || '알 수 없는 사용자') + (o.user_id === me ? ' (You)' : ''), sub: u?.email, icon: <UserAvatar userId={o.user_id} size={24} /> };
    }
    if (o.type === 'group_permission') {
      const g = groups.find((x) => x.id === o.group_id);
      const n = g?.member_ids?.length ?? 0;
      return { name: g?.name ?? '그룹', sub: n ? `${n}명` : '멤버 없음', icon: <span className="nc-pa-avatar"><Icon name="users" size={16} /></span> };
    }
    const info = o.property_info;
    if (info?.type === 'created_by') return { name: 'Page creator', icon: <span className="nc-pa-avatar"><Icon name="personCircle" size={16} /></span> };
    const p = info ? c.schema[info.property_id] : undefined;
    return { name: p?.name ?? '사람 속성', sub: '이 테이블의 속성', icon: <span className="nc-pa-avatar">{p ? <PropertyIcon prop={p} size={16} /> : <Icon name="person" size={16} />}</span> };
  };

  const roleMenu = (anchor: HTMLElement, o: PropertyPermissionOverride) => {
    const options = o.type === 'collection_property_permission' ? DYNAMIC_OVERRIDE_ROLE_OPTIONS : OVERRIDE_ROLE_OPTIONS;
    openNestedMenu(anchor, {
      width: 300,
      sections: [
        { items: options.map((r) => ({ id: r.id, label: r.label, description: r.description, checked: o.role === r.id, onSelect: () => setDraft({ ...draft, overrides: overrides.map((x) => (sameOverride(x, o) ? { ...x, role: r.id } : x)) }) })) },
        { items: [{ id: 'remove', label: '예외 제거', icon: 'trash', onSelect: () => setDraft({ ...draft, overrides: overrides.filter((x) => !sameOverride(x, o)) }) }] },
      ],
    }, { placement: 'bottom-end' });
  };

  const addMenu = (anchor: HTMLElement) => {
    const add = (o: PropertyPermissionOverride) => setDraft({ ...draft, overrides: [...overrides, o] });
    const has = (o: PropertyPermissionOverride) => overrides.some((x) => sameOverride(x, o));
    const userItems: MenuItemDef[] = people.map((u) => ({ type: 'user_permission' as const, user_id: u.id, role: 'reader' as const, u }))
      .filter((o) => !has(o)).map((o) => ({ id: `u:${o.user_id}`, label: o.u.name || o.u.email, description: o.u.email, icon: <UserAvatar userId={o.u.id} size={20} />, onSelect: () => add({ type: 'user_permission', user_id: o.user_id, role: 'reader' }) }));
    const groupItems: MenuItemDef[] = groups.filter((g) => !has({ type: 'group_permission', group_id: g.id, role: 'reader' }))
      .map((g) => ({ id: `g:${g.id}`, label: g.name, icon: 'users', onSelect: () => add({ type: 'group_permission', group_id: g.id, role: 'reader' }) }));
    const dyn: PropertyPermissionOverride[] = [
      ...personProps.map(([id]) => ({ type: 'collection_property_permission' as const, property_info: { property_id: id, type: 'person' as const }, role: 'content_only_editor' as const })),
      { type: 'collection_property_permission', property_info: { property_id: 'created_by', type: 'created_by' }, role: 'content_only_editor' },
    ];
    const dynItems: MenuItemDef[] = dyn.filter((o) => !has(o)).map((o) => {
      const p = o.property_info?.type === 'person' ? c.schema[o.property_info.property_id] : undefined;
      return { id: `p:${o.property_info?.property_id}`, label: p ? p.name : 'Page creator', icon: p ? <PropertyIcon prop={p} size={16} /> : 'personCircle', onSelect: () => add(o) };
    });
    const sections: MenuSectionDef[] = [];
    if (userItems.length) sections.push({ title: '사용자', items: userItems });
    if (groupItems.length) sections.push({ title: '그룹', items: groupItems });
    if (dynItems.length) sections.push({ title: '이 테이블의 속성', items: dynItems });
    if (!sections.length) sections.push({ items: [{ id: 'none', label: '만들 수 있는 사람, 그룹, 속성이 없습니다.', disabled: true }] });
    openNestedMenu(anchor, { width: 300, search: '사람 또는 그룹 검색', sections }, { placement: 'bottom-start' });
  };

  const save = () => {
    const keep = draft.default_access !== 'inherit' || overrides.length > 0;
    run('updatePropertyPermissions', (tx) => tx.update('collection', collectionId, ['schema', propId], { property_permissions: keep ? draft : null }));
    useUI.getState().toast(`${prop.name} 접근 규칙을 저장했습니다`);
    close();
  };
  const cancel = async () => {
    if (dirty && canManage) {
      const ok = await confirmDialog({ message: '변경 사항을 취소할까요?', description: '이 필드 액세스 규칙에 저장하지 않은 변경 사항이 있습니다. 지금 닫으면 변경 사항이 사라집니다.', confirmLabel: '변경 사항 버리기', cancelLabel: '계속 편집', danger: true });
      if (!ok) return;
    }
    close();
  };

  const previewInfo = (() => {
    if (!preview || !previewUser) return null;
    const sp = space;
    const draftProp = { ...prop, property_permissions: draft } as PropertySchema;
    const dbRole = previewUser === me ? access.role : previewRoleOf(c, previewUser, sp);
    return propertyAccessSource(draftProp, { userId: previewUser, databaseRole: dbRole, groupIds: groupIdsOf(sp, previewUser), schema: c.schema });
  })();
  const pickPreview = (anchor: HTMLElement) => openNestedMenu(anchor, {
    width: 280,
    search: '사용자 검색',
    sections: [{ items: people.length ? people.map((u) => ({ id: u.id, label: (u.name || u.email) + (u.id === me ? ' (You)' : ''), icon: <UserAvatar userId={u.id} size={20} />, checked: u.id === previewUser, onSelect: () => setPreviewUser(u.id) })) : [{ id: 'none', label: '사용자를 찾을 수 없습니다', disabled: true }] }],
  }, { placement: 'bottom-start' });
  const previewName = (() => { const u = previewUser ? records.get<UserRecord>('lit_user', previewUser) : undefined; return previewUser === me ? '나' : u?.name || u?.email || '누군가'; })();

  const disabled = !canManage;
  return (
    <div className="nc-pa" role="dialog" aria-label="속성 액세스 권한" data-menu-keys="ignore" data-testid="property-access" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); void cancel(); } }}>
      <div className="nc-pa-title">속성 액세스 권한</div>
      <div className="nc-pa-subtitle">이 열을 보거나 편집할 수 있는 사람을 선택하세요.</div>
      <div className="nc-pa-prop">대상: <PropertyIcon prop={prop} size={14} /><b>{prop.name}</b></div>
      {disabled && <div className="nc-pa-note">이 데이터베이스에 대한 전체 액세스 권한이 있는 사람만 속성 액세스를 변경할 수 있습니다.</div>}

      <div className="nc-pa-heading">기본 액세스 권한</div>
      <div className="nc-pa-row">
        <div className="who"><span>모든 사용자</span><span className="sub">모든 사용자, 에이전트, 연결에 적용됩니다</span></div>
        <div role="button" data-testid="pa-default" className={`nc-pa-select ${disabled ? 'disabled' : ''}`} onClick={(e) => !disabled && setDefault(e.currentTarget)}>
          <span>{DEFAULT_ACCESS_OPTIONS.find((o) => o.id === draft.default_access)?.label}</span><Icon name="chevronDown" size={14} />
        </div>
      </div>
      <div className="nc-pa-row" data-tooltip="이 테이블에 대한 전체 액세스 권한이 있는 사람은 이 필드에도 항상 전체 액세스 권한을 갖습니다">
        <div className="who"><span>전체 액세스 권한이 있는 모든 사람</span></div>
        <div className="nc-pa-select disabled"><span>전체 권한</span></div>
      </div>

      <div className="nc-pa-heading">예외</div>
      <div className="nc-pa-desc">특정 사람에게 다른 액세스 권한을 설정합니다</div>
      {!overrides.length && <div className="nc-pa-empty">아직 예외가 없습니다.</div>}
      {overrides.map((o) => {
        const n = overrideName(o);
        return (
          <div key={`${o.type}:${o.user_id ?? o.group_id ?? o.property_info?.property_id}`} className="nc-pa-row" data-testid="pa-override">
            {n.icon}
            <div className="who"><span className="nc-ellipsis">{n.name}{o.type === 'collection_property_permission' ? ' *' : ''}</span>{n.sub && <span className="sub nc-ellipsis">{n.sub}</span>}</div>
            <div role="button" data-testid="pa-override-role" className={`nc-pa-select ${disabled ? 'disabled' : ''}`} onClick={(e) => !disabled && roleMenu(e.currentTarget, o)}>
              <span>{(o.type === 'collection_property_permission' ? DYNAMIC_OVERRIDE_ROLE_OPTIONS : OVERRIDE_ROLE_OPTIONS).find((r) => r.id === o.role)?.label ?? propertyRoleLabel(o.role)}</span><Icon name="chevronDown" size={14} />
            </div>
          </div>
        );
      })}
      {!disabled && (
        <div role="button" className="nc-pa-add" data-testid="pa-add-override" onClick={(e) => addMenu(e.currentTarget)}>
          <Icon name="plus" size={16} /><span>사람, 그룹 또는 사람 속성 만들기</span>
        </div>
      )}
      {overrides.some((o) => o.type === 'collection_property_permission') && <div className="nc-pa-note">* Person field exceptions apply only to people who may view this field</div>}

      <div role="button" className="nc-pa-add" data-testid="pa-preview-toggle" onClick={() => setPreview(!preview)}>
        <Icon name={preview ? 'eyeOff' : 'eye'} size={16} /><span>{preview ? '미리보기 숨기기' : '미리보기 표시'}</span>
      </div>
      {previewInfo && (
        <div className="nc-pa-preview" data-testid="pa-preview">
          <div className="nc-pa-row">
            <div className="who"><span>다음 사용자로 미리보기</span></div>
            <div role="button" className="nc-pa-select" onClick={(e) => pickPreview(e.currentTarget)}><UserAvatar userId={previewUser} size={18} /><span>{previewName}</span><Icon name="chevronDown" size={14} /></div>
          </div>
          <div className="nc-pa-preview-result">{previewInfo.role === 'none' ? '필드를 볼 수 없음' : propertyRoleLabel(previewInfo.role)}</div>
          <div>{previewInfo.via}</div>
          {previewInfo.conditional.map((x) => <div key={x.label}>{x.label}: {propertyRoleLabel(x.role)}</div>)}
          {previewInfo.conditional.length > 0 && <div className="nc-pa-note">같은 항목에 이 중 둘 이상이 적용되면 가장 높은 권한이 적용됩니다.</div>}
        </div>
      )}
      {overLimit && <div className="nc-pa-note nc-pa-error">속성 액세스 규칙 한도에 도달했습니다</div>}

      <div className="nc-pa-foot">
        {HELP_URL && (<a className="nc-pa-learn" href={HELP_URL} target="_blank" rel="noreferrer">자세히 알아보기</a>)}
        <div className="spacer" />
        {!disabled && <div role="button" className="nc-btn outline" data-testid="pa-clear" onClick={() => setDraft({ default_access: 'inherit', overrides: [] })}>지우기</div>}
        <div role="button" className="nc-btn outline" onClick={() => void cancel()}>취소</div>
        {!disabled && <div role="button" className={`nc-btn primary ${overLimit ? 'disabled' : ''}`} data-testid="pa-save" onClick={() => !overLimit && save()}>저장</div>}
      </div>
    </div>
  );
}

/** Someone else's role on the database for "Preview as" (best effort from the sharing entries the client has). */
function previewRoleOf(c: CollectionRecord, userId: string, space: SpaceRecord | undefined): string {
  const host = records.get<BlockRecord>('block', c.parent_id);
  const own = (host?.permissions ?? []).find((p) => p.type === 'user_permission' && p.user_id === userId)?.role;
  if (own) return own;
  const member = (space?.permissions ?? []).find((p) => p.type === 'user_permission' && p.user_id === userId);
  if (!member || member.role === 'none') return 'none';
  return (host?.permissions ?? []).find((p) => p.type === 'space_permission')?.role ?? 'read_and_write';
}

export function openPropertyAccessDialog(collectionId: string, propId: string) {
  return openOverlay((close) => <PropertyAccess collectionId={collectionId} propId={propId} close={close} />, { placement: 'center', backdrop: 'dim', closeOnEscape: false });
}
