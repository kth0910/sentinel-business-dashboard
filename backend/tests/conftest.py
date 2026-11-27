import asyncio
import os
from collections.abc import AsyncIterator, Callable, Iterator

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import create_engine, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

import app.auth.models  # noqa: F401  (테이블을 Base.metadata에 등록)
import app.records.store  # noqa: F401  (레코드 테이블도 등록)
from app.auth.providers import AuthProvider
from app.config import get_settings
from app.db import Base, get_db, make_engine
from app.main import app


@pytest_asyncio.fixture(scope="session")
async def test_engine():
    engine = make_engine(get_settings().test_database_url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def db(test_engine) -> AsyncIterator[AsyncSession]:
    async with test_engine.begin() as conn:
        # RESTART IDENTITY: changes.lsn 시퀀스도 0부터 다시 시작하게 한다.
        names = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
        await conn.execute(text(f"TRUNCATE {names} RESTART IDENTITY CASCADE"))
    session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session


@pytest.fixture
def test_database_url_env(test_engine) -> Iterator[dict[str, str]]:
    """테이블을 모두 지우고 DATABASE_URL을 테스트 DB로 바꾼 환경 변수를 돌려준다. 끝나면 create_all로 복구."""
    url = get_settings().test_database_url
    sync_engine = create_engine(url)

    def reset() -> None:
        with sync_engine.begin() as conn:
            Base.metadata.drop_all(conn)
            conn.execute(text("DROP TABLE IF EXISTS alembic_version"))

    reset()
    try:
        yield {**os.environ, "DATABASE_URL": url}
    finally:
        reset()
        with sync_engine.begin() as conn:
            Base.metadata.create_all(conn)
        sync_engine.dispose()


@pytest_asyncio.fixture
async def client(db: AsyncSession) -> AsyncIterator[httpx.AsyncClient]:
    async def override_get_db() -> AsyncIterator[AsyncSession]:
        yield db

    app.dependency_overrides[get_db] = override_get_db
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


def pytest_asyncio_loop_factories(config, item):
    # Windows에서 psycopg 비동기는 SelectorEventLoop가 필요하다(정책 API는 3.15에서 폐기 예정).
    return {"selector": asyncio.SelectorEventLoop}


@pytest.fixture
def use_auth_provider() -> Iterator[Callable[[AuthProvider], None]]:
    """앱이 쓰는 인증 공급자를 테스트 동안 바꿔 끼우고, 끝나면 원래대로 돌려놓는다."""
    original = app.state.auth_provider

    def set_provider(provider: AuthProvider) -> None:
        app.state.auth_provider = provider

    yield set_provider
    app.state.auth_provider = original
