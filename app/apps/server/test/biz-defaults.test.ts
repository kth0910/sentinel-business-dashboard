// 시연판에서 뺀 기능(설계 11.2): 워크스페이스 기본값으로 AI 끔, 외부 공개 끔.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SpaceRecord } from '@nc/shared/records.ts';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-biz-defaults-test-'));
process.env.NC_SCHEDULER = '0';

let db: typeof import('../src/db.ts');
let seed: typeof import('../src/seed.ts');
let defaults: typeof import('../src/biz/defaults.ts');
let api: typeof import('../src/api/handlers.ts');

beforeAll(async () => {
  db = await import('../src/db.ts');
  seed = await import('../src/seed.ts');
  defaults = await import('../src/biz/defaults.ts');
  api = await import('../src/api/handlers.ts');
  seed.createUser('u1', 'a@demo.test', '홍길동');
});

describe('workspace defaults', () => {
  it('workspaces created from the app start with AI and public pages off', () => {
    const { spaceId } = api.handlers.createWorkspace({ userId: 'u1', setCookie() {} } as any, { name: '새 회사' }) as { spaceId: string };
    const s = db.getRecord<SpaceRecord>('space', spaceId)!.settings as any;
    expect(s.ai_enabled).toBe(false);
    expect(s.allow_public_pages).toBe(false);
  });

  it('existing workspaces are switched off once at boot; a later admin change stays', () => {
    const { space } = seed.createWorkspace('u1', '기존 회사');
    expect((db.getRecord<SpaceRecord>('space', space.id)!.settings as any).allow_public_pages).toBe(true);
    defaults.applyWorkspaceDefaults();
    expect(db.getRecord<SpaceRecord>('space', space.id)!.settings as any).toMatchObject({ ai_enabled: false, allow_public_pages: false, allow_members_to_create_pages: true });
    const rec = db.getRecord<SpaceRecord>('space', space.id)!;
    db.putRecord('space', { ...rec, settings: { ...(rec.settings as any), ai_enabled: true }, version: rec.version + 1 } as any);
    defaults.applyWorkspaceDefaults();
    expect((db.getRecord<SpaceRecord>('space', space.id)!.settings as any).ai_enabled).toBe(true);
  });
});
