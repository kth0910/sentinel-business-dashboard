# 기반 구축(개발 환경 · FastAPI 뼈대 · 로그인 · 한국어 고정) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** litpage 화면을 한국어 전용으로 띄우고, 그 화면이 부르는 로그인 API를 Python(FastAPI) 서버가 응답해 "샘플 계정으로 로그인 → 워크스페이스 만들기(온보딩) 화면"까지 개발 서버에서 동작하게 한다.

**Architecture:** 저장소를 `frontend/`(litpage 화면·공유 로직, pnpm)와 `backend/`(FastAPI, uv)로 나눈다. 서버는 litpage 화면 규격 그대로 `POST /api/rpc/{name}` 하나로 모든 호출을 받고 이름별 처리 함수를 등록한다. 로그인 확인은 "인증 공급자" 인터페이스 뒤에 두어, 지금은 로컬 비밀번호(샘플 계정)로, 나중에는 사내 메일 시스템 인증으로 공급자만 바꿔 끼운다. 로그인 상태는 `lit_session` HttpOnly 쿠키, 데이터는 PostgreSQL에 둔다.

**Tech Stack:** Python 3.13(uv 관리), FastAPI, uvicorn, SQLAlchemy 2.0(async) + psycopg 3, Alembic, argon2-cffi, pydantic-settings, pytest + httpx · Node.js 26, pnpm 10, React + Vite, vitest(litpage `f55fead`) · PostgreSQL 17

**Spec:** `docs/superpowers/specs/2026-11-25-daily-report-dashboard-design.md` (0장의 2026-11-27 변경 사항이 우선)

## Global Constraints

- litpage는 `https://github.com/litmers-dev/litpage` 커밋 `f55fead`에서 가져온다. 포크하지 않고, MIT 저작권 고지(`LICENSE`, `THIRD_PARTY_NOTICES.md`)를 남긴다.
- litpage의 TypeScript 서버(`apps/server`)는 가져오지 않는다. 화면(`apps/web`)과 공유 로직(`packages/shared`)만 가져온다.
- 서버는 litpage 화면 규격을 따른다: `POST /api/rpc/{name}`, 본문은 JSON 객체, 쿠키 이름 `lit_session`, 오류 응답 본문 `{"errorId": str, "name": str, "message": str}`.
- 오류 이름과 상태 코드: `ValidationError`(400·413·415), `UnauthorizedError`(401), `PermissionError`(403), `NotFound`(404), `RateLimitedError`(429), `InternalError`(500, 메시지는 내부 정보 없이 고정 문구).
- 세션 쿠키: `lit_session=<token>; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`(30일). HTTPS일 때만 `; Secure`.
- **로그인:** 회원가입 없음. 로그인 확인은 `AuthProvider` 인터페이스로만 한다. 개발 단계 공급자는 `local`(샘플 계정 비밀번호). 나중에 사내 메일 시스템 공급자를 추가할 때 RPC 처리 함수와 화면은 바꾸지 않는다.
- 로컬 비밀번호는 argon2로 해시한다. 원문은 저장·기록하지 않는다. 샘플 계정은 `APP_ENV=production`에서 만들 수 없다.
- **언어:** 한국어 전용. 언어 선택 기능과 영어 등 다른 언어 설정은 없앤다. 서버가 사용자에게 보내는 메시지도 한국어.
- **제품 이름:** 사용자에게 보이는 "Litpage"는 모두 **`CoolNotion!`**(느낌표 포함)으로 바꾼다(한국어 카탈로그 값, `t()` 기본 문구, `<title>`, 대체 텍스트 등). i18n 키·CSS 클래스·저장소 키·패키지 이름 같은 내부 식별자는 바꾸지 않는다. litpage 저작권 고지(`frontend/LICENSE`, `frontend/THIRD_PARTY_NOTICES.md`)는 MIT 조건이라 원래 이름 그대로 둔다.
- **업무관리시스템 엑셀 기능, 캘린더 첫 화면, 업무 전용 블록은 만들지 않는다.** 목표는 바닐라 노션과 같은 워크스페이스다.
- **코드와 문서가 아닌 임시 파일은 절대 커밋하지 않는다**(pytest 캐시, 커버리지, 빌드 결과, 로그, 실행 데이터, 내려받은 원본 포함). 커밋은 경로를 하나씩 지정하고(`git add -A`, `git add .` 금지), 커밋 전에 `git status`로 확인한다.
- 개발 서버 포트: API `8000`, 화면 `5173`. 빌드(`pnpm build`) 없이 개발 모드로 실행한다.

## Review Focus

- 로그인 이메일의 대소문자·앞뒤 공백이 다르게 입력됨 → 같은 계정으로 인식한다. (Task 6 `test_sign_in_normalizes_email`)
- 없는 이메일과 틀린 비밀번호 → 둘 다 401 `"이메일 또는 비밀번호가 올바르지 않습니다."`로 같은 답을 준다. (Task 6 `test_sign_in_wrong_password_and_unknown_email_look_the_same`)
- 외부 공급자(사내 메일)로 처음 로그인한 사람 → 계정이 자동으로 만들어지고, 두 번째 로그인에는 같은 계정을 쓴다. 로컬 공급자는 계정을 자동으로 만들지 않는다. (Task 5 `test_provision_external_user_once`, Task 6 `test_sign_in_with_provisioning_provider`)
- 만료됐거나 지워진 세션 쿠키로 접속 → 500이 아니라 401(로그인 화면)로 간다. (Task 5 `test_expired_session_is_anonymous`, Task 6 `test_load_account_data_anonymous`)
- 예전에 저장된 언어 설정(`localStorage`의 `nc:locale`이 `en-US`)이 남은 브라우저 → 그래도 한국어로 보인다. (Task 7 `locale stays Korean even if en-US was stored`)

---

### Task 1: litpage 0단계 검증 (진행 여부 결정)

설계 6.2의 0단계. litpage 원본을 그대로 띄워 쓸 만한지 사용자가 판단한다. 통과하지 못하면 이 계획을 멈추고 설계 4.2의 대안(BlockNote)으로 돌아간다.

**Files:**
- Create: `docs/superpowers/specs/2026-11-27-litpage-check.md` (검증 결과 기록)

- [ ] **Step 1: 원본을 저장소 밖 임시 폴더에 받아 개발 모드로 실행**

```powershell
git clone https://github.com/litmers-dev/litpage.git $env:TEMP\litpage-check
cd $env:TEMP\litpage-check; git checkout f55fead; pnpm install; pnpm dev
```
Expected: `[server]`(3001), `[web]`(5173) 로그. `http://127.0.0.1:5173`에서 로그인 화면. 화면에 표시되는 개발용 로그인 코드로 로그인. 로그인 화면에서 언어를 한국어로 바꾼다.

- [ ] **Step 2: 사용자와 함께 확인하고 결과를 기록**

| 항목 | 통과 기준 |
|---|---|
| 한국어 입력 | 문단·제목·표 셀에서 한글 조합 중 글자가 깨지거나 두 번 입력되지 않음 |
| 한국어 화면 | 주요 화면(사이드바, 페이지, 데이터베이스, 설정)에 영어가 거의 남지 않음 |
| 데이터베이스 | 표·보드·캘린더 보기 생성, 속성 추가, 필터 동작 |
| 수정 이력 | 페이지 수정 후 이전 버전 열람 가능 |
| 모바일 폭 | 브라우저 폭 390px에서 페이지 읽기·편집 가능 |

- [ ] **Step 3: 결과 파일 작성 후 커밋**

항목별 통과/실패, 실패 증상, 최종 판정(진행/중단)을 적는다. 임시 폴더(`$env:TEMP\litpage-check`)는 저장소 밖이라 커밋 대상이 아니다.
```bash
git status
git add docs/superpowers/specs/2026-11-27-litpage-check.md
git commit -m "docs: litpage 0단계 검증 결과"
```
판정이 "중단"이면 여기서 멈추고 사용자와 대안을 논의한다.

---

### Task 2: 개발 환경 설치

**Files:**
- Create: `.env.example`

- [ ] **Step 1: uv와 PostgreSQL 17 설치 (사용자 동의 후)**

```powershell
winget install --id astral-sh.uv -e
winget install --id PostgreSQL.PostgreSQL.17 -e
```
PostgreSQL 설치 중 관리자 권한 창과 `postgres` 비밀번호 입력은 사용자가 직접 한다.

- [ ] **Step 2: 개발용·테스트용 DB와 계정 생성**

```powershell
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -c "CREATE ROLE sentinel LOGIN PASSWORD 'sentinel';" -c "CREATE DATABASE sentinel_dev OWNER sentinel;" -c "CREATE DATABASE sentinel_test OWNER sentinel;"
```
비밀번호 `sentinel`은 이 PC 개발용이다.

- [ ] **Step 3: `.env.example` 작성**

```
APP_ENV=development
DATABASE_URL=postgresql+psycopg://sentinel:sentinel@127.0.0.1:5432/sentinel_dev
TEST_DATABASE_URL=postgresql+psycopg://sentinel:sentinel@127.0.0.1:5432/sentinel_test
COOKIE_SECURE=false
AUTH_PROVIDER=local
# 개발용 샘플 계정 비밀번호. 운영(APP_ENV=production)에서는 샘플 계정 생성이 거부됨
SAMPLE_USER_PASSWORD=sample-dev-only
```
`backend/.env`로 복사해 쓴다(`.env`는 커밋 안 됨).

- [ ] **Step 4: 확인**

Run: `uv --version` → 버전 출력. `& "C:\Program Files\PostgreSQL\17\bin\psql.exe" "postgresql://sentinel:sentinel@127.0.0.1:5432/sentinel_dev" -c "select 1"` → `1`.

- [ ] **Step 5: 커밋**

```bash
git status
git add .env.example
git commit -m "chore: 개발용 환경 변수 예시 추가"
```

---

### Task 3: FastAPI 뼈대와 DB 연결 확인

**Files:**
- Create: `backend/pyproject.toml`, `backend/.python-version`(`3.13`), `backend/app/__init__.py`, `backend/app/config.py`, `backend/app/db.py`, `backend/app/main.py`
- Test: `backend/tests/conftest.py`, `backend/tests/test_health.py`

**Interfaces:**
- Produces:
  - `app.config.Settings` (pydantic-settings, `backend/.env` 읽음): `app_env: Literal["development", "production"] = "development"`, `database_url: str`, `test_database_url: str`, `cookie_secure: bool = False`, `session_days: int = 30`, `auth_provider: str = "local"`, `sample_user_password: str | None = None`; `get_settings() -> Settings`(lru_cache)
  - `app.db.Base`(DeclarativeBase), `make_engine(url: str) -> AsyncEngine`, `app.db.SessionLocal: async_sessionmaker[AsyncSession]`, 의존성 `get_db() -> AsyncIterator[AsyncSession]`
  - `app.main.create_app() -> FastAPI`, 모듈 수준 `app = create_app()`
  - 테스트 픽스처(`conftest.py`): `db`(테스트 DB `AsyncSession`, 테스트마다 모든 테이블 비움), `client`(`httpx.AsyncClient`, `ASGITransport(app)`, base_url `http://test`, `get_db`를 테스트 세션으로 교체)

- [ ] **Step 1: uv 프로젝트 생성과 의존성 추가**

```powershell
cd backend; uv init --app --name sentinel-backend --python 3.13
uv add fastapi "uvicorn[standard]" "sqlalchemy[asyncio]>=2.0" "psycopg[binary]>=3.2" alembic argon2-cffi pydantic-settings
uv add --dev pytest pytest-asyncio httpx
```
`pyproject.toml`에 `[tool.pytest.ini_options] asyncio_mode = "auto"`, `testpaths = ["tests"]`. `uv.lock`은 커밋 대상(의존성 고정 파일), `.venv`·`.pytest_cache`는 무시됨을 `git status`로 확인한다.

- [ ] **Step 2: 실패하는 테스트 작성**

```python
# backend/tests/test_health.py
async def test_health_reports_db_ok(client):
    res = await client.get("/api/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "db": "ok"}
```

- [ ] **Step 3: 실패 확인**

Run: `uv run pytest tests/test_health.py -v` → FAIL (`create_app` 없음 또는 404)

- [ ] **Step 4: `config.py`, `db.py`, `main.py` 구현**

`GET /api/health`는 `SELECT 1` 성공 시 `{"status": "ok", "db": "ok"}`. 테스트는 `test_database_url`로 엔진을 만들고 시작 시 `Base.metadata.create_all`로 테이블을 만든다(마이그레이션 검증은 Task 5).

- [ ] **Step 5: 통과 확인**

Run: `uv run pytest -v` → PASS

- [ ] **Step 6: 커밋**

```bash
git status
git add backend/pyproject.toml backend/uv.lock backend/.python-version backend/app backend/tests
git commit -m "feat: FastAPI 서버 뼈대와 DB 연결 확인"
```

---

### Task 4: RPC 처리 틀 (`POST /api/rpc/{name}`)

**Files:**
- Create: `backend/app/rpc/__init__.py`, `backend/app/rpc/errors.py`, `backend/app/rpc/registry.py`, `backend/app/rpc/router.py`
- Modify: `backend/app/main.py` (라우터 등록)
- Test: `backend/tests/test_rpc.py`

**Interfaces:**
- Consumes: `app.db.get_db`, `app.main.create_app`
- Produces:
  - `app.rpc.errors.RpcError(message: str)` — 클래스 속성 `status: int`, `name: str`. 하위 클래스 `ValidationError`(400), `UnauthorizedError`(401), `PermissionDenied`(403, `name="PermissionError"`), `NotFoundError`(404, `name="NotFound"`), `RateLimitedError`(429)
  - `app.rpc.registry.RpcContext` (dataclass): `user_id: str | None`, `token: str | None`, `client_id: str | None`, `ip: str`, `secure: bool`, `db: AsyncSession`, `cookies: list[str]`(응답에 붙일 Set-Cookie 값)
  - `app.rpc.registry.rpc(name: str)` — 데코레이터. `async def handler(ctx: RpcContext, body: dict) -> dict`를 등록. 같은 이름 두 번 등록 시 `ValueError`
  - `app.rpc.registry.HANDLERS: dict[str, Handler]`
  - `app.rpc.router.build_context(request: Request, db: AsyncSession) -> RpcContext` (Task 5 전에는 `user_id`가 항상 `None`)

- [ ] **Step 1: 실패하는 테스트 작성**

```python
# backend/tests/test_rpc.py
from app.rpc.registry import rpc
from app.rpc.errors import ValidationError

@rpc("_testEcho")
async def _echo(ctx, body):
    return {"body": body, "userId": ctx.user_id}

@rpc("_testFail")
async def _fail(ctx, body):
    raise ValidationError("값이 올바르지 않습니다.")

@rpc("_testCrash")
async def _crash(ctx, body):
    raise RuntimeError("secret detail")

JSON = {"content-type": "application/json"}

async def test_rpc_echoes_json_body(client):
    res = await client.post("/api/rpc/_testEcho", json={"a": 1})
    assert res.status_code == 200
    assert res.json() == {"body": {"a": 1}, "userId": None}

async def test_unknown_rpc_returns_not_found(client):
    res = await client.post("/api/rpc/noSuchThing", json={})
    assert res.status_code == 404
    data = res.json()
    assert data["name"] == "NotFound" and data["message"] and data["errorId"]

async def test_non_json_content_type_is_415(client):
    res = await client.post("/api/rpc/_testEcho", content="a=1", headers={"content-type": "application/x-www-form-urlencoded"})
    assert res.status_code == 415
    assert res.json()["name"] == "ValidationError"

async def test_broken_json_is_400(client):
    res = await client.post("/api/rpc/_testEcho", content="{oops", headers=JSON)
    assert res.status_code == 400
    assert res.json()["name"] == "ValidationError"

async def test_array_or_empty_body_becomes_empty_object(client):
    assert (await client.post("/api/rpc/_testEcho", content="[1,2]", headers=JSON)).json()["body"] == {}
    assert (await client.post("/api/rpc/_testEcho", content="", headers=JSON)).json()["body"] == {}

async def test_rpc_error_maps_to_status_and_name(client):
    res = await client.post("/api/rpc/_testFail", json={})
    assert res.status_code == 400
    assert res.json()["name"] == "ValidationError"
    assert res.json()["message"] == "값이 올바르지 않습니다."

async def test_unexpected_error_hides_details(client):
    res = await client.post("/api/rpc/_testCrash", json={})
    assert res.status_code == 500
    assert res.json()["name"] == "InternalError"
    assert "secret" not in res.json()["message"]
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_rpc.py -v` → FAIL (모듈 없음)

- [ ] **Step 3: `errors.py`, `registry.py`, `router.py` 구현**

처리 순서는 litpage `apps/server/src/app.ts`의 `/api/rpc/:name`과 같게: 이름 확인(404) → content-type 확인(415) → JSON 파싱(400) → 객체가 아니면 `{}` → 처리 함수 실행 → `ctx.cookies`를 `Set-Cookie`로 붙임. 모든 오류 본문에 `errorId`(uuid4 hex). 500 메시지는 `"요청을 처리하는 중 문제가 발생했습니다."`, 원인은 서버 로그에만. 본문 상한 1MB, 넘으면 413 `ValidationError`. 404 메시지는 `"알 수 없는 요청입니다."`.

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest -v` → PASS

- [ ] **Step 5: 커밋**

```bash
git status
git add backend/app/rpc backend/app/main.py backend/tests/test_rpc.py
git commit -m "feat: litpage 규격의 RPC 처리 틀"
```

---

### Task 5: 사용자·세션 저장, 인증 공급자, 샘플 계정

**Files:**
- Create: `backend/alembic.ini`, `backend/alembic/env.py`, `backend/alembic/script.py.mako`, `backend/alembic/versions/0001_users_sessions.py`, `backend/app/auth/__init__.py`, `backend/app/auth/models.py`, `backend/app/auth/passwords.py`, `backend/app/auth/users.py`, `backend/app/auth/sessions.py`, `backend/app/auth/providers.py`, `backend/app/dev/__init__.py`, `backend/app/dev/sample_users.py`, `backend/app/cli.py`
- Modify: `backend/app/rpc/router.py` (`build_context`에서 쿠키로 사용자 찾기), `backend/tests/conftest.py` (픽스처 `test_database_url_env`: 테스트 DB 테이블을 모두 지우고 `DATABASE_URL`을 테스트 DB 주소로 바꾼 환경 변수 dict를 반환, 끝나면 `create_all`로 복구)
- Test: `backend/tests/test_auth_store.py`, `backend/tests/test_providers.py`, `backend/tests/test_sample_users.py`, `backend/tests/test_migrations.py`

**Interfaces:**
- Consumes: `app.db.Base`, `app.db.get_db`, `app.config.get_settings`
- Produces:
  - 모델 `User`(테이블 `users`): `id: str`(PK, `uuid4().hex`), `email: str`(유일, 소문자), `name: str`, `password_hash: str | None`, `auth_source: str`(`"local"` 등 공급자 이름), `external_id: str | None`, `is_admin: bool = False`, `created_at: datetime`(timezone). `(auth_source, external_id)` 유일
  - 모델 `AuthSession`(테이블 `sessions`): `token_hash: str`(PK, 토큰 sha256 hex), `user_id: str`(FK `users.id`, 삭제 시 함께 삭제), `created_at`, `expires_at`
  - `app.auth.passwords.hash_password(password: str) -> str`, `verify_password(hash: str, password: str) -> bool`
  - `app.auth.users.normalize_email(email: str) -> str`, `create_user(db, email, name, password: str | None, is_admin: bool = False, auth_source: str = "local", external_id: str | None = None) -> User`(이메일 중복 시 `ValueError`), `find_user_by_email(db, email) -> User | None`, `provision_external_user(db, identity: Identity, source: str) -> User`(같은 `source`+`external_id`나 같은 이메일이 있으면 그 사용자, 없으면 새로 만듦)
  - `app.auth.providers.Identity` (dataclass): `email: str`, `name: str`, `external_id: str | None`
  - `app.auth.providers.AuthProvider` (Protocol): `name: str`, `allows_provisioning: bool`, `async def authenticate(self, db, email: str, password: str) -> Identity | None`
  - `app.auth.providers.LocalPasswordProvider`: `name="local"`, `allows_provisioning=False`, `users.password_hash`로 확인
  - `app.auth.providers.get_auth_provider(settings: Settings) -> AuthProvider` — `"local"` 외의 값은 `ValueError("지원하지 않는 인증 공급자: …")`. 사내 메일 공급자는 다음 계획에서 이 함수에 추가한다
  - `app.auth.sessions.create_session(db, user_id) -> str`(`secrets.token_urlsafe(32)`), `user_for_token(db, token: str | None) -> str | None`, `destroy_session(db, token: str | None) -> None`, `session_cookie(token: str, secure: bool) -> str`, `clear_session_cookie(secure: bool) -> str`
  - `app.dev.sample_users.SAMPLE_USERS: list[tuple[str, str, bool]]` = `[("admin@example.com", "관리자", True), ("hong@example.com", "홍길동", False), ("kim@example.com", "김철수", False)]`, `seed_sample_users(db, password: str, app_env: str) -> int`(새로 만든 수, 이미 있으면 건너뜀, `app_env == "production"`이면 `RuntimeError`)
  - CLI: `uv run python -m app.cli create-user --email <e> --name <n> [--admin]`(비밀번호는 `getpass` 두 번), `uv run python -m app.cli seed-sample-users`(비밀번호는 `SAMPLE_USER_PASSWORD`)

- [ ] **Step 1: 실패하는 테스트 작성**

```python
# backend/tests/test_auth_store.py
import pytest
from datetime import datetime, timedelta, timezone
from sqlalchemy import update
from app.auth.users import create_user, find_user_by_email, normalize_email
from app.auth.passwords import hash_password, verify_password
from app.auth.sessions import create_session, user_for_token, destroy_session, session_cookie
from app.auth.models import AuthSession

def test_password_hash_round_trip():
    h = hash_password("secret-123")
    assert h != "secret-123" and h.startswith("$argon2")
    assert verify_password(h, "secret-123") and not verify_password(h, "wrong")

def test_normalize_email():
    assert normalize_email("  Hong@Example.COM ") == "hong@example.com"

async def test_create_and_find_user(db):
    u = await create_user(db, " Hong@Example.com", "홍길동", "secret-123", is_admin=True)
    assert u.email == "hong@example.com" and u.is_admin and u.auth_source == "local"
    assert (await find_user_by_email(db, "HONG@example.com ")).id == u.id

async def test_duplicate_email_rejected(db):
    await create_user(db, "a@example.com", "가", "secret-123")
    with pytest.raises(ValueError):
        await create_user(db, "A@example.com", "나", "secret-123")

async def test_session_round_trip(db):
    u = await create_user(db, "s@example.com", "세션", "secret-123")
    token = await create_session(db, u.id)
    assert await user_for_token(db, token) == u.id
    await destroy_session(db, token)
    assert await user_for_token(db, token) is None

async def test_expired_session_is_anonymous(db):
    u = await create_user(db, "e@example.com", "만료", "secret-123")
    token = await create_session(db, u.id)
    await db.execute(update(AuthSession).values(expires_at=datetime.now(timezone.utc) - timedelta(seconds=1)))
    assert await user_for_token(db, token) is None
    assert await user_for_token(db, "not-a-token") is None
    assert await user_for_token(db, None) is None

def test_session_cookie_format():
    assert session_cookie("tok", secure=False) == "lit_session=tok; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000"
    assert session_cookie("tok", secure=True).endswith("; Secure")
```

```python
# backend/tests/test_providers.py
import pytest
from app.config import Settings
from app.auth.providers import Identity, LocalPasswordProvider, get_auth_provider
from app.auth.users import create_user, provision_external_user

async def test_local_provider_checks_password(db):
    await create_user(db, "hong@example.com", "홍길동", "secret-123")
    p = LocalPasswordProvider()
    ok = await p.authenticate(db, "hong@example.com", "secret-123")
    assert ok == Identity(email="hong@example.com", name="홍길동", external_id=None)
    assert await p.authenticate(db, "hong@example.com", "nope") is None
    assert await p.authenticate(db, "ghost@example.com", "secret-123") is None

def test_get_auth_provider_by_setting():
    s = Settings(database_url="x", test_database_url="x", auth_provider="local")
    assert get_auth_provider(s).name == "local"
    with pytest.raises(ValueError):
        get_auth_provider(Settings(database_url="x", test_database_url="x", auth_provider="nope"))

async def test_provision_external_user_once(db):
    ident = Identity(email="Park@Company.co.kr", name="박영희", external_id="mail-123")
    first = await provision_external_user(db, ident, source="mail")
    second = await provision_external_user(db, ident, source="mail")
    assert first.id == second.id
    assert first.email == "park@company.co.kr" and first.auth_source == "mail" and first.password_hash is None
```

```python
# backend/tests/test_sample_users.py
import pytest
from app.dev.sample_users import seed_sample_users, SAMPLE_USERS
from app.auth.users import find_user_by_email

async def test_seed_sample_users_is_idempotent(db):
    assert await seed_sample_users(db, "sample-dev-only", "development") == len(SAMPLE_USERS)
    assert await seed_sample_users(db, "sample-dev-only", "development") == 0
    admin = await find_user_by_email(db, "admin@example.com")
    assert admin.is_admin and admin.name == "관리자"

async def test_seed_refused_in_production(db):
    with pytest.raises(RuntimeError):
        await seed_sample_users(db, "sample-dev-only", "production")
```

```python
# backend/tests/test_migrations.py
import subprocess, sys
def test_alembic_upgrade_and_downgrade(test_database_url_env):
    for args in (["upgrade", "head"], ["downgrade", "base"], ["upgrade", "head"]):
        r = subprocess.run([sys.executable, "-m", "alembic", *args], env=test_database_url_env, capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_auth_store.py tests/test_providers.py tests/test_sample_users.py tests/test_migrations.py -v` → FAIL

- [ ] **Step 3: 모델, 비밀번호·사용자·세션 함수, 공급자, 샘플 계정, Alembic, CLI 구현**

Alembic은 `alembic init alembic` 후 `env.py`가 `get_settings().database_url`과 `Base.metadata`를 쓰게 한다. `0001_users_sessions.py`는 두 테이블과 유일 제약을 만든다(자동 생성 후 검토). `build_context`는 쿠키 `lit_session`을 `user_for_token`으로 바꿔 `user_id`·`token`에 넣는다.

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest -v` → PASS

- [ ] **Step 5: 개발 DB에 적용하고 샘플 계정 생성**

```powershell
cd backend; uv run alembic upgrade head
uv run python -m app.cli seed-sample-users
```
Expected: `created 3 sample users`

- [ ] **Step 6: 커밋**

```bash
git status
git add backend/alembic.ini backend/alembic backend/app backend/tests
git commit -m "feat: 사용자·세션 저장, 인증 공급자 구조, 샘플 계정"
```

---

### Task 6: 로그인 RPC (litpage 화면 규격)

**Files:**
- Create: `backend/app/auth/handlers.py`
- Modify: `backend/app/main.py` (처리 함수 모듈 import로 등록, 앱 상태 `app.state.auth_provider`에 `get_auth_provider(settings)` 보관), `backend/tests/conftest.py` (픽스처 `use_auth_provider`)
- Test: `backend/tests/test_sign_in.py`

**Interfaces:**
- Consumes: Task 4 `rpc`, `RpcContext`, 오류 클래스 · Task 5 사용자·세션 함수, `get_auth_provider`, `provision_external_user`
- Produces (RPC 이름 = litpage 화면이 부르는 이름):
  - `checkSignInMethods({email})` → `{"hasAccount": bool, "passwordSignIn": bool, "mustReverify": False}`. 로컬 공급자: 계정이 있으면 둘 다 `True`. 자동 생성 공급자(`allows_provisioning`): 둘 다 항상 `True`
  - `signInWithEmail({email, password})` → 공급자 `authenticate` 성공 시 사용자 확인(없으면 `allows_provisioning`일 때만 `provision_external_user`), 세션 생성, `{"userId": str, "isNewUser": bool}` + `Set-Cookie`. 실패는 401 `"이메일 또는 비밀번호가 올바르지 않습니다."`. `password` 없이 `code`만 오면 400 `"이메일 코드 로그인은 지원하지 않습니다. 비밀번호로 로그인해 주세요."`
  - `sendSignInCode({email})` → 항상 400, 위와 같은 메시지
  - `signOut({})` → `{}` + `clear_session_cookie`, 세션 삭제
  - `loadAccountData({})` → 로그인 안 됨 401 `UnauthorizedError` / 로그인됨 `{"recordMap": {...}, "lsn": 0, "demoMode": {"enabled": False}}`. `recordMap`은 litpage `RecordMap` 형식: `{"lit_user": {uid: {"value": {"value": <UserRecord>, "role": "editor"}}}, "user_root": {uid: {"value": {"value": {"id": uid, "version": 1, "space_views": []}, "role": "editor"}}}, "user_settings": {uid: {"value": {"value": {"id": uid, "version": 1, "settings": {"locale": "ko-KR"}}, "role": "editor"}}}}`. `UserRecord` = `{"id", "version": 1, "email", "name", "onboarding_completed": False, "created_time": <ms>}`

- [ ] **Step 1: 실패하는 테스트 작성**

```python
# backend/tests/test_sign_in.py
import pytest
from app.auth.providers import Identity
from app.auth.users import create_user

@pytest.fixture
async def user(db):
    return await create_user(db, "hong@example.com", "홍길동", "secret-123")

async def call(client, name, body=None):
    return await client.post(f"/api/rpc/{name}", json=body or {})

async def test_check_sign_in_methods(client, user):
    assert (await call(client, "checkSignInMethods", {"email": "hong@example.com"})).json() == {"hasAccount": True, "passwordSignIn": True, "mustReverify": False}
    assert (await call(client, "checkSignInMethods", {"email": "none@example.com"})).json()["hasAccount"] is False

async def test_sign_in_sets_cookie_and_loads_account(client, user):
    res = await call(client, "signInWithEmail", {"email": "hong@example.com", "password": "secret-123"})
    assert res.status_code == 200 and res.json() == {"userId": user.id, "isNewUser": False}
    assert "lit_session=" in res.headers["set-cookie"] and "HttpOnly" in res.headers["set-cookie"]
    data = (await call(client, "loadAccountData")).json()
    assert data["recordMap"]["lit_user"][user.id]["value"]["value"]["name"] == "홍길동"
    assert data["recordMap"]["user_root"][user.id]["value"]["value"]["space_views"] == []
    assert data["recordMap"]["user_settings"][user.id]["value"]["value"]["settings"]["locale"] == "ko-KR"
    assert data["demoMode"] == {"enabled": False}

async def test_sign_in_normalizes_email(client, user):
    assert (await call(client, "signInWithEmail", {"email": "  HONG@Example.com ", "password": "secret-123"})).status_code == 200

async def test_sign_in_wrong_password_and_unknown_email_look_the_same(client, user):
    a = await call(client, "signInWithEmail", {"email": "hong@example.com", "password": "nope"})
    b = await call(client, "signInWithEmail", {"email": "ghost@example.com", "password": "nope"})
    for r in (a, b):
        assert r.status_code == 401
        assert r.json()["message"] == "이메일 또는 비밀번호가 올바르지 않습니다."

async def test_code_sign_in_not_supported(client, user):
    for name, body in (("sendSignInCode", {"email": "hong@example.com"}), ("signInWithEmail", {"email": "hong@example.com", "code": "123456"})):
        r = await call(client, name, body)
        assert r.status_code == 400 and "비밀번호로 로그인" in r.json()["message"]

class FakeMailProvider:
    name = "mail"
    allows_provisioning = True
    async def authenticate(self, db, email, password):
        return Identity(email=email, name="박영희", external_id="mail-1") if password == "mail-pw" else None

async def test_sign_in_with_provisioning_provider(client, use_auth_provider):
    # use_auth_provider: conftest 픽스처, 앱이 쓰는 공급자를 테스트 동안 바꿔 끼움
    use_auth_provider(FakeMailProvider())
    first = await call(client, "signInWithEmail", {"email": "park@company.co.kr", "password": "mail-pw"})
    assert first.status_code == 200 and first.json()["isNewUser"] is True
    await call(client, "signOut")
    again = await call(client, "signInWithEmail", {"email": "park@company.co.kr", "password": "mail-pw"})
    assert again.json() == {"userId": first.json()["userId"], "isNewUser": False}

async def test_load_account_data_anonymous(client):
    r = await call(client, "loadAccountData")
    assert r.status_code == 401 and r.json()["name"] == "UnauthorizedError"
    client.cookies.set("lit_session", "garbage")
    assert (await call(client, "loadAccountData")).status_code == 401

async def test_sign_out_clears_session(client, user):
    await call(client, "signInWithEmail", {"email": "hong@example.com", "password": "secret-123"})
    r = await call(client, "signOut")
    assert "Max-Age=0" in r.headers["set-cookie"]
    assert (await call(client, "loadAccountData")).status_code == 401
```

`conftest.py`에 픽스처 `use_auth_provider`(앱 상태의 공급자를 바꾸고 테스트 후 원래대로)를 추가한다.

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_sign_in.py -v` → FAIL (`NotFound`)

- [ ] **Step 3: `handlers.py` 구현**

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest -v` → PASS

- [ ] **Step 5: 커밋**

```bash
git status
git add backend/app backend/tests
git commit -m "feat: 인증 공급자를 쓰는 로그인 RPC(확인·로그인·로그아웃·계정 데이터)"
```

---

### Task 7: litpage 화면 가져오기, 한국어 고정, CoolNotion! 이름, 개발 서버 실행

**Files:**
- Create: `frontend/package.json`, `frontend/pnpm-workspace.yaml`, `frontend/tsconfig.base.json`, `frontend/LICENSE`(litpage 원본), `frontend/THIRD_PARTY_NOTICES.md`(litpage 원본), `frontend/apps/web/**`, `frontend/packages/shared/**`(litpage `f55fead`에서 복사), `.claude/launch.json`
- Modify: `frontend/apps/web/vite.config.ts` (API 기본 주소), `frontend/apps/web/src/features/shell/i18n.ts`, `frontend/apps/web/src/features/auth/LoginPage.tsx`(언어 선택 삭제), `frontend/apps/web/src/features/settings/sections/preferences.tsx`(언어 항목 삭제), `frontend/apps/web/src/features/settings/userSettings.ts`(서버 언어 설정 반영 삭제)
- Test: `frontend/apps/web/src/features/shell/i18n.test.ts`

**Interfaces:**
- Produces: `i18n.ts`는 `type Locale = 'ko-KR'`, `getLocale(): 'ko-KR'`, `t(id, defaultMessage, values?)`만 내보낸다. `LOCALES`, `setLocale`, `en-US` 카탈로그는 없앤다. `t()`는 한국어 카탈로그 값을 쓰고, 없을 때만 기본 문구를 쓴다.

- [ ] **Step 1: litpage `f55fead`의 `apps/web`, `packages/shared`, `tsconfig.base.json`, `LICENSE`, `THIRD_PARTY_NOTICES.md`를 `frontend/`로 복사**

`apps/server`, `e2e`, `scripts`, `Dockerfile`, `railway.json`, `.github`는 복사하지 않는다. 복사 원본(임시 폴더)은 저장소 밖에 둔다.

- [ ] **Step 2: 작업 공간 설정과 API 주소**

`frontend/package.json`: `"private": true`, `"packageManager": "pnpm@10.32.1"`, `"engines": {"node": ">=26"}`, `"scripts": {"dev": "pnpm --filter @nc/web dev", "typecheck": "pnpm -r typecheck", "test": "pnpm -r test"}`. `pnpm-workspace.yaml`: `packages: [packages/*, apps/*]`. `vite.config.ts`의 `process.env.NC_API ?? 'http://127.0.0.1:3001'`을 `'http://127.0.0.1:8000'`으로.

- [ ] **Step 3: 실패하는 테스트 작성**

```ts
// frontend/apps/web/src/features/shell/i18n.test.ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import ko from './i18n.ko-KR.json';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.tsx?$/.test(n) && !n.endsWith('.test.ts') ? [p] : [];
  });
}

describe('한국어 고정', () => {
  beforeEach(() => vi.resetModules());

  it('locale stays Korean even if en-US was stored', async () => {
    localStorage.setItem('nc:locale', 'en-US');
    const i18n = await import('./i18n.ts');
    expect(i18n.getLocale()).toBe('ko-KR');
    expect(document.documentElement.lang).toBe('ko');
  });

  it('exports no language switching', async () => {
    const i18n: Record<string, unknown> = await import('./i18n.ts');
    expect(i18n.LOCALES).toBeUndefined();
    expect(i18n.setLocale).toBeUndefined();
  });

  it('every t() key has a Korean translation', () => {
    const src = fileURLToPath(new URL('../..', import.meta.url));
    const keys = new Set(sourceFiles(src).flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/\bt\(\s*'(lp\.[^']+)'/g)].map((m) => m[1])));
    const missing = [...keys].filter((k) => !(k in (ko as Record<string, string>)));
    expect(missing).toEqual([]);
  });
});

describe('제품 이름 CoolNotion!', () => {
  it('Korean catalog values never show Litpage', () => {
    const bad = Object.entries(ko as Record<string, string>).filter(([, v]) => /litpage/i.test(v)).map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it('t() default messages never show Litpage', () => {
    const src = fileURLToPath(new URL('../..', import.meta.url));
    const bad = sourceFiles(src).flatMap((f) =>
      [...readFileSync(f, 'utf8').matchAll(/\bt\(\s*'lp\.[^']+'\s*,\s*'((?:[^'\\]|\\.)*)'/g)].filter((m) => /litpage/i.test(m[1])).map((m) => `${f}: ${m[1]}`),
    );
    expect(bad).toEqual([]);
  });

  it('page title is CoolNotion!', () => {
    const html = readFileSync(fileURLToPath(new URL('../../../index.html', import.meta.url)), 'utf8');
    expect(html).toMatch(/<title>CoolNotion!<\/title>/);
  });
});
```

- [ ] **Step 4: 실패 확인**

Run: `pnpm --dir frontend install`, `pnpm --dir frontend --filter @nc/web exec vitest run src/features/shell/i18n.test.ts` → FAIL(`en-US`이면 영어로 시작, `LOCALES`·`setLocale`이 있음)

- [ ] **Step 5: 한국어 고정 구현**

`i18n.ts`를 Interfaces대로 줄이고, `setLocale`·`LOCALES`를 쓰는 곳(로그인 화면 언어 선택, 설정 › 기본 설정의 언어 항목, `userSettings.ts`의 서버 언어 반영)에서 해당 UI와 호출을 지운다. 그 밖의 `getLocale()` 사용처는 그대로 둔다(항상 `ko-KR`).

**이름 바꾸기:** `frontend/apps/web`의 사용자에게 보이는 "Litpage"(대소문자 무관)를 `CoolNotion!`으로 바꾼다 — 한국어 카탈로그 값, `t()` 기본 문구, `index.html`의 `<title>`, `alt`·`aria-label`·`title` 속성, 화면에 직접 적힌 문구. i18n 키(`lp.….litpage_ai` 등), 클래스·저장소 키·URL·패키지 이름은 그대로 둔다. 원본 검사 기준 `apps/web`·`packages/shared`에 "Litpage" 표기 약 470곳, 한국어 카탈로그 값 140곳.

- [ ] **Step 6: 테스트와 타입 검사 통과 확인**

Run: `pnpm --dir frontend test` → PASS(가져온 litpage 테스트 포함. 원본에서도 실패하던 테스트가 있으면 이름과 이유를 기록)
Run: `pnpm --dir frontend typecheck` → 오류 없음

- [ ] **Step 7: 개발 서버 설정 `.claude/launch.json`**

```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "api", "runtimeExecutable": "uv", "runtimeArgs": ["run", "--directory", "backend", "uvicorn", "app.main:app", "--reload", "--host", "127.0.0.1", "--port", "8000"], "port": 8000 },
    { "name": "web", "runtimeExecutable": "pnpm", "runtimeArgs": ["--dir", "frontend", "dev"], "port": 5173 }
  ]
}
```

- [ ] **Step 8: 개발 서버로 확인**

`api`, `web` 서버를 띄우고 `http://127.0.0.1:5173` 접속.
Expected: 브라우저 탭 제목 `CoolNotion!`, 한국어 로그인 화면(언어 선택 없음, "Litpage" 표기 없음) → `admin@example.com` 입력 시 비밀번호 칸 → 샘플 비밀번호로 로그인 → 워크스페이스 만들기(온보딩) 화면. 새로고침해도 로그인 유지. 워크스페이스 만들기는 아직 동작하지 않음(`createWorkspace`는 다음 계획).

- [ ] **Step 9: 커밋**

`git status`로 `node_modules`, `dist`, 캐시가 올라가지 않는지 확인한다.
```bash
git status
git add frontend/package.json frontend/pnpm-workspace.yaml frontend/pnpm-lock.yaml frontend/tsconfig.base.json frontend/LICENSE frontend/THIRD_PARTY_NOTICES.md frontend/apps frontend/packages .claude/launch.json
git commit -m "feat: litpage 화면 가져오기, 한국어 고정, CoolNotion! 이름, FastAPI 개발 서버 연결"
```

---

## 다음 계획 (이 계획 범위 밖)

목표가 "바닐라 노션과 같은 워크스페이스"로 바뀌었다(업무관리시스템 엑셀 기능, 캘린더 첫 화면, 업무 전용 블록 없음). 이 계획이 끝나면 아래를 각각 별도 계획으로 쓴다.

1. **워크스페이스·페이지·블록 편집** — `createWorkspace`, 레코드 저장, `applyChanges`(편집 연산), 권한, 수정 이력. **정할 것:** 실시간 동시 편집 포함 여부, 노션 기본 기능 범위(AI·공개 사이트·자동화·폼·댓글 등)
2. **데이터베이스와 보기** — 표·보드·캘린더 등 보기, 속성, 필터·정렬. **정할 것:** 넣을 보기 종류
3. **사내 메일 시스템 로그인** — `AuthProvider` 구현 추가. **필요한 것:** 메일 시스템 종류(IMAP/SMTP 인증, LDAP, OIDC 등)와 접속 정보
4. **배포** — Docker Compose, 백업. **필요한 것:** 사내 서버 운영체제·사양
