# 금요일 시연판 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** litpage(원래 구성: TypeScript 서버 + SQLite)를 저장소로 가져와, 캘린더 첫 화면·일일 업무보고·본영업 목표매출 화면과 엑셀 업로드가 실제로 동작하는 시연판을 2026-11-27(금)까지 만든다.

**Architecture:** litpage 모노레포를 `app/`에 그대로 넣는다. 업무 로직(엑셀 행 정규화, 전일 비교, 변동 분류, 매출 집계)은 프레임워크와 무관한 순수 TS 패키지 `app/packages/biz`에 모은다. 나중에 Python으로 옮길 때 이 패키지와 테스트가 기준이 된다. 서버는 litpage의 RPC 모듈 규칙(`apps/server/src/api/modules/*.ts`의 `handlers`)으로 `biz*` 엔드포인트를 더한다. 화면은 litpage의 블록 등록 규칙(`*.block.tsx`의 `registerBlock`, `registerSlashItems`)으로 업무 블록을 붙인다.

**Tech Stack:** Node.js 26, pnpm 10.32.1, TypeScript, Hono, `node:sqlite`, React 19 + Vite, vitest, exceljs(엑셀 읽기), echarts(차트)

**Spec:** `docs/superpowers/specs/2026-11-25-daily-report-dashboard-design.md` (특히 11장 "금요일 시연판", 5장 화면, 7장 데이터 흐름)

## Global Constraints

- 기한: 2026-11-27(금). 이번 계획은 시연판이다. Python(FastAPI) 포팅은 범위 밖(11.1).
- litpage 출처: `https://github.com/litmers-dev/litpage` 커밋 `f55fead`. MIT 저작권 고지(`LICENSE`, `THIRD_PARTY_NOTICES.md`) 유지. 포크하지 않고 원본을 따라가지 않음.
- Node.js ≥ 26, pnpm `10.32.1`(litpage `packageManager` 값).
- 빼는 기능: AI 기능, 자동화, 댓글(제안 편집 포함), 외부 공유(공개 링크·공개 사이트), 웹훅(11.2).
- 데이터베이스 보기는 표(table), 리스트(list), 캘린더(calendar), 타임라인(timeline), 차트(chart)만. 보드·갤러리·대시보드·피드·폼·지도 제외(11.2).
- 권한 없음: 로그인한 사용자는 모두 같은 권한(11.2). 회원가입 화면은 두지 않고, 계정은 관리자가 만든다(8.10).
- 동시 편집 유지(11.2).
- 매출 대상은 구분 `본 영업`. 진행 중 = 진행사항 `진행`·`장기관리`. 매출(현황) = 최종영업확도 `확정` 건의 공급가를 계약일 기준으로 집계(11.2, 11.3).
- Cloud = 제품/서비스에 `(Cloud)`(대소문자 무시)가 들어간 건(11.3).
- 행 키 = `영업코드::제품/서비스`. `번호`는 키로 쓰지 않음(11.3).
- 업무관리시스템 엑셀, 그 엑셀로 만든 DB 파일, 데이터 폴더는 저장소에 올리지 않는다(`.gitignore`). 테스트는 지어낸 작은 데이터로만 쓴다.
- 화면 문구는 보고서체 한국어(개조식, 명사형). 번역투 금지. 사용자 예시 이름은 `홍길동`.

## Review Focus

1. **첫 엑셀 업로드:** 비교할 이전 스냅샷이 없으면 7천여 행이 전부 "신규매출"로 쏟아지면 안 된다. 기준 스냅샷으로만 저장하고 변동 0건 → Task 3 `diffSnapshots` 테스트 `first import is baseline`.
2. **같은 날 다시 업로드:** 변동이 두 번 쌓이지 않고, 사람이 바꾼 구분은 유지된다 → Task 5 `reimport same date keeps manual category`.
3. **잘못된 파일:** 열 이름이 바뀌었거나 다른 엑셀을 올리면 빠진 열 이름을 알려 주고 아무것도 저장하지 않는다 → Task 2 `missing columns throws`, Task 5 `import rejects bad file without writing`.
4. **건너뛴 날짜:** 월요일·휴일 다음 날은 달력상 어제가 아니라 직전 스냅샷 날짜와 비교한다. 과거 날짜를 끼워 넣으면 그 날짜와 바로 다음 스냅샷 날짜의 변동을 다시 계산한다 → Task 5 `import between snapshots recomputes next date`.
5. **사용 중인 구분 삭제:** 그 구분이 붙은 변동은 사라지지 않고 "미분류"로 옮겨진다 → Task 5 `deleting category moves changes to unclassified`.

---

## File Structure

```
.gitignore                                   # 추가: *.xlsx, *.xls, app/data/, app/apps/server/data/
app/                                         # litpage f55fead 사본 (LICENSE, THIRD_PARTY_NOTICES.md 포함)
  package.json, pnpm-workspace.yaml          # 그대로
  packages/biz/                              # 새 패키지: 업무 로직(순수 TS, 포팅 기준)
    package.json                             # name "@nc/biz"
    src/types.ts                             # SalesRow, Change, Summary, Targets, Category, 상수
    src/normalize.ts                         # 엑셀 표 → SalesRow[]
    src/diff.ts                              # 전일 비교·변동 분류
    src/summary.ts                           # 매출 집계, 월별, 진행 중 목록
    src/*.test.ts
  apps/server/src/biz/
    store.ts                                 # biz_* 테이블과 읽기·쓰기
    excel.ts                                 # exceljs로 첫 시트 → unknown[][]
    pages.ts                                 # 날짜별 업무보고·매출 페이지 생성(전일 복사/양식)
    store.test.ts, pages.test.ts
  apps/server/src/api/modules/biz.ts         # biz* RPC
  apps/server/src/api/extra.ts               # 수정: 비활성 모듈 건너뛰기
  apps/server/scripts/biz-user.ts            # 계정 생성 스크립트
  apps/web/src/features/biz/
    api.ts                                   # biz* RPC 호출
    CalendarPage.tsx, calendar.css
    hiring.block.tsx, schedule.block.tsx     # 업무보고 블록
    salesSummary.block.tsx, changes.block.tsx, monthlyChart.block.tsx, pipeline.block.tsx
    CategoryManager.tsx, ExcelUpload.tsx
    slash.block.tsx                          # '/' 메뉴 "업무" 묶음 (블록 타입 없음, 자동 로드용 이름)
    trim.ts                                  # 빼는 기능 숨김
    biz.css
  apps/web/src/lib/router.ts                 # 수정: calendar 경로
  apps/web/src/features/shell/Workspace.tsx  # 수정: home·calendar → CalendarPage
  apps/web/src/features/shell/Sidebar.tsx    # 수정: "업무" 묶음
  packages/shared/src/records.ts             # 수정: BlockType에 biz_* 추가
```

---

### Task 1: litpage 가져오기, 실행, 0단계 점검

**Files:**
- Create: `app/` (litpage `f55fead` 전체, `.git` 제외)
- Modify: `.gitignore`
- Create: `docs/agent_dev_log/2026-11-2x.md` 해당 날짜 세션 기록(AGENTS.md 규칙)

**Interfaces:**
- Produces: `app/`에서 `pnpm install`, `pnpm dev`, `pnpm test`, `pnpm build`, `pnpm start`가 동작하는 상태

- [ ] **Step 1: pnpm 설치 확인** — `pnpm --version`이 없으면 사용자 승인 후 `npm install -g pnpm@10.32.1`. Expected: `10.32.1`
- [ ] **Step 2: 복사** — `git clone https://github.com/litmers-dev/litpage <tmp>` 후 `git -C <tmp> checkout f55fead`, `.git`을 뺀 전체를 `app/`으로 복사. `app/LICENSE`, `app/THIRD_PARTY_NOTICES.md`가 있어야 함
- [ ] **Step 3: `.gitignore`에 추가** — `*.xlsx`, `*.xls`, `app/data/`, `app/apps/server/data/`, `node_modules/`, `app/apps/web/dist/`
- [ ] **Step 4: 설치와 기존 테스트** — Run: `cd app && pnpm install && pnpm test` Expected: 전 패키지 vitest 통과(실패가 있으면 목록을 개발 로그에 적고, 우리 작업과 무관한 실패인지 판단)
- [ ] **Step 5: 실행** — Run: `cd app && pnpm dev` Expected: `http://127.0.0.1:5173` 접속, 이메일 입력 시 개발용 로그인 코드가 화면에 표시되고 로그인 가능
- [ ] **Step 6: 0단계 점검(수동)** — 다음을 브라우저에서 확인하고 결과를 개발 로그에 기록. 하나라도 실패하면 진행을 멈추고 사용자에게 보고(설계 6.2: 미달 시 BlockNote 전환 판단)
  - 한국어 입력: 제목·본문·표 셀에서 `업무보고 테스트입니다`를 입력했을 때 조합 중 글자 깨짐·중복 없음
  - 창 폭 390px(모바일)에서 페이지 편집 가능
  - 두 브라우저 창에서 같은 페이지 동시 편집 시 양쪽에 반영
- [ ] **Step 7: Commit** — `git add .gitignore app docs/agent_dev_log && git commit -m "chore: litpage(f55fead) 가져오기"`

---

### Task 2: `@nc/biz` 패키지 — 타입과 엑셀 행 정규화

**Files:**
- Create: `app/packages/biz/package.json`, `app/packages/biz/tsconfig.json`(packages/shared 설정 참고), `app/packages/biz/src/types.ts`, `app/packages/biz/src/normalize.ts`, `app/packages/biz/src/normalize.test.ts`

**Interfaces:**
- Produces (`types.ts`):

```ts
export interface SalesRow {
  key: string;            // `${code}::${product}`
  code: number;           // 영업코드
  product: string;        // 제품/서비스
  division: string;       // 구분 ('본 영업' | '기획영업' | …)
  rep: string;            // 영업대표
  customer: string;       // 사용고객
  contractor: string;     // 계약사
  amount: number;         // 공급가
  progress: string;       // 영업진행사항
  contractDate: string | null; // 계약일 'YYYY-MM-DD'
  startDate: string | null;    // 영업개시일 'YYYY-MM-DD'
  probability: string;    // 최종영업확도 ('' 허용)
  isCloud: boolean;
}
export type ChangeKind = 'new' | 'confirm' | 'exclude' | 'raise' | 'unclassified';
export interface FieldDiff { field: 'amount' | 'probability' | 'progress' | 'contractDate'; before: string | number | null; after: string | number | null }
export interface Change { key: string; kind: ChangeKind; delta: number; before: SalesRow | null; after: SalesRow | null; diffs: FieldDiff[] }
export interface Category { id: string; label: string; position: number; system: boolean }
export interface Targets { year: number; annual: number; quarters: [number, number, number, number]; months: number[] } // months.length === 12
export interface Summary {
  date: string; year: number; quarter: 1 | 2 | 3 | 4; month: number;
  annualActual: number; quarterActual: number; monthActual: number;
  annualTarget: number; quarterTarget: number; monthTarget: number;
}
export const REQUIRED_COLUMNS = ['구분', '영업대표', '영업코드', '사용고객', '계약사', '제품/서비스', '공급가', '영업진행사항', '계약일', '영업개시일', '최종영업확도'] as const;
export const MAIN_DIVISION = '본 영업';
export const OPEN_PROGRESS = ['진행', '장기관리'];
export const CONFIRMED = '확정';
export const LOW_PROBABILITY = ['하', '매우낮음'];
export const EXCLUDE_PROGRESS = ['보류', '실패'];
export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'raise', label: '목표매출 상향', position: 1, system: false },
  { id: 'new', label: '신규매출', position: 2, system: false },
  { id: 'advance', label: '매출일정 앞당김', position: 3, system: false },
  { id: 'exclude', label: '목표매출 제외', position: 4, system: false },
  { id: 'confirm', label: '확정 전환', position: 5, system: false },
  { id: 'unclassified', label: '미분류', position: 99, system: true },
];
export function isMain(r: SalesRow): boolean;
export function isOpen(r: SalesRow): boolean;
export function isConfirmed(r: SalesRow): boolean;
```

- Produces (`normalize.ts`): `export class SalesImportError extends Error { missing: string[] }`, `export function normalizeRows(table: unknown[][]): { rows: SalesRow[]; warnings: string[] }`

- [ ] **Step 1: Write the failing tests** (`normalize.test.ts`)

```ts
const HEAD = ['번호','구분','영업대표','영업코드','사용고객','계약사','제품/서비스','공급가','영업진행사항','계약일','로그수','영업개시일','마지막 로그일','최종영업확도'];
test('maps a row', () => {
  const { rows } = normalizeRows([HEAD, [1, '본 영업', '홍길동', 8225, '고객사 A', '협력사 A', 'CF v4.0(Cloud)', 9600000, '진행', '2026-11-17 00:00:00.0', 1, '2026-11-24', null, '중A']]);
  expect(rows[0]).toEqual({ key: '8225::CF v4.0(Cloud)', code: 8225, product: 'CF v4.0(Cloud)', division: '본 영업', rep: '홍길동', customer: '고객사 A', contractor: '협력사 A', amount: 9600000, progress: '진행', contractDate: '2026-11-17', startDate: '2026-11-24', probability: '중A', isCloud: true });
});
test('empty date and null probability', () => { /* 계약일 '' → null, 확도 null → '' */ });
test('same code different products are separate rows', () => { /* 8220::A, 8220::B → 2행 */ });
test('duplicate key sums amount with a warning', () => { /* 같은 키 2행 → 1행, amount 합, warnings.length === 1 */ });
test('missing columns throws', () => {
  expect(() => normalizeRows([['번호', '구분']])).toThrow(SalesImportError);
  try { normalizeRows([['번호', '구분']]); } catch (e) { expect((e as SalesImportError).missing).toContain('영업코드'); }
});
test('column order does not matter', () => { /* 열 순서를 섞어도 같은 결과 */ });
test('blank trailing rows are skipped', () => { /* 영업코드가 비어 있는 행은 건너뜀 */ });
```

- [ ] **Step 2: Run** `cd app && pnpm --filter @nc/biz test` → FAIL(모듈 없음)
- [ ] **Step 3: Implement** `types.ts`, `normalize.ts` — 헤더는 첫 행에서 이름으로 찾음(공백 trim). 숫자 열은 `Number()`, 날짜는 앞 10자(`YYYY-MM-DD`) 사용
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** `feat(biz): 엑셀 행 정규화와 업무 타입`

---

### Task 3: 전일 비교와 변동 분류

**Files:**
- Create: `app/packages/biz/src/diff.ts`, `app/packages/biz/src/diff.test.ts`

**Interfaces:**
- Consumes: Task 2 `SalesRow`, `Change`, 상수, `isMain`
- Produces: `export function diffSnapshots(prev: SalesRow[] | null, curr: SalesRow[]): Change[]` — `prev === null`(첫 업로드)이면 `[]`. 대상은 `before` 또는 `after`가 `isMain`인 키만

분류 규칙(설계 11.4). 한 키에 여러 변화가 있으면 위에서부터 첫 번째:

| 순서 | 조건 | kind | delta |
|---|---|---|---|
| 1 | prev에 없고 curr에 있음 | `new` | `+after.amount` |
| 2 | curr에 없음(삭제) | `exclude` | `-before.amount` |
| 3 | 확도가 `확정`이 아니었다가 `확정`이 됨 | `confirm` | `after.amount - before.amount` |
| 4 | 확도가 LOW가 아니었다가 LOW가 됨, 또는 진행사항이 EXCLUDE가 아니었다가 EXCLUDE가 됨 | `exclude` | `-before.amount` |
| 5 | 공급가 증가 | `raise` | `after.amount - before.amount` |
| 6 | amount·probability·progress·contractDate 중 하나라도 변함 | `unclassified` | `after.amount - before.amount` |

`diffs`에는 바뀐 필드(위 4개)만 넣는다. 결과는 `|delta|` 내림차순, 같으면 key 오름차순.

- [ ] **Step 1: Write the failing tests** — 이름과 기대값:
  - `first import is baseline`: `diffSnapshots(null, [rowA])` → `[]`
  - `no change yields nothing`: 같은 배열 → `[]`
  - `new row`: kind `new`, delta = 공급가
  - `removed row`: kind `exclude`, delta = −이전 공급가
  - `confirm wins over raise`: 확도 `중A→확정` + 공급가 100→120 → kind `confirm`, delta 20
  - `drop to low probability`: `중B→하` → `exclude`, delta = −공급가
  - `progress to 보류`: `진행→보류` → `exclude`
  - `amount up`: 100→150 → `raise`, delta 50, diffs = `[{field:'amount',before:100,after:150}]`
  - `amount down is unclassified`: 150→100 → `unclassified`, delta −50
  - `non-main rows ignored`: division `기획영업`만 바뀐 경우 → `[]`
  - `text-only change ignored`: 고객명만 바뀜 → `[]`
- [ ] **Step 2: Run** `pnpm --filter @nc/biz test diff` → FAIL
- [ ] **Step 3: Implement** `diffSnapshots` (prev/curr를 key로 Map화)
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** `feat(biz): 전일 비교와 변동 자동 분류`

---

### Task 4: 매출 집계

**Files:**
- Create: `app/packages/biz/src/summary.ts`, `app/packages/biz/src/summary.test.ts`, `app/packages/biz/src/index.ts`(전부 re-export)

**Interfaces:**
- Produces:
  - `export function summarize(rows: SalesRow[], targets: Targets | null, date: string): Summary` — 실적 = `isMain && isConfirmed && contractDate`가 해당 연/분기/월인 건의 공급가 합. 목표가 없으면 0
  - `export function monthlyConfirmed(rows: SalesRow[], year: number): number[]` — 길이 12
  - `export function openPipeline(rows: SalesRow[]): SalesRow[]` — `isMain && isOpen`, startDate 내림차순(null은 끝)
  - `export function emptyTargets(year: number): Targets`

- [ ] **Step 1: Write the failing tests**
  - `confirmed in period only`: 2026-11-25 기준, 확정·계약일 2026-11-03(300) / 확정·2026-08-01(200) / 확정·2025-12-01(999) / 중A·2026-11-10(500) → annual 500, quarter(4분기) 300, month 300
  - `cloud rows count as main`: Cloud 제품도 `본 영업`이면 포함
  - `no contract date excluded`: 확정이지만 계약일 null → 집계 제외
  - `targets copied`: targets.quarters[3]=540, months[10]=140 → quarterTarget 540, monthTarget 140
  - `monthlyConfirmed puts amounts in month slots`
  - `openPipeline filters and sorts`
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** `pnpm --filter @nc/biz test` → 전체 PASS
- [ ] **Step 5: Commit** `feat(biz): 매출 집계와 진행 중 목록`

---

### Task 5: 서버 저장소와 biz RPC

**Files:**
- Create: `app/apps/server/src/biz/store.ts`, `app/apps/server/src/biz/excel.ts`, `app/apps/server/src/api/modules/biz.ts`, `app/apps/server/src/biz/store.test.ts`
- Modify: `app/apps/server/package.json` — 의존성 `@nc/biz: workspace:*`, `exceljs`

**Interfaces:**
- Consumes: `@nc/biz` 전체, litpage `db`(`../db.ts`), `ApiError`, `Ctx`(`../api/handlers.ts`)
- Tables (`store.ts`가 시작 시 `CREATE TABLE IF NOT EXISTS`):
  - `biz_snapshot(date TEXT, key TEXT, row_json TEXT, PRIMARY KEY(date, key))`
  - `biz_change(date TEXT, key TEXT, kind TEXT, category_id TEXT, manual INTEGER, delta INTEGER, change_json TEXT, PRIMARY KEY(date, key))`
  - `biz_category(id TEXT PRIMARY KEY, label TEXT, position INTEGER, system INTEGER)` — 비어 있으면 `DEFAULT_CATEGORIES` 넣음
  - `biz_target(year INTEGER PRIMARY KEY, json TEXT)`
  - `biz_daily_page(date TEXT, kind TEXT, page_id TEXT, PRIMARY KEY(date, kind))`
  - `biz_kv(k TEXT PRIMARY KEY, v TEXT)`
- Produces (`store.ts`):
  - `importSnapshot(date: string, rows: SalesRow[]): { changeCount: number; baseline: boolean }` — 한 트랜잭션. 그 날짜 스냅샷 교체 → 그 날짜 변동 재계산(직전 스냅샷 날짜 기준) → 다음 스냅샷 날짜가 있으면 그 날짜 변동도 재계산. 재계산 시 같은 키의 `manual=1` 구분은 유지
  - `prevSnapshotDate(date: string): string | null`, `snapshotRows(date: string): SalesRow[] | null`
  - `changesFor(date: string): (Change & { categoryId: string; manual: boolean })[]`
  - `listCategories(): Category[]`, `saveCategory(c: { id?: string; label: string }): Category`, `deleteCategory(id: string): void`(system이면 거부, 쓰던 변동은 `unclassified`로), `setChangeCategory(date: string, key: string, categoryId: string): void`(manual=1)
  - `getTargets(year: number): Targets`, `setTargets(t: Targets): void`
  - kind → 기본 categoryId: `new→new`, `confirm→confirm`, `exclude→exclude`, `raise→raise`, `unclassified→unclassified`
- Produces (`excel.ts`): `readFirstSheet(buf: Buffer): Promise<unknown[][]>` — exceljs로 첫 시트의 셀 값을 행 배열로
- Produces (RPC, `modules/biz.ts`의 `handlers`, 모두 로그인 필요):
  - `bizImportSales({ date, fileBase64 }) → { date, rowCount, changeCount, baseline, warnings }` — 정규화 실패 시 `ApiError(400)`에 빠진 열 이름 포함, 아무것도 저장 안 함
  - `bizSalesView({ date }) → { date, prevDate, hasSnapshot, summary, dayDelta, changes, categories, monthly, pipeline }` — `summary`는 그 날짜 스냅샷(없으면 그 이전 최신) 기준, `dayDelta` = 그날 변동 delta 합
  - `bizCalendar({ month: 'YYYY-MM' }) → { days: { date, reportPageId: string | null, salesPageId: string | null, hasSnapshot: boolean, dayDelta: number }[] }`
  - `bizCategories()`, `bizSaveCategory({ id?, label })`, `bizDeleteCategory({ id })`, `bizSetChangeCategory({ date, key, categoryId })`, `bizGetTargets({ year })`, `bizSetTargets(Targets)`
- `date` 형식은 `YYYY-MM-DD`가 아니면 `ApiError(400)`

- [ ] **Step 1: Write the failing tests** (`store.test.ts`, vitest, `NC_DATA_DIR`를 임시 폴더로 지정한 뒤 import)
  - `first import is baseline` → `{ changeCount: 0, baseline: true }`
  - `second import produces changes` (11-24 → 11-25 공급가 상승 1건) → `changesFor('2026-11-25')` 길이 1, categoryId `raise`
  - `reimport same date keeps manual category` — 11-25 변동을 `advance`로 수동 지정 → 같은 파일로 11-25 재업로드 → 여전히 `advance`, 변동 1건
  - `import between snapshots recomputes next date` — 11-20, 11-25 업로드 후 11-24 삽입 → 11-25 변동이 11-24 기준으로 바뀜
  - `monday compares to friday` — 11-20(금), 11-23(월) → `prevSnapshotDate('2026-11-23') === '2026-11-20'`
  - `deleting category moves changes to unclassified`
  - `system category cannot be deleted` → throws
  - `import rejects bad file without writing` — RPC `bizImportSales`에 헤더가 틀린 표 → 400, `snapshotRows(date)`는 null
- [ ] **Step 2: Run** `cd app && pnpm --filter @nc/server test biz` → FAIL
- [ ] **Step 3: Implement** `store.ts`, `excel.ts`, `modules/biz.ts`
- [ ] **Step 4: Run** → PASS. 추가 확인(수동, 실제 파일은 저장소 밖): 개발 서버에서 `C:\Users\sentinel\Downloads\sales (1).xlsx`를 `bizImportSales`로 올리면 `rowCount` 7,208(키 중복 1건 합산), `baseline: true`
- [ ] **Step 5: Commit** `feat(server): 업무 데이터 저장과 biz RPC`

---

### Task 6: 날짜별 업무 페이지 생성

**Files:**
- Create: `app/apps/server/src/biz/pages.ts`, `app/apps/server/src/biz/pages.test.ts`
- Modify: `app/apps/server/src/api/modules/biz.ts` (RPC 추가), `app/packages/shared/src/records.ts` (BlockType에 `'biz_hiring' | 'biz_schedule' | 'biz_sales_summary' | 'biz_changes' | 'biz_monthly_chart' | 'biz_pipeline'` 추가)

**Interfaces:**
- Consumes: litpage `TreeCopier`(`../dbcopy.ts`), `saveRecord`(`../seed.ts`), `getRecord`, Task 5 `biz_daily_page`, `biz_kv`
- Produces:
  - `ensureDailyPage(userId: string, spaceId: string, date: string, kind: 'report' | 'sales'): string` — 있으면 기존 page id. 없으면 생성 후 `biz_daily_page`에 기록
  - RPC `bizEnsureDailyPage({ date, kind }) → { pageId }`
  - RPC `bizPageDate({ pageId }) → { date: string | null; kind: 'report' | 'sales' | null }` — 페이지가 날짜별 업무 페이지면 그 날짜(Task 10의 '/' 메뉴가 사용)
- 부모 페이지: 워크스페이스 최상위에 `일일 업무보고`, `본영업 목표매출 관리 현황` 페이지를 처음 한 번 만들고 id를 `biz_kv`(`parent:report`, `parent:sales`)에 저장
- 페이지 제목: `업무보고 2026-11-25(수)`, `본영업 목표매출 2026-11-25(수)`(요일 한 글자)
- `report`: 이전 날짜 중 가장 최근 업무보고 페이지가 있으면 그 하위 블록을 TreeCopier로 복사(전일 내용 반영). 없으면 양식: `header "인사 관리"` → `biz_hiring` → `header "주요 보고"` → 빈 `numbered_list` → `header "당일 일정"` → `biz_schedule`
- `sales`: 복사하지 않고 매번 양식: `biz_sales_summary` → `biz_changes` → `biz_monthly_chart` → `biz_pipeline`. 각 블록 `format.biz = { date }`
- 서버 레코드 검증이 모르는 블록 타입을 거부하면 `records.ts`/`applyTransactions`의 허용 목록에도 biz 타입 추가

- [ ] **Step 1: Write the failing tests**
  - `first report page uses template` — 자식 블록 타입 순서가 위 양식과 같음
  - `next day copies previous report` — 11-24 페이지의 `biz_hiring` format을 바꾼 뒤 11-25 생성 → 같은 값
  - `skips gaps` — 11-20 페이지만 있을 때 11-23 생성 → 11-20 내용 복사
  - `ensure is idempotent` — 같은 날짜 두 번 → 같은 id
  - `sales blocks carry date` — 모든 자식의 `format.biz.date === '2026-11-25'`
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** → PASS, `pnpm --filter @nc/server test` 전체 PASS
- [ ] **Step 5: Commit** `feat(server): 날짜별 업무보고·매출 페이지 생성`

---

### Task 7: 캘린더 첫 화면

**Files:**
- Create: `app/apps/web/src/features/biz/api.ts`, `CalendarPage.tsx`, `calendar.css`
- Modify: `app/apps/web/src/lib/router.ts` (route `{ name: 'calendar'; domain: string }` ← `/<domain>/calendar`), `app/apps/web/src/features/shell/Workspace.tsx` (route `home`·`calendar`에서 `CalendarPage` 렌더), `app/apps/web/src/features/shell/Sidebar.tsx` (맨 위 "업무" 묶음: 캘린더, 일일 업무보고, 본영업 목표매출 관리 현황 — 뒤 둘은 부모 페이지로 이동)

**Interfaces:**
- Consumes: RPC `bizCalendar`, `bizEnsureDailyPage` (Task 5·6), litpage `navigate`, 페이지 경로 생성 함수(router.ts의 기존 page 링크 방식)
- Produces: `api.ts`의 `biz.calendar(month)`, `biz.ensurePage(date, kind)`, `biz.salesView(date)`, `biz.importSales(date, file: File)`, `biz.categories()`, `biz.saveCategory(c)`, `biz.deleteCategory(id)`, `biz.setChangeCategory(date, key, categoryId)`, `biz.getTargets(year)`, `biz.setTargets(t)` — 각각 RPC 응답 타입 그대로 반환

화면(설계 5.1):
- 월 이동(이전·다음·오늘), 일~토 7열 달력
- 날짜 칸: 일자, 업무보고 있음 표시, 매출 스냅샷 있음 표시, 증감액(`+1,234,000 ▲` 파랑 / `−… ▼` 주황, 0이면 표시 없음)
- 날짜 클릭 → 아래 패널에 "일일 업무보고", "본영업 목표매출" 두 버튼 → `ensurePage` 후 해당 페이지로 이동
- 오늘 칸 강조

- [ ] **Step 1: Implement** 위 파일
- [ ] **Step 2: Verify(수동)** — `pnpm dev` → 로그인 직후 첫 화면이 캘린더. Task 5에서 올린 날짜 칸에 매출 표시. 날짜 → "일일 업무보고" → 양식 페이지 열림, 다시 캘린더로 와서 같은 날짜 → 같은 페이지. 창 폭 390px에서 달력이 가로 스크롤로 보이고 날짜 패널이 아래로 쌓임
- [ ] **Step 3: Run** `cd app && pnpm --filter @nc/web typecheck` → 오류 없음
- [ ] **Step 4: Commit** `feat(web): 캘린더 첫 화면과 업무 사이드바`

---

### Task 8: 업무보고 블록 (채용 현황, 일정)

**Files:**
- Create: `app/apps/web/src/features/biz/hiring.block.tsx`, `schedule.block.tsx`, `biz.css`

**Interfaces:**
- Consumes: `registerBlock`(`../editor/Block.tsx`), `BlockProps`, 블록 format 갱신 방식(기존 블록의 format 변경 코드, 예: callout 색 변경 경로를 따라 같은 트랜잭션 API 사용)
- 데이터는 블록 `format.biz`에 저장 → litpage 동시 편집·수정 이력을 그대로 탐
  - `biz_hiring`: `{ sites: string; rows: { role: string; status: string; note: string }[]; applicants: number | null }` — 기본 행: 전략기획실, 엔지니어, 경리 및 총무, 경영지원, 병역일터(현황 `해당자 없음`)
  - `biz_schedule`: `{ items: { start: string; end: string; text: string }[] }` — 오전(12:00 이전)/오후로 나눠 표시. 상단에 `업무관리시스템 연동 예정 · 현재 직접 입력` 안내

- [ ] **Step 1: Implement** — 셀은 그 자리에서 고치는 입력칸, 행 추가·삭제 버튼, `readOnly`면 보기만
- [ ] **Step 2: Verify(수동)** — 업무보고 페이지에서 채용 현황 한 칸 수정 → 새로고침해도 유지 → 다음 날짜 페이지 생성 시 이어받음. 두 창에서 같은 블록 수정 시 양쪽 반영. 한국어 입력 깨짐 없음
- [ ] **Step 3: Run** `pnpm --filter @nc/web typecheck` → 오류 없음
- [ ] **Step 4: Commit** `feat(web): 채용 현황·일정 블록`

---

### Task 9: 매출 블록, 엑셀 업로드, 구분 관리

**Files:**
- Create: `app/apps/web/src/features/biz/salesSummary.block.tsx`, `changes.block.tsx`, `monthlyChart.block.tsx`, `pipeline.block.tsx`, `ExcelUpload.tsx`, `CategoryManager.tsx`
- Modify: `app/apps/web/package.json` — 의존성 `echarts`

**Interfaces:**
- Consumes: `biz.salesView(date)`(날짜는 `block.format.biz.date`), `biz.importSales`, 구분 RPC, `biz.setTargets`
- 블록 내용(설계 5.4, 11.3):
  - `biz_sales_summary`: 당일 증감액(▲▼, 변동 건수, 비교 기준일 `prevDate`), 연간·분기·월 실적/목표/달성률. 목표가 0이면 `목표 미설정` + 입력 버튼(연·분기 4개·월 12개 입력 모달 → `setTargets`). 상단 오른쪽에 `엑셀 업로드` 버튼(`ExcelUpload`). 스냅샷이 없으면 업로드 안내만
  - `biz_changes`: 표 — 고객, 구분(선택 상자, 바꾸면 `setChangeCategory`), 제품, 공급가(이전 값이 다르면 아래 `기존 …`), 증감액, 확도(`기존 …`), 진행사항(`기존 …`), 영업대표. `구분 관리` 버튼 → `CategoryManager`(추가·이름 변경·삭제, `미분류`는 삭제 불가). 기준 업로드 날짜면 `기준 데이터 — 다음 업로드부터 변동 표시`
  - `biz_monthly_chart`: ECharts 막대 — 그해 월별 확정 매출(`monthly`), 월 목표가 있으면 선으로 겹침
  - `biz_pipeline`: 진행 중 건 표(고객, 제품, 공급가, 확도, 영업대표, 영업개시일, Cloud 표시), 50건 단위 더 보기
- `ExcelUpload`: `.xlsx`만 받음. 업로드 후 결과 토스트(`7,208건 반영 · 변동 12건`, 기준이면 `기준 데이터로 저장`), 오류면 서버 메시지(빠진 열 이름) 표시. 성공 시 같은 페이지의 매출 블록 전부 다시 불러옴
- 금액 표시: 천 단위 쉼표 + `원`, 증감은 부호와 ▲▼, 파랑=증가·주황=감소(설계 색 규칙)

- [ ] **Step 1: Implement**
- [ ] **Step 2: Verify(수동, 실제 파일은 저장소 밖)** — 11-24 날짜 매출 페이지에서 `sales (1).xlsx` 업로드 → 기준 데이터 표시. 공급가 한 행을 고친 사본을 만들어 11-25에 업로드 → 변동 1건(`목표매출 상향`), 구분을 `매출일정 앞당김`으로 바꾸고 새로고침 → 유지. 헤더를 지운 파일 → 오류 메시지에 빠진 열 이름
- [ ] **Step 3: Run** `pnpm --filter @nc/web typecheck` → 오류 없음
- [ ] **Step 4: Commit** `feat(web): 매출 블록·엑셀 업로드·구분 관리`

---

### Task 10: '/' 메뉴 "업무" 묶음과 기능 정리

**Files:**
- Create: `app/apps/web/src/features/biz/slash.block.tsx`, `app/apps/web/src/features/biz/trim.ts`
- Modify: `app/apps/server/src/api/extra.ts`(비활성 모듈 건너뛰기), `app/apps/server/src/app.ts`(`/v1/*` 공개 REST·웹훅, `/api/mcp`, AI 스트리밍 경로 비활성), 빼는 기능의 화면 진입점이 있는 shell 파일(Topbar·Sidebar·설정 섹션)

**Interfaces:**
- `slash.block.tsx`: `registerSlashItems`로 section `업무`에 6개 — `채용 현황`(biz_hiring), `일정`(biz_schedule), `매출 요약`, `변동사항`, `월별 매출 차트`, `진행 중 영업 건`. 매출 블록은 `format.biz.date`를 `bizPageDate`(Task 6)로 얻은 현재 페이지 날짜로, 날짜별 페이지가 아니면 오늘 날짜로 채움
- `trim.ts`(registerAll 이후 로드): `viewRegistry`에서 `board`, `gallery`, `dashboard`, `feed`, `form`, `map` 삭제(설정 레지스트리 포함), AI·댓글 관련 슬래시 항목은 `hideSlashItemWhen(id, () => true)`
- 서버 `extra.ts`: `DISABLED_MODULES = ['ai.ts', 'aiImage.ts', 'agents.ts', 'automations.ts', 'comments.ts', 'sites.ts', 'forms.ts', 'developer.ts', 'meetings.ts', 'formulaAi.ts']`는 로드하지 않음. `sharing.ts`는 핵심 권한 RPC와 섞여 있을 수 있으므로 공개 링크·게시 관련 핸들러 이름만 막음
- 화면에서 숨길 진입점: AI 채팅·에이전트·미팅 메뉴, 공유 버튼의 "웹에 게시"·공개 링크, 댓글 버튼·댓글 사이드바, 자동화 메뉴, 설정의 개발자(토큰·웹훅) 섹션, 회원가입 링크

- [ ] **Step 1: Implement**
- [ ] **Step 2: Run** `cd app && pnpm test` → 전체 PASS(비활성 모듈의 테스트가 실패하면 그 테스트 파일도 같은 목록으로 제외하고 개발 로그에 기록)
- [ ] **Step 3: Verify(수동)** — `/` 입력 시 "업무" 묶음 6개 보임, AI 항목 없음. 데이터베이스 보기 추가 메뉴에 표·리스트·캘린더·타임라인·차트만. 페이지 상단에 댓글·웹 게시 없음. 기존 편집·데이터베이스·수정 이력은 그대로 동작
- [ ] **Step 4: Commit** `feat: 업무 슬래시 메뉴와 제외 기능 정리`

---

### Task 11: 계정, 실행 방법, 시연 준비

**Files:**
- Create: `app/apps/server/scripts/biz-user.ts`, `docs/demo.md`
- Modify: `docs/agent_dev_log/<날짜>.md`

**Interfaces:**
- `biz-user.ts`: `node --import ./src/loadEnv.ts scripts/biz-user.ts <email> <password> [name]` — `createUser`, `setPassword`, 첫 워크스페이스에 `addMember(spaceId, userId, 'editor')`. 이미 있으면 비밀번호만 갱신
- 첫 계정은 litpage `NC_BOOTSTRAP_EMAIL`/`NC_BOOTSTRAP_PASSWORD`로 생성
- `docs/demo.md`: 설치(`pnpm install`), 빌드(`pnpm build`), 실행(`NC_DATA_DIR=<저장소 밖 경로> pnpm start`, `http://localhost:3001`), 계정 만들기, 시연 순서(로그인 → 캘린더 → 업무보고 작성 → 매출 페이지 → 엑셀 업로드 → 변동사항·구분 변경 → '/' 업무 블록), 데이터 초기화 방법. 엑셀과 데이터 폴더는 저장소 밖이라는 주의

- [ ] **Step 1: Implement**
- [ ] **Step 2: Verify(수동)** — 프로덕션 빌드로 실행 → 스크립트로 만든 `홍길동` 계정 로그인 → `docs/demo.md` 시연 순서를 처음부터 끝까지 한 번 통과
- [ ] **Step 3: Run** `cd app && pnpm test && pnpm --filter @nc/web typecheck` → PASS
- [ ] **Step 4: Commit** `docs: 시연 실행 방법과 계정 스크립트`

---

## 계획에서 일부러 뺀 것 (시연 후)

- Python(FastAPI) 포팅, PostgreSQL 전환, Docker 배포(설계 8장, 11.1)
- DB 작업 테이블·LISTEN/NOTIFY: 시연판은 업로드 요청 안에서 바로 처리(7천 행 규모라 충분)
- 업무관리시스템 API 연동, 일정 자동 수집, 영업활동·계약/매출/수금 블록(엑셀에 해당 열 없음, 설계 11.3)
- 목표 대비 예상 계산식(미확정) — 시연판은 달성률(실적/목표)만 표시
