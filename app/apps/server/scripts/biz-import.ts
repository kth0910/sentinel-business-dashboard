// 매출 데이터 넣기(화면 업로드 기능은 없음). 업무관리시스템 API가 붙기 전까지 이 명령으로 넣는다.
//   NC_DATA_DIR=<데이터 폴더> node --import ./src/loadEnv.ts scripts/biz-import.ts <YYYY-MM-DD> <엑셀.xlsx> [--force]
// 서버와 같은 NC_DATA_DIR를 쓴다(서버가 켜져 있어도 됨, 화면은 새로고침하면 반영). --force는 직전 데이터보다 많이 빠진 파일도 넣는다.
import { readFileSync } from 'node:fs';
import { ImportError, importSalesFile } from '../src/biz/importer.ts';

const args = process.argv.slice(2);
const force = args.includes('--force');
const [date, file] = args.filter((a) => a !== '--force');
if (!date || !file) {
  console.error('사용법: node --import ./src/loadEnv.ts scripts/biz-import.ts <YYYY-MM-DD> <엑셀.xlsx> [--force]');
  process.exit(1);
}
try {
  const r = await importSalesFile(date, readFileSync(file), { force });
  console.log(r.baseline
    ? `${r.date}: ${r.rowCount.toLocaleString('ko-KR')}건을 기준 데이터로 넣었습니다`
    : `${r.date}: ${r.rowCount.toLocaleString('ko-KR')}건 반영 · 변동 ${r.changeCount.toLocaleString('ko-KR')}건${r.missingCount ? ` · 빠진 건 ${r.missingCount.toLocaleString('ko-KR')}` : ''}`);
  if (r.warnings.length) console.log(`확인 필요 ${r.warnings.length}건:\n${r.warnings.map((w) => `  - ${w}`).join('\n')}`);
} catch (e) {
  console.error(e instanceof ImportError ? e.message + (e.status === 409 ? '\n그래도 넣으려면 --force를 붙이세요.' : '') : (e as Error).message);
  process.exit(1);
}
