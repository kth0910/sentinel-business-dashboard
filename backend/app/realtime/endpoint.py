"""GET /ws?clientId=... 웹소켓. lit_session 쿠키로 사용자를 확인하고, 허브에 연결해 메시지를 넘긴다."""
from urllib.parse import urlsplit

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.auth.sessions import COOKIE_NAME, user_for_token
from app.db import SessionLocal
from app.realtime.access import DbAccess
from app.realtime.hub import Hub

MAX_MESSAGE_BYTES = 64 * 1024
CLOSE_UNAUTHORIZED = 4401
CLOSE_FORBIDDEN_ORIGIN = 4403
CLOSE_TOO_BIG = 1009

hub = Hub(access=DbAccess())
router = APIRouter()


async def authenticate(token: str | None) -> str | None:
    """세션 토큰 → 사용자 ID(테스트에서 바꿔 끼운다)."""
    async with SessionLocal() as db:
        return await user_for_token(db, token)


def origin_allowed(origin: str | None, host: str | None) -> bool:
    """브라우저가 보낸 Origin이 요청을 받은 Host와 같은 출처인가(Origin이 없으면 브라우저가 아니니 허용)."""
    if not origin:
        return True
    try:
        return bool(host) and urlsplit(origin).netloc == host
    except ValueError:
        return False


@router.websocket("/ws")
async def ws_endpoint(ws: WebSocket) -> None:
    # 핸드셰이크를 받아들이기 전에 닫아 연결을 거절한다(원본도 업그레이드를 거절)
    if not origin_allowed(ws.headers.get("origin"), ws.headers.get("host")):
        await ws.close(code=CLOSE_FORBIDDEN_ORIGIN)
        return
    user_id = await authenticate(ws.cookies.get(COOKIE_NAME))
    if not user_id:
        await ws.close(code=CLOSE_UNAUTHORIZED)
        return
    await ws.accept()
    client = await hub.connect(ws, user_id, ws.query_params.get("clientId") or "")
    try:
        while True:
            raw = await ws.receive_text()
            if len(raw.encode()) > MAX_MESSAGE_BYTES:
                await ws.close(code=CLOSE_TOO_BIG)
                break
            await hub.handle(client, raw)
    except WebSocketDisconnect:
        pass
    finally:
        await hub.disconnect(client)
