from typing import Annotated

from fastapi import Depends, FastAPI
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.rpc.router import router as rpc_router


def create_app() -> FastAPI:
    app = FastAPI(title="CoolNotion!")

    @app.get("/api/health")
    async def health(db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, str]:
        await db.execute(text("SELECT 1"))
        return {"status": "ok", "db": "ok"}

    app.include_router(rpc_router)
    return app


app = create_app()
