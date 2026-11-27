import os
from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings

# psycopg가 libpq를 찾기 전에 설치본 경로를 PATH 앞에 붙인다(psycopg는 엔진 생성 시 처음 불러옴).
_libpq_dir = get_settings().libpq_dir
if _libpq_dir:
    os.environ["PATH"] = _libpq_dir + os.pathsep + os.environ.get("PATH", "")


class Base(DeclarativeBase):
    pass


def make_engine(url: str) -> AsyncEngine:
    return create_async_engine(url)


engine = make_engine(get_settings().database_url)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
