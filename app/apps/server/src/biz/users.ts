// 시연 계정 만들기(scripts/biz-user.ts). 권한은 두지 않으므로(설계 11.2) 모두 첫 워크스페이스의 편집자로 넣는다.
// 날짜별 페이지가 기본 팀 아래에 있어서 기본 팀 멤버여야 쓸 수 있다(addMember가 기본 팀에 넣어 준다).
import { newId } from '@nc/shared/ids.ts';
import type { UserRecord } from '@nc/shared/records.ts';
import { setPassword } from '../auth.ts';
import { db, findUserIdByEmail, getRecord, putRecord } from '../db.ts';
import { addMember, createUser } from '../seed.ts';

export function firstSpaceId(): string | null {
  const row = db.prepare("SELECT id FROM records WHERE tbl = 'space' ORDER BY json_extract(data, '$.created_time') ASC, rowid ASC LIMIT 1").get() as { id: string } | undefined;
  return row?.id ?? null;
}

export function ensureBizUser(email: string, password: string, name?: string): { userId: string; created: boolean; spaceId: string } {
  const mail = email.trim().toLowerCase();
  if (!mail.includes('@')) throw new Error('이메일 형식이 아닙니다');
  if (!password) throw new Error('비밀번호가 필요합니다');
  const spaceId = firstSpaceId();
  if (!spaceId) throw new Error('워크스페이스가 없습니다. 서버를 NC_BOOTSTRAP_EMAIL/NC_BOOTSTRAP_PASSWORD로 한 번 실행해 첫 계정을 만드세요');
  let userId = findUserIdByEmail(mail);
  const created = !userId;
  if (!userId) {
    userId = newId();
    const user = createUser(userId, mail, name?.trim() || mail.split('@')[0]);
    putRecord('lit_user', { ...user, onboarding_completed: true });
    addMember(spaceId, userId, 'editor');
  } else if (getRecord<UserRecord>('lit_user', userId)?.onboarding_completed === false) {
    putRecord('lit_user', { ...getRecord<UserRecord>('lit_user', userId)!, onboarding_completed: true });
  }
  setPassword(userId, password);
  return { userId, created, spaceId };
}
