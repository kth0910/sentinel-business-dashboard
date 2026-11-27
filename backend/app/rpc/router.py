import json
import logging
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.sessions import user_for_token
from app.db import get_db
from app.rpc.errors import NotFoundError, RpcError, ValidationError
from app.rpc.registry import HANDLERS, RpcContext

logger = logging.getLogger(__name__)

router = APIRouter()

MAX_BODY_BYTES = 1024 * 1024
SESSION_COOKIE = "lit_session"
INTERNAL_MESSAGE = "요청을 처리하는 중 문제가 발생했습니다."


async def build_context(request: Request, db: AsyncSession) -> RpcContext:
    token = request.cookies.get(SESSION_COOKIE)
    return RpcContext(
        user_id=await user_for_token(db, token),
        token=token,
        client_id=(request.headers.get("x-lit-client-id") or None) and request.headers["x-lit-client-id"][:100],
        ip=request.client.host if request.client else "",
        secure=request.url.scheme == "https",
        db=db,
        auth_provider=request.app.state.auth_provider,
    )


def _error_response(status: int, name: str, message: str, error_id: str | None = None) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"errorId": error_id or uuid.uuid4().hex, "name": name, "message": message},
    )


async def _read_body(request: Request) -> dict[str, Any]:
    if not request.headers.get("content-type", "").lower().startswith("application/json"):
        raise _TypeError()
    raw = b""
    async for chunk in request.stream():
        raw += chunk
        if len(raw) > MAX_BODY_BYTES:
            raise _TooLarge()
    if not raw.strip():
        return {}
    try:
        data = json.loads(raw)
    except ValueError:
        raise ValidationError("요청 본문이 올바른 JSON이 아닙니다.") from None
    return data if isinstance(data, dict) else {}


class _TypeError(RpcError):
    status = 415
    name = "ValidationError"

    def __init__(self) -> None:
        super().__init__("요청 본문은 JSON이어야 합니다.")


class _TooLarge(RpcError):
    status = 413
    name = "ValidationError"

    def __init__(self) -> None:
        super().__init__("요청 본문이 너무 큽니다.")


@router.post("/api/rpc/{name}")
async def call_rpc(name: str, request: Request, db: Annotated[AsyncSession, Depends(get_db)]) -> JSONResponse:
    try:
        handler = HANDLERS.get(name)
        if handler is None:
            raise NotFoundError("알 수 없는 요청입니다.")
        body = await _read_body(request)
        ctx = await build_context(request, db)
        result = await handler(ctx, body)
    except RpcError as err:
        return _error_response(err.status, err.name, err.message)
    except Exception:
        error_id = uuid.uuid4().hex
        logger.exception("RPC %s 처리 중 오류 (errorId=%s)", name, error_id)
        return _error_response(500, "InternalError", INTERNAL_MESSAGE, error_id)
    response = JSONResponse(result)
    for cookie in ctx.cookies:
        response.headers.append("set-cookie", cookie)
    return response
