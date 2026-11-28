from typing import Annotated

from fastapi import Depends, FastAPI
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

import app.auth.handlers  # noqa: F401  (RPC 처리 함수 등록)
import app.records.handlers  # noqa: F401  (레코드 RPC 처리 함수 등록)
from app.auth.providers import get_auth_provider
from app.config import get_settings
from app.db import get_db
from app.realtime.endpoint import hub
from app.realtime.endpoint import router as ws_router
from app.records.apply import on_commit
from app.rpc.router import router as rpc_router

_hooked = False


def create_app() -> FastAPI:
    app = FastAPI(title="CoolNotion!")
    app.state.auth_provider = get_auth_provider(get_settings())

    @app.get("/api/health")
    async def health(db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, str]:
        await db.execute(text("SELECT 1"))
        return {"status": "ok", "db": "ok"}

    app.include_router(rpc_router)
    app.include_router(ws_router)
    global _hooked
    if not _hooked:  # create_app이 여러 번 불려도 방송 훅은 한 번만 등록한다
        on_commit(hub.broadcast)
        _hooked = True
    return app


app = create_app()
