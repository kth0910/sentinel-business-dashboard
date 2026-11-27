# 핵심 편집·실시간 공동 편집 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 로그인 후 워크스페이스를 만들고, 페이지를 열어 편집하고, 같은 페이지를 연 다른 사람에게 편집 내용과 커서 위치가 실시간으로 보이게 한다. AI 기능은 화면에서 숨긴다.

**Architecture:** litpage 서버의 "레코드 저장소 + 연산(operation) 적용 + 웹소켓 방송" 구조를 FastAPI·PostgreSQL로 옮긴다. 모든 노션 데이터(페이지·블록·워크스페이스·팀스페이스·사이드바 등)는 `records` 테이블 하나에 JSONB로 저장하고, 쓰기는 `applyChanges` RPC 하나로 받아 권한을 확인한 뒤 버전을 올리고, 커밋 후 `/ws` 웹소켓으로 같은 워크스페이스 사용자에게 보낸다. 동시 편집 충돌은 CRDT가 아니라 litpage와 같은 방식(경로 단위 나중 쓰기 우선 + 텍스트는 `spliceText` 범위 재계산)으로 푼다.

**Tech Stack:** Python 3.15, FastAPI(WebSocket 포함), SQLAlchemy 2.0 async + psycopg 3, PostgreSQL 17(JSONB), Alembic, pytest. 화면은 기존 React 19 + Vite(가져온 litpage 코드).

**Spec:** `docs/superpowers/specs/2026-11-25-daily-report-dashboard-design.md` (0장·0.1장이 우선)

**범위:** 노션 기능 전체(AI 제외) 중 첫 묶음이다. 이 계획이 끝나면 "워크스페이스 만들기 → 페이지 편집 → 두 사람 실시간 편집"까지 된다. 업로드, 검색, 데이터베이스 서버 기능, 댓글·알림, 공유·멤버 관리, 기록·휴지통, 사이트·양식, 가져오기·내보내기, 자동화는 다음 계획들에서 원본 순서대로 옮긴다. 하이웍스 메일 로그인은 방식이 정해지면 별도 계획.

**참고 원본(포팅 기준):** litpage f55fead 서버 코드. 저장소 밖 `C:\Users\sentinel\Desktop\기획\litpage-ref`에 있다(없으면 `git clone https://github.com/litmers-dev/litpage.git ../litpage-ref && git -C ../litpage-ref checkout f55fead`). 이 계획에서 "원본"은 이 폴더를 뜻한다. 원본을 실행하거나 설치하지 않는다(읽기만).

## Global Constraints

- 화면에 새로 보이는 문구는 모두 한국어. 제품 이름은 `CoolNotion!`.
- Python 3.15 시스템 인터프리터, uv `python-preference = "only-system"`. 새 Python 패키지는 넣지 않는다(웹소켓은 이미 있는 `uvicorn[standard]`의 websockets 사용). 꼭 필요하면 3.15 지원과 서명 문제를 먼저 확인하고 계획 밖 결정으로 기록한다.
- 서버는 프로세스 하나(uvicorn 워커 1개)로 돈다. 웹소켓 허브는 메모리에 있다. 여러 워커는 이 계획 범위 밖.
- 원본 프로토콜과 같은 모양을 지킨다: RPC는 `POST /api/rpc/{name}`, 레코드 맵은 `{"__version__": 3, <table>: {<id>: {"spaceId": ..., "value": {"value": <record>, "role": <role>}}}}`, 웹소켓 메시지는 원본 `apps/server/src/realtime.ts`의 `hello`·`records`·`presence`·`pong`.
- 텍스트 위치(`spliceText`의 `start`·`end`, 리치 텍스트 길이)는 **UTF-16 코드 단위**로 센다(브라우저와 같게). 이모지 같은 BMP 밖 글자는 2로 센다.
- 레코드 테이블 이름은 원본 `packages/shared/src/records.ts`의 `TABLES` 16개를 그대로 쓴다: `block, space, space_view, team, lit_user, user_root, user_settings, collection, collection_view, discussion, comment, notification, page_visit, follow, automation, workflow`.
- 새 ID는 `str(uuid.uuid4())`(하이픈 포함, 원본 `newId()`와 같은 모양). 기존 `users.id`(하이픈 없는 hex)는 그대로 `lit_user` 등의 ID로 쓴다.
- 서버가 관리하는 필드 `version`, `applied_tx_ids`는 클라이언트가 바꿀 수 없다.
- 임시 파일(pytest 캐시, 로그, 빌드 결과)은 커밋하지 않는다. `git add`는 경로를 하나씩. 테스트는 `-p no:cacheprovider`로 돌린다.
- 백엔드 테스트 명령: `uv run --directory backend python -m pytest -q -p no:cacheprovider` (uv 전체 경로는 `.claude/launch.json` 참고). 화면 테스트: `pnpm --dir frontend/apps/web test`, 타입 검사: `pnpm --dir frontend/apps/web typecheck`.

## Review Focus

- **동시 편집 중 같은 블록 텍스트**: 두 사람이 같은 줄의 다른 위치에 동시에 글자를 넣으면 둘 다 남아야 한다 → Task 2 `test_concurrent_inserts_both_survive`, Task 6 `test_apply_changes_concurrent_splices_merge`.
- **이모지가 들어간 줄의 편집 위치**: "😀abc"의 3번째 위치에 넣으면 브라우저와 같은 자리에 들어가야 한다 → Task 2 `test_splice_counts_utf16_units`.
- **권한 없는 페이지에 쓰기**: 다른 사람의 개인 페이지 블록을 바꾸거나 그 아래에 블록을 만드는 요청은 403이고 아무것도 저장되지 않아야 한다 → Task 6 `test_cannot_edit_other_users_private_page`, `test_rejected_call_saves_nothing`.
- **같은 요청 재전송(네트워크 재시도)**: 같은 트랜잭션 ID로 두 번 보내면 한 번만 적용되고 두 번째도 200으로 현재 값을 돌려줘야 한다 → Task 6 `test_retry_is_idempotent`.
- **웹소켓 권한**: 로그인하지 않았거나 다른 사이트(Origin)에서 연결하면 거절, 내가 속하지 않은 워크스페이스 변경은 받지 않아야 한다 → Task 7 `test_ws_rejects_anonymous`, `test_ws_rejects_foreign_origin`, `test_broadcast_skips_other_workspaces`.

---

### Task 1: 레코드 저장소

**Files:**
- Create: `backend/alembic/versions/0002_records.py`
- Create: `backend/app/records/__init__.py`, `backend/app/records/store.py`
- Modify: `backend/tests/conftest.py` (새 테이블도 테스트마다 비우기 — 기존 `Base.metadata` 방식이면 자동)
- Test: `backend/tests/test_record_store.py`

**Interfaces:**
- Produces (`app/records/store.py`, 모두 `AsyncSession`을 첫 인자로 받는 async 함수. 레코드는 `dict`):
  - `TABLES: tuple[str, ...]` — Global Constraints의 16개
  - `async def get_record(db, table: str, id: str) -> dict | None`
  - `async def get_records(db, table: str, ids: list[str]) -> dict[str, dict]`
  - `async def put_record(db, table: str, rec: dict) -> None` — upsert, `changes`에 한 줄 추가. `version`은 호출하는 쪽이 정한다. 커밋하지 않는다.
  - `async def children_of(db, table: str, parent_id: str) -> list[dict]`
  - `async def records_in_space(db, table: str, space_id: str) -> list[dict]`
  - `async def current_lsn(db) -> int` — 변경이 없으면 0
  - `def new_id() -> str`
  - `def now_ms() -> int`

테이블(Alembic `0002`, SQLAlchemy Core `Table` 정의는 `store.py`에 두고 `Base.metadata`에 등록):
- `records(tbl text, id text, version bigint not null, space_id text null, parent_id text null, parent_table text null, alive boolean null, last_edited_time bigint null, data jsonb not null, PK(tbl,id))`, 인덱스 `(tbl, parent_id)`, `(tbl, space_id, last_edited_time)`
- `changes(lsn bigserial PK, tbl text, id text, space_id text null, version bigint, time bigint)`, 인덱스 `(space_id, lsn)`
- `applied_tx(id text PK, at bigint not null)`
- `put_record`는 `data`에서 `space_id`, `parent_id`, `parent_table`, `alive`, `last_edited_time`을 꺼내 열에 같이 쓴다(원본 `apps/server/src/db.ts` `putRecord`와 같다).

- [ ] **Step 1: 실패하는 테스트 작성** — `test_record_store.py`:
  - `test_put_and_get_round_trip`: `put_record(db, "block", {"id": "b1", "version": 1, "type": "text", "space_id": "s1", "parent_id": "p1", "parent_table": "block", "alive": True, "properties": {"title": [["안녕 😀"]]}})` 후 `get_record`가 같은 dict를 돌려준다(한글·이모지 그대로).
  - `test_put_record_appends_change`: 두 번 `put_record` 하면 `current_lsn`이 0 → 2.
  - `test_children_and_space_queries`: `children_of(db,"block","p1")`와 `records_in_space(db,"block","s1")`가 해당 레코드만 돌려준다.
  - `test_get_records_skips_missing`: 없는 ID는 결과에 없다.
  - `test_migration_creates_record_tables`: 기존 `test_migrations.py` 방식대로 `alembic upgrade head` 후 `records`, `changes`, `applied_tx`가 있다.
- [ ] **Step 2: 실패 확인** — `... pytest -q -p no:cacheprovider tests/test_record_store.py` → import 오류로 FAIL
- [ ] **Step 3: 구현** — 위 인터페이스대로 `store.py`와 `0002_records.py`. upsert는 PostgreSQL `INSERT ... ON CONFLICT (tbl, id) DO UPDATE`.
- [ ] **Step 4: 통과 확인** — 같은 명령, 그리고 전체 백엔드 테스트 PASS
- [ ] **Step 5: 커밋** — `git add backend/alembic/versions/0002_records.py backend/app/records/__init__.py backend/app/records/store.py backend/tests/test_record_store.py` (conftest를 고쳤으면 그것도) → `feat: 노션 레코드 저장소(records·changes·applied_tx)`

### Task 2: 리치 텍스트·연산·텍스트 병합 포팅

**Files:**
- Create: `backend/app/records/richtext.py`, `backend/app/records/ops.py`, `backend/app/records/textmerge.py`
- Test: `backend/tests/test_ops.py`, `backend/tests/test_textmerge.py`, `backend/tests/test_richtext.py`

**Interfaces:**
- Consumes: 없음(순수 함수)
- Produces:
  - `richtext.py`: `to_plain_text(rt) -> str`, `slice_rt(rt, start: int, end: int | None = None)`, `concat(*parts)`, `insert_rich(rt, offset: int, ins)`, `delete_range(rt, start: int, end: int)`, `annotations_of(d) -> list`, `length(rt) -> int`. 리치 텍스트는 원본과 같은 JSON 모양 `[[text, [annotation...]?], ...]`. 모든 위치·길이는 UTF-16 단위.
  - `textmerge.py`: `TextSplice = TypedDict(base: str, start: int, end: int, insert: list)`, `apply_splice(current, sp) -> list`, `splice_range(current, sp) -> tuple[int, int]`, `map_text_offset(src: str, dst: str, offset: int, side="start") -> int`
  - `ops.py`: `COMMANDS = {"set","update","listAfter","listBefore","listRemove","spliceText"}`, `def apply_operation(record: dict | None, op: dict) -> dict | None` (입력을 바꾸지 않음), `def get_at_path(obj, path: list[str])`, `class OperationError(ValueError)` (`__proto__`·`constructor`·`prototype` 키, 알 수 없는 명령)

원본: `frontend/packages/shared/src/{richtext,ops,textmerge}.ts`(이 저장소에 이미 있음). 동작을 한 줄씩 그대로 옮긴다. `invertOperation`·`diffSplice`·주석 토글 함수는 서버에 필요 없으므로 옮기지 않는다.

UTF-16 처리: 문자열을 다룰 때 `s.encode("utf-16-le")`를 2바이트씩 나눈 코드 단위 기준으로 자르고 붙인다(BMP 밖 글자를 반으로 자르는 위치가 와도 원본처럼 그대로 처리). 이 계산은 `richtext.py` 안의 내부 함수 두 개(`_u16_len(s)`, `_u16_slice(s, a, b)`)로 모으고 다른 파일은 그것만 쓴다.

- [ ] **Step 1: 실패하는 테스트 작성** — 이 저장소의 `frontend/packages/shared/test/ops.test.ts`(5개), `textmerge.test.ts`(9개), `richtext.test.ts`(10개) 중 위 함수에 해당하는 `it(...)`을 하나도 빼지 않고 같은 입력·같은 기대값의 pytest 함수로 옮긴다(이름은 `it` 설명을 snake_case로). 서버에서 옮기지 않는 함수(`diffSplice`, 주석 토글 등)를 쓰는 케이스는 건너뛰고 파일 맨 위 주석에 건너뛴 케이스 이름을 적는다. 그리고 다음을 추가한다:
  - `test_splice_counts_utf16_units`: `apply_splice([["😀abc"]], {"base": "😀abc", "start": 3, "end": 3, "insert": [["X"]]})` → `[["😀aXbc"]]`
  - `test_concurrent_inserts_both_survive`: 현재 `[["Hello world"]]`, base `"Hello"`(다른 사람이 " world"를 붙이기 전 상태)에서 `start=end=0`, insert `[[">"]]` → `[[">Hello world"]]`
  - `test_apply_operation_rejects_proto_key`: `apply_operation({"id":"x"}, {"pointer":{"table":"block","id":"x"},"path":["__proto__"],"command":"set","args":1})` → `OperationError`
  - `test_set_root_keeps_version`: `apply_operation({"id":"x","version":3}, set [] {"type":"text"})` → `{"type":"text","id":"x","version":3}`
- [ ] **Step 2: 실패 확인** — `... pytest -q -p no:cacheprovider tests/test_ops.py tests/test_textmerge.py tests/test_richtext.py` → FAIL
- [ ] **Step 3: 구현** — 세 파일. Myers diff의 최대 D(2000)와 "찾지 못하면 일치 없음" 처리도 원본과 같게.
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS
- [ ] **Step 5: 커밋** — 세 구현 파일과 세 테스트 파일 → `feat: 연산·리치 텍스트·텍스트 병합을 Python으로 포팅`

### Task 3: 권한 계산과 레코드 맵

**Files:**
- Create: `backend/app/records/permissions.py`, `backend/app/records/recordmap.py`
- Test: `backend/tests/test_permissions.py`, `backend/tests/test_recordmap.py`

**Interfaces:**
- Consumes: Task 1 `get_record`
- Produces:
  - `permissions.py`:
    - `RANK` (원본 값 그대로: none 0, reader 1, comment_only 2, content_only_editor 2.5, read_and_write 3, editor 4, membership_admin 5, owner 6), `max_role(a, b) -> str`, `role_at_least(role: str | None, minimum: str) -> bool`
    - `is_space_member(space: dict | None, user_id: str) -> bool`, `is_space_admin(space, user_id) -> bool`, `space_role_for(space, user_id) -> str`, `team_page_role(team, user_id, space_member: bool) -> str`
    - `class Lookup` — `__init__(self, db)`, `async block(id)`, `async space(id)`, `async team(id)`, `async collection(id)`, `async get(table, id)`; 한 요청 안에서 읽은 레코드를 기억(캐시)하고, `override(table, rec)`로 아직 저장 안 된 값을 덮어쓸 수 있다(Task 6이 사용).
    - `async def effective_role(lookup: Lookup, block_id: str, user_id: str | None) -> str`
    - `async def record_role(lookup: Lookup, table: str, rec: dict | None, user_id: str | None) -> str`
  - `recordmap.py`: `class RecordMapBuilder` — `__init__(self, lookup: Lookup, user_id: str | None)`, `async add(self, table, rec, role: str | None = None) -> None`, `has(table, id) -> bool`, 속성 `map: dict` (`{"__version__": 3, ...}`)

원본: `frontend/packages/shared/src/permissions.ts`의 `effectiveRole`·`rolesFrom`·`teamPageRole`·`spaceRoleFor`, `litpage-ref/apps/server/src/records.ts`의 `recordRole`·`RecordMapBuilder`. 다음은 **옮기지 않는다**(해당 기능 계획 때 추가): 그룹 권한, 제한 멤버(`restricted_member`), 공개 링크 끄기, 데이터베이스 속성 접근(`redactDatabaseRecord`·`propertyThreadVisible`), 데모 모드, 에이전트(`workflow`는 항상 `none`), `roleExtensions`·`principalResolvers`. `lit_user`의 이메일 숨김(`UserVisibility`)은 옮긴다: 같은 워크스페이스 멤버가 아니면 `email` 키를 뺀다(블록 내용 검색으로 찾는 부분은 빼고 워크스페이스 권한 목록만으로 판단).

- [ ] **Step 1: 실패하는 테스트 작성**
  - `test_private_page_only_for_listed_user`: 공간 `s1`(권한: u1 owner, u2 editor), 블록 `p`(parent_table space, permissions `[{"type":"user_permission","role":"editor","user_id":"u1"}]`) → u1 `editor`, u2 `none`
  - `test_workspace_page_falls_back_to_space_role`: 권한 없는 공간 직속 페이지 → u2(editor 멤버) `editor`, 비멤버 `none`
  - `test_child_block_inherits_from_page`: 블록 `c`(parent `p`) → u1 `editor`, u2 `none`
  - `test_team_page_role`: 팀(open, membership u1 owner, settings.default_page_role editor) 직속 페이지 → u1 `editor`, 팀 밖 공간 멤버 u2 `read_and_write`, private 팀이면 u2 `none`
  - `test_record_role_tables`: space(owner→`editor`, 멤버→`read_and_write`), space_view(본인→`editor`, 남→`none`), user_root·user_settings(본인만 `editor`), lit_user(본인 `editor`, 로그인한 남 `reader`, 익명 `none`), page_visit(`user_id` 본인만)
  - `test_recordmap_shape_and_skip_none`: `add`한 블록이 `map["block"][id] == {"spaceId": "s1", "value": {"value": rec, "role": "editor"}}`, 권한 `none`인 레코드는 빠진다
  - `test_recordmap_hides_email_from_non_members`: 같은 공간 멤버가 아닌 사람의 `lit_user`에는 `email` 키가 없다
- [ ] **Step 2: 실패 확인** — `... pytest -q -p no:cacheprovider tests/test_permissions.py tests/test_recordmap.py` → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: 커밋** — 두 구현 파일·두 테스트 파일 → `feat: 레코드 권한 계산과 레코드 맵`

### Task 4: 사용자 레코드, 워크스페이스 만들기, 계정 데이터

**Files:**
- Create: `backend/app/records/seed.py`, `backend/app/records/handlers.py`
- Modify: `backend/app/auth/handlers.py` (`loadAccountData`를 `app/records/handlers.py`로 옮기고 원래 것은 삭제), `backend/app/main.py` (`import app.records.handlers`)
- Test: `backend/tests/test_workspace.py`, `backend/tests/test_sign_in.py` (loadAccountData 기대값 조정)

**Interfaces:**
- Consumes: Task 1 저장소, Task 3 `Lookup`·`RecordMapBuilder`·`record_role`
- Produces:
  - `seed.py`:
    - `async def ensure_user_records(db, user: User) -> None` — `lit_user`(`id`, `email`, `name`, `given_name`, `created_time`(ms), `onboarding_completed: False`), `user_root`(`space_views: []`), `user_settings`(`settings: {"locale": "ko-KR", "time_zone": "Asia/Seoul", "start_day_of_week": 0, "preferred_theme": "system"}`)가 없을 때만 만든다(있으면 그대로). 커밋하지 않는다.
    - `async def create_workspace(db, user_id: str, name: str, icon: str | None = None) -> dict` — 원본 `seed.ts` `createWorkspace`와 같은 레코드 구조(space, team, 환영 페이지, 팀 홈, space_view, user_root 갱신), `put_record` 후 반환값은 space 레코드. 커밋하지 않는다.
  - RPC(`handlers.py`):
    - `createWorkspace {name, icon}` → `{"spaceId": str, "recordMap": {"__version__": 3}}` (이름이 비면 `"내 워크스페이스"`)
    - `loadAccountData {}` → `{"recordMap": ..., "lsn": int, "demoMode": {"enabled": False}}` — 원본 `handlers.ts` `loadAccountData`의 레코드 모음(본인 3개 레코드, 내 space_view들, 그 공간들, 공간 멤버들의 lit_user, 팀들, 사이드바 페이지 트리)과 같게. 사이드바 트리는 원본 `addPageTrees`를 따라 하위 페이지(`page`·`collection_view_page`)만 내려간다.

한국어 시작 내용(원본의 영어 문구 대신 그대로 사용):
- 팀스페이스 이름 `일반`, 아이콘 `🏠`. 팀 홈 페이지 제목 `팀 홈`, 아이콘 `🏠`, 본문 한 줄 `이 팀의 문서, 위키, 프로젝트를 모아 두는 공간입니다.`
- 개인 환영 페이지 제목 `CoolNotion!에 오신 것을 환영합니다`, 아이콘 `👋`, 본문(블록 종류 → 텍스트):
  - text `👋 CoolNotion!에 오신 것을 환영합니다. 이 페이지는 마음껏 연습해 봐도 됩니다.`
  - to_do `/ 를 입력해 제목, 콜아웃, 하위 페이지를 추가해 보세요.`
  - to_do `줄 왼쪽의 ⋮⋮ 손잡이를 끌어 순서를 바꿔 보세요.`
  - to_do `데이터베이스를 만들고 표, 보드, 캘린더 보기로 바꿔 보세요.`
  - to_do `페이지를 팀원과 공유하고 편집·댓글·읽기 권한을 골라 보세요.`
  - to_do `Ctrl + P로 페이지를 찾고, Ctrl + K로 빠른 실행을 열어 보세요.`
  - callout(`page_icon` `💡`, `block_color` `gray_background`) `Ctrl + Shift + L로 밝은 화면과 어두운 화면을 바꿀 수 있습니다.`
- space `settings`: `{"allow_members_to_create_pages": True, "allow_guests": False, "allow_public_pages": False}` (사내용이므로 게스트·공개 페이지는 기본으로 끔), `plan_type` `"plus"`, `domain`은 원본 `slugDomain`과 같은 규칙(한글 이름이면 `workspace` + 4자리 숫자).

- [ ] **Step 1: 실패하는 테스트 작성** — `test_workspace.py`(로그인한 클라이언트 픽스처는 `test_sign_in.py` 방식):
  - `test_load_account_data_creates_user_records`: 로그인 직후 `loadAccountData`의 `lit_user`·`user_root`·`user_settings`가 있고 `user_settings`의 `locale`이 `ko-KR`, `time_zone`이 `Asia/Seoul`
  - `test_create_workspace_then_load_account_data`: `createWorkspace {"name": "영업팀"}` → 200, `spaceId` 있음. 이어서 `loadAccountData`에 그 space(이름 `영업팀`, 역할 `editor`), 팀 `일반`, space_view(`private_pages` 1개), 환영 페이지 블록(제목 `CoolNotion!에 오신 것을 환영합니다`), 팀 홈 블록이 있고 `lsn > 0`
  - `test_create_workspace_requires_login`: 비로그인 → 401
  - `test_other_user_does_not_see_workspace`: u1이 만든 공간이 u2의 `loadAccountData`에 없다
  - `test_welcome_page_has_no_ai_line`: 환영 페이지 본문 어디에도 `AI`가 없다
- [ ] **Step 2: 실패 확인** — `... pytest -q -p no:cacheprovider tests/test_workspace.py` → FAIL
- [ ] **Step 3: 구현** — `seed.py`, `handlers.py`, `loadAccountData` 이동. 각 RPC는 성공 시 `await db.commit()`.
- [ ] **Step 4: 통과 확인** — 전체 백엔드 테스트 PASS(`test_sign_in.py`의 loadAccountData 기대값은 같은 필드를 유지하도록 맞춘다)
- [ ] **Step 5: 커밋** — 위 파일들 → `feat: 워크스페이스 만들기와 실제 레코드 기반 계정 데이터`

### Task 5: 페이지 읽기 RPC와 화면 시작 시 부르는 RPC

**Files:**
- Modify: `backend/app/records/handlers.py`
- Create: `backend/app/records/pages.py` (페이지 트리 모으기)
- Test: `backend/tests/test_pages.py`

**Interfaces:**
- Consumes: Task 1, 3, 4
- Produces (RPC, 이름과 입출력은 원본 `apps/server/src/api/handlers.ts`와 `api/modules/sidebar.ts`):
  - `loadPage {pageId}` → `{"recordMap", "cursor": {"stack": []}}` — 원본 `pageChunk`: 페이지 하위 블록(중첩 페이지는 들어가지 않음), 조상(브레드크럼), space, 작성자 lit_user, 멘션된 페이지, 블록의 discussion·comment. 데이터베이스(collection·collection_view·행)도 원본 `addCollection`대로 담는다.
  - `loadPageCached` → `loadPage`와 같음(`body.page.id` 또는 `body.pageId`)
  - `fetchRecords {requests: [{pointer: {table, id}}]}` → `{"recordMap"}` (최대 2000개, 권한 없는 것은 빠짐)
  - `markPageVisited {block: {id}}` → `{}` (`page_visit` 레코드 `id = f"{user_id}:{page_id}"`)
  - `listRecentPages {spaceId, limit}` → `{"pages": [{"id","visitedAt"}], "recordMap"}`
  - `getSidebarChildren`, `getSharedWithMe` → 원본 `sidebar.ts`와 같은 입출력
  - `getChangesSince {lsn, spaceIds}` → 원본과 같음(화면은 쓰지 않지만 재접속 복구용으로 둔다)
  - 화면 시작 시 부르는데 아직 기능이 없는 RPC는 원본 핸들러가 "데이터가 하나도 없는 워크스페이스"에서 돌려주는 값과 같은 모양의 빈 응답을 돌려주는 임시 처리로 등록한다. 대상은 Step 1에서 정한다(아래).

- [ ] **Step 1: 화면이 부르는 RPC 목록 확정** — 백엔드·화면 개발 서버를 켜고(`.claude/launch.json`의 `api`, `web`), 샘플 관리자로 로그인 → 온보딩 → 워크스페이스 생성 → 환영 페이지 열기 → 사이드바·검색 창·받은 편지함·설정 창 열기를 한 번씩 한다. API 로그에서 `NotFound`가 난 RPC 이름을 모은다. 이 중 이 Task의 Produces에 없는 것을 "임시 빈 응답" 목록으로 계획 진행 기록(ledger)에 적는다. AI·에이전트·회의록 관련 RPC(`ai*`, `agent*`, `meeting*`, `mcp*`)는 목록에서 빼고 Task 8에서 화면 쪽을 막는다.
- [ ] **Step 2: 실패하는 테스트 작성** — `test_pages.py`:
  - `test_load_page_returns_subtree`: Task 4로 만든 환영 페이지 `loadPage` → 페이지와 본문 블록 7개, space, 작성자 lit_user가 있고 `toggle` 같은 하위 블록의 자식도 있다(시작 내용에 하위 블록이 없으면 테스트에서 `put_record`로 하나 추가)
  - `test_load_page_without_access_is_empty`: 다른 사용자가 u1의 개인 환영 페이지를 `loadPage` → `recordMap`에 그 블록이 없다
  - `test_fetch_records_filters_by_role`: 내 블록 하나 + 남의 개인 블록 하나 요청 → 내 것만
  - `test_mark_visited_and_recent_pages`: `markPageVisited` 두 번 → `listRecentPages`에 그 페이지 1개, `page_visit.total_visits == 2`
  - `test_sidebar_children`: 원본 `sidebar.ts`의 입력 모양으로 환영 페이지의 하위 페이지를 요청하면 하위 페이지 블록이 돌아온다(테스트에서 하위 페이지 블록을 하나 추가)
  - Step 1 목록의 RPC마다 `test_stub_<rpc이름>`: 로그인 상태로 부르면 200이고 응답 최상위 키가 원본 핸들러의 반환 키와 같다
- [ ] **Step 3: 실패 확인** — `... pytest -q -p no:cacheprovider tests/test_pages.py` → FAIL
- [ ] **Step 4: 구현**
- [ ] **Step 5: 통과 확인** — 전체 백엔드 테스트 PASS
- [ ] **Step 6: 커밋** — `feat: 페이지 읽기 RPC와 화면 시작용 빈 응답`

### Task 6: 편집 적용(applyChanges)과 쓰기 권한 검사

**Files:**
- Create: `backend/app/records/guard.py`, `backend/app/records/apply.py`
- Modify: `backend/app/records/handlers.py`
- Test: `backend/tests/test_apply_changes.py`

**Interfaces:**
- Consumes: Task 1 저장소, Task 2 `apply_operation`·`OperationError`, Task 3 `Lookup`·`effective_role`·`record_role`·`RecordMapBuilder`
- Produces:
  - `guard.py`: `def validate_op(op: dict) -> str | None` (원본 `authz.ts` `validateOp`, 표 이름·ID 200자·경로 16단계·서버 관리 필드·명령별 인자 검사), `def strip_server_owned(op: dict) -> None`, `class TxGuard` — `__init__(self, lookup: Lookup, user_id: str, changed: dict[str, Change])`, `async check_op(op, before, after) -> str | None`, `async finalize() -> str | None`
  - `apply.py`:
    - `@dataclass class Change: table: str; record: dict; space_id: str | None`
    - `class TransactionError(Exception)` (`message`, `status` 400 또는 403)
    - `async def apply_transactions(db, user_id: str, transactions: list[dict], origin_client_id: str | None) -> list[Change]` — 커밋까지 한다. 커밋 성공 후 Task 7의 `realtime.hub.broadcast(changes, origin_client_id)`를 부른다(Task 7 전에는 등록된 방송 함수가 없으면 아무 일도 하지 않는 `on_commit` 훅 목록으로 둔다: `on_commit(fn: Callable[[list[Change], str | None], Awaitable[None]]) -> None`).
  - RPC `applyChanges {requestId, transactions}` → `{"recordMap"}` (변경된 레코드의 최종 값). `applyChangesFanout`은 같은 처리. 트랜잭션 500개·연산 합계 20000개 초과는 400/413(원본 값).

규칙(원본 `apps/server/src/records.ts` `applyTransactions`, `authz.ts` `TxGuard`에서 이 범위만 옮긴다):
- 시작할 때 `SELECT pg_advisory_xact_lock(7262001)`로 전역 쓰기 잠금(원본 SQLite `BEGIN IMMEDIATE`과 같은 효과). 모든 읽기·쓰기·`applied_tx`가 한 DB 트랜잭션 안에서 일어나고, 거절되면 롤백해 아무것도 남지 않는다.
- 이미 적용된 트랜잭션 ID(`applied_tx`)는 다시 적용하지 않고, 그 연산이 가리키는 레코드의 현재 값을 결과에 넣는다. 2일 지난 `applied_tx`는 한 시간에 한 번 지운다.
- 저장할 때 `version = 이전 version + 1`, `applied_tx_ids`는 이전 것에 이번 트랜잭션 ID를 붙여 마지막 8개.
- 권한(옮기는 것): 생성 시 블록은 `type` 필수, `created_by_id`는 서버가 현재 사용자로 덮어씀, `space` 생성 금지, `space_view`·`lit_user`·`user_root`·`user_settings`·`page_visit`·`follow`·`notification`은 본인 것만. 수정 시 블록은 `read_and_write` 이상(권한·`permissions_unlinked` 변경은 `editor`), `space_id`·`id`·작성자 변경 금지, collection·collection_view는 부모 블록에 `read_and_write`, space는 `pages`만 멤버가 바꿀 수 있고 나머지 설정은 owner만(`permissions`·`plan_type`·`domain`·`invite_link_code` 등은 거절), space_view는 본인 것만, team은 원본 `checkTeam`, discussion·comment는 원본 `checkDiscussion`·`checkComment`, lit_user는 `email`·`created_time` 변경 금지. `finalize`는 원본의 `parentProblem`, `anchored`, 공간 사이 이동 금지, 목록 필드(`LISTS`)에 새로 들어간 ID가 읽을 수 있는 레코드인지, `collection_id`·`collection_pointer`·`alias_pointer` 대상 확인까지.
- 옮기지 않는 것(이번 범위 밖): 데이터베이스 잠금·속성 접근(`dbaccess.ts`), 제안 편집(댓글 권한자의 suggestion), 워크스페이스 보안 정책(`policy.ts`), 데모, 검증(verification), 스키마 크기 제한, 검색 색인·스냅샷·활동 기록·알림 훅.

- [ ] **Step 1: 실패하는 테스트 작성** — `test_apply_changes.py`(Task 4로 워크스페이스를 만든 u1, 같은 공간 멤버 u2, 비멤버 u3 픽스처; u2는 테스트에서 space `permissions`에 직접 넣는다):
  - `test_create_block_under_own_page`: u1이 환영 페이지 아래 새 text 블록 `set []` + 페이지 `content`에 `listAfter` → 200, 블록 `version == 1`, `created_by_id == u1`, `space_id`가 채워짐
  - `test_splice_title`: 위 블록 제목에 `spliceText` → 저장된 제목이 바뀌고 `version == 2`
  - `test_apply_changes_concurrent_splices_merge`: 같은 base `"Hello"`로 u1은 끝에 `"!"`, u2(팀 홈 페이지 블록이라 둘 다 쓸 수 있음)는 앞에 `">"` → 최종 `">Hello!"`
  - `test_cannot_edit_other_users_private_page`: u2가 u1 환영 페이지 블록 제목 `set` → 403, u3이 팀 홈 블록 수정 → 403
  - `test_rejected_call_saves_nothing`: 한 요청에 허용 연산 하나 + 거절 연산 하나 → 403이고 허용 연산의 레코드도 바뀌지 않음, `current_lsn` 그대로
  - `test_retry_is_idempotent`: 같은 트랜잭션 ID로 두 번 → 둘 다 200, `version` 한 번만 증가, 두 번째 응답에도 그 레코드가 있음
  - `test_server_owned_fields_ignored`: `set []` args에 `"version": 99` → 저장된 version은 1. 경로 `["version"]` 연산 → 400
  - `test_cannot_create_space_or_touch_others_sidebar`: `space` 생성 → 403, u2가 u1 space_view 수정 → 403
  - `test_cannot_move_block_to_other_workspace`: 다른 공간 페이지로 `parent_id` 변경 → 403
  - `test_orphan_block_rejected`: 존재하지 않는 부모 아래 블록 생성 → 403
  - `test_invalid_shapes_400`: 알 수 없는 table, 알 수 없는 command, `__proto__` 경로, `spliceText`를 `format` 경로에 → 각각 400
  - `test_anonymous_401`: 비로그인 → 401
- [ ] **Step 2: 실패 확인** — `... pytest -q -p no:cacheprovider tests/test_apply_changes.py` → FAIL
- [ ] **Step 3: 구현** — `guard.py`, `apply.py`, RPC 등록. 400/403은 기존 `ValidationError`/`PermissionError`로 돌려준다(메시지는 한국어로: 400 `잘못된 요청입니다.`, 403 `이 작업을 할 권한이 없습니다.`; 서버 로그에는 원본처럼 사유를 남긴다).
- [ ] **Step 4: 통과 확인** — 전체 백엔드 테스트 PASS
- [ ] **Step 5: 커밋** — `feat: applyChanges 편집 적용과 쓰기 권한 검사`

### Task 7: 실시간 웹소켓(/ws)

**Files:**
- Create: `backend/app/realtime/__init__.py`, `backend/app/realtime/hub.py`, `backend/app/realtime/endpoint.py`
- Modify: `backend/app/main.py` (웹소켓 라우트 등록, `on_commit(hub.broadcast)` 연결)
- Test: `backend/tests/test_realtime_hub.py`, `backend/tests/test_realtime_ws.py`

**Interfaces:**
- Consumes: Task 3 `record_role`·`Lookup`, Task 6 `Change`·`on_commit`, 기존 `app.auth.sessions`의 세션 토큰 → 사용자 조회 함수
- Produces:
  - `hub.py`: `class Connection(Protocol)` — `async send_text(data: str)`; `class Hub` — `async connect(conn, user_id: str, client_id: str) -> Client`, `async disconnect(client)`, `async handle(client, raw: str)`, `async broadcast(changes: list[Change], origin_client_id: str | None)`, `async notify_user(user_id, payload: dict)`; 모듈 변수 `hub = Hub(access=...)`. 접근 확인(`space(space_id, user_id)`, `page(page_id, user_id)`, `role(table, rec, user_id)`, `view(table, rec, user_id)`)은 DB 세션을 새로 열어 Task 3 함수로 계산하는 async 콜백으로 주입한다(테스트에서는 가짜 콜백).
  - `endpoint.py`: `GET /ws?clientId=...` 웹소켓. `lit_session` 쿠키로 사용자 확인, 없으면 연결 거절(close code 4401). `Origin`이 있으면 요청 Host와 같은 출처일 때만 받는다(다르면 4403). 메시지 최대 64KB.

메시지(원본 `realtime.ts`와 같음): 연결 직후 `{"type":"hello","userId"}`. 받는 것 `subscribe {spaceIds}`(최대 100개, 멤버인 공간만), `presence {pageId, data}`(열 수 있는 페이지만, data JSON 4096자 이하), `ping {t}` → `{"type":"pong","t"}`. 보내는 것 `records {origin, records: [{table,id,version,value,role}]}`(받는 사람 기준 역할 계산, `none`이면 빼고, 구독하지 않은 공간의 변경은 본인 소유 레코드이거나 페이지를 열고 있는 경우만), `presence {pageId, viewers: [{userId, clientId, data}]}`(입장·이동·퇴장 때 그 페이지 사람들에게).

- [ ] **Step 1: 실패하는 테스트 작성**
  - `test_realtime_hub.py`(가짜 연결·가짜 접근 콜백):
    - `test_hello_on_connect`
    - `test_ping_pong`
    - `test_subscribe_filters_non_member_spaces`
    - `test_broadcast_sends_to_subscribers_with_role`: s1 구독자 둘 중 역할 `none`인 사람은 받지 않음, 받은 메시지의 `origin`이 보낸 clientId
    - `test_broadcast_skips_other_workspaces`
    - `test_owner_records_delivered_without_subscription`: `space_view`(parent_id가 본인) 변경은 구독 없이도 받음
    - `test_presence_join_move_leave`: 같은 페이지 두 명 → 둘 다 viewers 2명 받음, 한 명이 다른 페이지로 이동하면 남은 사람이 viewers 1명 받음, 연결 끊김도 같음
    - `test_presence_too_large_is_dropped`: data 4097자 → `data`가 `null`로 전달
  - `test_realtime_ws.py`(Starlette `TestClient`, 세션 확인 함수는 테스트에서 바꿔 끼움):
    - `test_ws_rejects_anonymous` (쿠키 없음 → 4401)
    - `test_ws_rejects_foreign_origin` (`Origin: http://evil.example` → 4403)
    - `test_ws_hello_for_logged_in_user`
- [ ] **Step 2: 실패 확인** — `... pytest -q -p no:cacheprovider tests/test_realtime_hub.py tests/test_realtime_ws.py` → FAIL
- [ ] **Step 3: 구현** — 허브, 엔드포인트, `main.py` 연결. 방송은 커밋이 끝난 뒤에만(Task 6의 `on_commit`).
- [ ] **Step 4: 통과 확인** — 전체 백엔드 테스트 PASS
- [ ] **Step 5: 실제 연결 확인** — 개발 서버를 켜고 브라우저에서 로그인한 뒤 개발자 도구 네트워크 탭에서 `ws://localhost:5173/ws?clientId=...`가 101로 연결되고 `hello` 메시지를 받는지 본다(Vite가 `/ws`를 8000으로 넘김).
- [ ] **Step 6: 커밋** — `feat: 실시간 웹소켓(레코드 변경 방송, 접속자 표시)`

### Task 8: AI 기능 숨기기

**Files:**
- Create: `frontend/apps/web/src/features/ai/enabled.ts`
- Modify: AI 진입점 파일들(아래), `frontend/apps/web/src/lib/router.ts`
- Modify: `backend/app/records/handlers.py` (`aiStatus` RPC)
- Test: `frontend/apps/web/src/features/ai/enabled.test.ts`, `backend/tests/test_pages.py`에 `test_ai_status_disabled`

**Interfaces:**
- Produces: `export const AI_ENABLED = false;` (`features/ai/enabled.ts`). AI 코드는 지우지 않고, 진입점에서 이 값으로 막는다.

막을 곳(원본 조사 결과, 파일 경로는 `frontend/apps/web/src/` 기준):
- 블록 자동 등록: `features/editor/blocks/registerAll.ts`가 불러오는 AI 블록(`features/ai/AiBlock.block.tsx`, `features/agents/AgentChat.block.tsx`, `features/aiImage/AiImage.block.tsx`, `features/editor/blocks/ai.block.tsx`, `features/meetings/MeetingNotes.block.tsx`)은 `AI_ENABLED`가 거짓이면 등록하지 않는다. `ai/mount.tsx`의 `#nc-ai-layer` 생성도 하지 않는다.
- 사이드바·상단·페이지: `shell/Sidebar.tsx`(AI 사이드바), `shell/Workspace.tsx`(AgentPage·ChatPage 경로), `shell/Topbar.tsx`(AgentCrumbs), `page/PageView.tsx`(지시문 배너), `page/ShareMenu.tsx`(에이전트 공유), `page/Cover.tsx`(AI 이미지 탭), `page/GetStartedBar.tsx`(회의록), `page/PageMenu.tsx`의 AI 항목
- 편집기·댓글·설정·DB: `editor/BlockMenu.tsx`(스킬), `editor/slashItems.ts`의 AI 항목, `editor/blocks/media*`의 AI 이미지, `comments/comments.tsx`의 에이전트 멘션, `settings/sections/features.tsx`의 AI 설정, `database/advanced/FormulaAssistant.tsx`
- 경로: `lib/router.ts`의 `chat`, `meetings`, `library`, `agent`는 `AI_ENABLED`가 거짓이면 홈(`/`)으로 보낸다.
- 백엔드 `aiStatus` RPC → `{"configured": False, "policy": {"enabled": False}}`(원본 `useAiStatus`가 읽는 모양. 나머지 키는 원본 핸들러 반환값과 같게 빈 값).

- [ ] **Step 1: 실패하는 테스트 작성**
  - `enabled.test.ts`: `import.meta.glob`으로 위 파일들의 소스를 `?raw`로 읽어 각 파일이 `AI_ENABLED`를 참조하는지 확인(기존 `i18n.test.ts`와 같은 방식), `slashItems`가 내보내는 항목 목록에 AI 항목 id가 없는지 확인(항목 id는 원본 `slashItems.ts`에서 확인)
  - 백엔드 `test_ai_status_disabled`
- [ ] **Step 2: 실패 확인** — `pnpm --dir frontend/apps/web test`, 백엔드 테스트 → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 화면 테스트·타입 검사·백엔드 테스트 PASS
- [ ] **Step 5: 화면 확인** — 로그인 후 사이드바, `/` 메뉴, 페이지 `⋯` 메뉴, 표지 변경, 설정 창에 AI 항목이 없는지 브라우저로 본다
- [ ] **Step 6: 커밋** — `feat: AI 기능을 화면에서 숨김(코드는 유지)`

### Task 9: 두 사람 동시 편집 확인과 기록

**Files:**
- Create: `backend/app/dev/join_workspace.py`
- Modify: `backend/app/cli.py` (`join-workspace` 명령), `backend/app/records/seed.py` (`add_member`)
- Test: `backend/tests/test_join_workspace.py`
- Modify: `docs/agent_dev_log/<작업한 날짜>.md`
- (확인 중 문제가 나오면 해당 Task 범위로 돌아가 테스트부터 추가해 고친다)

**Interfaces:**
- Produces: `seed.py`에 `async def add_member(db, space_id: str, user_id: str, role: str) -> None`(원본 `seed.ts` `addMember`와 같음: space 권한 추가, space_view 생성, user_root 갱신, 기본 팀 멤버 추가. 커밋하지 않음). CLI `python -m app.cli join-workspace <email> <space_id> [--role editor]` — `APP_ENV=production`이면 거부(샘플 계정과 같은 규칙). 정식 초대 기능은 멤버 관리 계획에서 만든다.

- [ ] **Step 1: 두 번째 계정을 워크스페이스에 넣는 개발용 명령** — 테스트 `test_add_member_creates_sidebar`(add_member 후 그 사용자의 `loadAccountData`에 공간·팀이 보임), `test_join_workspace_refused_in_production` 작성 → 실패 확인 → 구현 → 통과 확인 → 커밋 `feat: 개발용 워크스페이스 멤버 추가 명령`
- [ ] **Step 2: 브라우저 두 개로 확인** — 내장 브라우저 탭과 시크릿 창(또는 다른 브라우저)에서 각각 로그인해 팀 홈 페이지를 함께 연다. 확인할 것: (1) 한쪽에서 친 글자가 1초 안에 다른 쪽에 보인다 (2) 같은 줄의 다른 위치에 동시에 입력해도 둘 다 남는다 (3) 상대의 커서·접속 표시가 보인다 (4) 새로고침해도 내용이 남는다 (5) 백엔드를 껐다 켜면 화면이 다시 연결되고 내용이 맞다
- [ ] **Step 3: 결과 기록** — 개발 로그에 확인 결과(되는 것, 안 되는 것), 남은 일(초대·멤버 관리, 데이터베이스, 댓글, 검색, 업로드, 공유, 기록·휴지통, 가져오기·내보내기, 하이웍스 메일 로그인 방식 결정)을 적는다.
- [ ] **Step 4: 커밋** — `docs: 실시간 공동 편집 확인 결과 기록`
