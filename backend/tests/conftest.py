import asyncio
import os
from collections.abc import AsyncIterator, Iterator

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import create_engine, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

import app.auth.models  # noqa: F401  (테이블을 Base.metadata에 등록)
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
        for table in reversed(Base.metadata.sorted_tables):
            await conn.execute(table.delete())
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
