from typing import Annotated

from fastapi import Depends, FastAPI
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

import app.auth.handlers  # noqa: F401  (RPC 처리 함수 등록)
from app.auth.providers import get_auth_provider
from app.config import get_settings
from app.db import get_db
from app.rpc.router import router as rpc_router


def create_app() -> FastAPI:
    app = FastAPI(title="CoolNotion!")
    app.state.auth_provider = get_auth_provider(get_settings())

    @app.get("/api/health")
    async def health(db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, str]:
        await db.execute(text("SELECT 1"))
        return {"status": "ok", "db": "ok"}

    app.include_router(rpc_router)
    return app


app = create_app()
