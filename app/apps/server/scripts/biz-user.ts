// 시연 계정 만들기. 이미 있으면 비밀번호만 바꾼다.
//   NC_DATA_DIR=<데이터 폴더> node --import ./src/loadEnv.ts scripts/biz-user.ts <email> <password> [이름]
// 서버와 같은 NC_DATA_DIR를 써야 한다. 첫 계정(워크스페이스 주인)은 서버를 NC_BOOTSTRAP_EMAIL/NC_BOOTSTRAP_PASSWORD로 실행해 만든다.
import { ensureBizUser } from '../src/biz/users.ts';

const [email, password, ...nameParts] = process.argv.slice(2);
if (!email || !password) {
  console.error('사용법: node --import ./src/loadEnv.ts scripts/biz-user.ts <email> <password> [이름]');
  process.exit(1);
}
try {
  const r = ensureBizUser(email, password, nameParts.join(' ') || undefined);
  console.log(r.created ? `계정을 만들었습니다: ${email.trim().toLowerCase()}` : `비밀번호를 바꿨습니다: ${email.trim().toLowerCase()}`);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
