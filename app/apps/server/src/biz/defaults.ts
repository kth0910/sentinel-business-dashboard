// 시연판에서 뺀 기능(설계 11.2) 중 litpage가 워크스페이스 설정으로 끌 수 있는 것: AI, 외부 공개.
// 새 워크스페이스는 만들 때 끄고, 이미 있던 워크스페이스는 서버 시작 시 한 번만 끈다(이후 관리자가 켠 값은 둔다).
import type { SpaceRecord } from '@nc/shared/records.ts';
import { db, getRecord, putRecord } from '../db.ts';
import { kvGet, kvSet } from './store.ts';

export const WORKSPACE_DEFAULTS = { ai_enabled: false, allow_public_pages: false } as const;
const APPLIED_KEY = 'workspace_defaults_v1';

/** 워크스페이스 하나의 AI·외부 공개를 끈다. 이미 꺼져 있으면 그대로 둔다. */
export function turnOffTrimmedFeatures(spaceId: string): boolean {
  const space = getRecord<SpaceRecord>('space', spaceId);
  if (!space) return false;
  const settings = { ...((space.settings as Record<string, unknown>) ?? {}) };
  const dirty = Object.entries(WORKSPACE_DEFAULTS).some(([k, v]) => settings[k] !== v);
  if (!dirty) return false;
  putRecord('space', { ...space, settings: { ...settings, ...WORKSPACE_DEFAULTS }, version: space.version + 1 } as SpaceRecord);
  return true;
}

/** 서버 시작 시 호출. 처음 한 번만 모든 워크스페이스에 적용하고 기록을 남긴다. */
export function applyWorkspaceDefaults(): number {
  if (kvGet(APPLIED_KEY)) return 0;
  const ids = (db.prepare("SELECT id FROM records WHERE tbl = 'space'").all() as { id: string }[]).map((r) => r.id);
  const changed = ids.filter((id) => turnOffTrimmedFeatures(id)).length;
  kvSet(APPLIED_KEY, new Date().toISOString());
  return changed;
}
