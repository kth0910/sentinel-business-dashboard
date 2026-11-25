// 시연 계정 스크립트(scripts/biz-user.ts)의 본체: 첫 워크스페이스 편집자 + 기본 팀 멤버, 비밀번호 로그인.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SpaceRecord, TeamRecord, UserRecord } from '@nc/shared/records.ts';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-biz-users-test-'));
process.env.NC_SCHEDULER = '0';

let db: typeof import('../src/db.ts');
let seed: typeof import('../src/seed.ts');
let auth: typeof import('../src/auth.ts');
let users: typeof import('../src/biz/users.ts');
let spaceId: string;

beforeAll(async () => {
  db = await import('../src/db.ts');
  seed = await import('../src/seed.ts');
  auth = await import('../src/auth.ts');
  users = await import('../src/biz/users.ts');
  seed.createUser('owner', 'owner@demo.test', '관리자');
  spaceId = seed.createWorkspace('owner', '회사').space.id;
  seed.createWorkspace('owner', '나중 회사');
});

describe('ensureBizUser', () => {
  it('creates an onboarded editor of the first workspace who can write in the default team', () => {
    const r = users.ensureBizUser('Hong@Demo.test', 'pw-1234', '홍길동');
    expect(r).toMatchObject({ created: true, spaceId });
    const user = db.getRecord<UserRecord>('lit_user', r.userId)!;
    expect(user).toMatchObject({ email: 'hong@demo.test', name: '홍길동', onboarding_completed: true });
    expect(auth.checkPassword(r.userId, 'pw-1234')).toBe(true);
    const space = db.getRecord<SpaceRecord>('space', spaceId)!;
    expect(space.permissions.find((p) => p.user_id === r.userId)?.role).toBe('editor');
    const team = db.getRecord<TeamRecord>('team', space.default_team_ids![0])!;
    expect(team.membership.some((m) => m.user_id === r.userId)).toBe(true);
  });

  it('only updates the password of an existing account', () => {
    const first = users.ensureBizUser('hong@demo.test', 'pw-1234');
    const again = users.ensureBizUser('hong@demo.test', 'new-pw-5678');
    expect(again).toMatchObject({ created: false, userId: first.userId });
    expect(auth.checkPassword(first.userId, 'new-pw-5678')).toBe(true);
    expect(db.getRecord<UserRecord>('lit_user', first.userId)!.name).toBe('홍길동');
  });

  it('refuses an empty password', () => {
    expect(() => users.ensureBizUser('kim@demo.test', '')).toThrow(/비밀번호/);
  });
});
