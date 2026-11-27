from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.providers import AuthProvider


@dataclass
class RpcContext:
    user_id: str | None
    token: str | None
    client_id: str | None
    ip: str
    secure: bool
    db: AsyncSession
    auth_provider: AuthProvider
    cookies: list[str] = field(default_factory=list)  # 응답에 붙일 Set-Cookie 값


Handler = Callable[[RpcContext, dict[str, Any]], Awaitable[dict[str, Any]]]

HANDLERS: dict[str, Handler] = {}


def rpc(name: str) -> Callable[[Handler], Handler]:
    def decorator(handler: Handler) -> Handler:
        if name in HANDLERS:
            raise ValueError(f"이미 등록된 RPC 이름입니다: {name}")
        HANDLERS[name] = handler
        return handler

    return decorator
