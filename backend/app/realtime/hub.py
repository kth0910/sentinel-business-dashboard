"""실시간 허브: 같은 공간 사용자에게 레코드 변경을 밀어 주고, 페이지를 보는 사람(접속자)을 중계한다.

원본 litpage-ref/apps/server/src/realtime.ts를 옮긴 것. 메시지 모양은 원본과 같다.
허브는 메모리에만 산다(uvicorn 워커 하나 기준). 접근 확인은 주입받는 비동기 콜백이라 테스트에서는 가짜를 넣는다.
옮기지 않은 것: endUserSessions·isConnected(데모 샌드박스·알림 메일 기능이 아직 없다).
"""
import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import Any, Protocol

from app.records.apply import Change

logger = logging.getLogger(__name__)

MAX_PRESENCE_CHARS = 4096
MAX_SUBSCRIBE = 100
# 클라이언트마다 보내기를 기다리는 메시지가 이만큼 쌓이면(읽지 않는 탭) 연결을 닫는다
MAX_QUEUED = 1000


class Connection(Protocol):
    async def send_text(self, data: str) -> None: ...


class Access(Protocol):
    async def page(self, page_id: str, user_id: str) -> bool:
        """user_id가 page_id를 열 수 있나(그 페이지의 접속자를 보고 보일 수 있나)."""

    async def space(self, space_id: str, user_id: str) -> bool:
        """user_id가 워크스페이스 space_id의 멤버인가."""

    async def role(self, table: str, rec: dict, user_id: str) -> str:
        """레코드에 대한 user_id의 역할."""

    async def view(self, table: str, rec: dict, user_id: str) -> dict:
        """user_id가 볼 수 있는 모양의 레코드(예: 다른 사용자의 이메일 제거)."""


@dataclass(eq=False)
class Client:
    conn: Connection
    user_id: str
    client_id: str
    spaces: set[str] = field(default_factory=set)
    page: str | None = None
    presence: dict | None = None
    open: bool = True
    queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    writer: asyncio.Task | None = None


class Hub:
    def __init__(self, access: Access):
        self.access = access
        self.clients: set[Client] = set()
        self._closing: set[asyncio.Future] = set()

    async def _writer(self, client: Client) -> None:
        """클라이언트 하나의 전송 전담 태스크: 순서대로 보내고, 느려도 방송 쪽(요청 경로)을 붙잡지 않는다."""
        try:
            while True:
                data = await client.queue.get()
                try:
                    await client.conn.send_text(data)
                except Exception:
                    client.open = False  # 이미 끊긴 연결: 이후 방송에서 빼고, 정리는 disconnect가 맡는다
                    return
                finally:
                    client.queue.task_done()
        except asyncio.CancelledError:
            pass

    async def _send(self, client: Client, payload: Any) -> None:
        """큐에 넣고 바로 돌아온다(원본 ws.send처럼). 큐가 넘치면 그 연결을 닫는다."""
        if not client.open:
            return
        if client.queue.qsize() >= MAX_QUEUED:
            self._drop(client)
            return
        client.queue.put_nowait(payload if isinstance(payload, str) else json.dumps(payload))

    def _drop(self, client: Client) -> None:
        client.open = False
        if client.writer:
            client.writer.cancel()
        close = getattr(client.conn, "close", None)
        if close:
            task = asyncio.ensure_future(self._close(close))
            self._closing.add(task)
            task.add_done_callback(self._closing.discard)

    @staticmethod
    async def _close(close) -> None:
        try:
            await asyncio.wait_for(close(), timeout=5)
        except Exception:
            pass

    async def drain(self) -> None:
        """지금까지 큐에 넣은 메시지가 모두 전송될 때까지 기다린다(테스트용)."""
        for c in list(self.clients):
            if c.open:
                await c.queue.join()

    async def connect(self, conn: Connection, user_id: str, client_id: str) -> Client:
        client = Client(conn=conn, user_id=user_id, client_id=client_id[:100])
        client.writer = asyncio.ensure_future(self._writer(client))
        self.clients.add(client)
        await self._send(client, {"type": "hello", "userId": user_id})
        return client

    async def disconnect(self, client: Client) -> None:
        client.open = False
        if client.writer:
            client.writer.cancel()
        self.clients.discard(client)
        if client.page:
            await self._send_presence(client.page)

    async def handle(self, client: Client, raw: str) -> None:
        try:
            msg = json.loads(raw)
        except ValueError:
            return
        if not isinstance(msg, dict):
            return
        kind = msg.get("type")
        if kind == "subscribe" and isinstance(msg.get("spaceIds"), list):
            # 멤버인 공간만(레코드별 권한 검사는 방송 때마다 따로 한다)
            spaces: set[str] = set()
            for sid in msg["spaceIds"][:MAX_SUBSCRIBE]:
                if isinstance(sid, str) and await self.access.space(sid, client.user_id):
                    spaces.add(sid)
            client.spaces = spaces
        elif kind == "presence":
            prev = client.page
            page_id = msg.get("pageId") if isinstance(msg.get("pageId"), str) else None
            # 접속자 정보는 열 수 있는 페이지에서만 나누고, 데이터는 작게 유지한다
            client.page = page_id if page_id and await self.access.page(page_id, client.user_id) else None
            data = msg.get("data")
            if not (isinstance(data, dict) and len(json.dumps(data, separators=(",", ":"), ensure_ascii=False)) <= MAX_PRESENCE_CHARS):
                data = None
            client.presence = data if client.page else None
            if prev and prev != client.page:
                await self._send_presence(prev)
            if client.page:
                await self._send_presence(client.page)
        elif kind == "ping":
            t = msg.get("t")
            await self._send(client, {"type": "pong", "t": t if isinstance(t, (int, float)) and not isinstance(t, bool) else None})

    async def _send_presence(self, page_id: str) -> None:
        viewers = [c for c in list(self.clients) if c.page == page_id]
        payload = json.dumps(
            {
                "type": "presence",
                "pageId": page_id,
                "viewers": [{"userId": c.user_id, "clientId": c.client_id, "data": c.presence} for c in viewers],
            }
        )
        for c in viewers:
            await self._send(c, payload)

    async def broadcast(self, changes: list[Change], origin_client_id: str | None) -> None:
        if not changes:
            return
        for c in list(self.clients):
            if not c.open:
                continue
            visible = []
            for ch in changes:
                rec = ch.record
                if ch.space_id and ch.space_id not in c.spaces and ch.table != "lit_user":
                    # 사용자 소유 레코드(본인의 space_view, user_root, 설정 등)는 구독 없이도 주인에게 간다.
                    # 게스트는 호스트 공간을 구독하지 않으니, 페이지를 열고 있는 동안은 읽을 수 있는 변경을 받는다
                    # (나머지는 아래 역할 검사가 걸러 낸다).
                    owner = c.user_id in (rec.get("parent_id"), rec.get("id"), rec.get("user_id"))
                    if not owner and not c.page:
                        continue
                role = await self.access.role(ch.table, rec, c.user_id)
                if role == "none":
                    continue
                value = await self.access.view(ch.table, rec, c.user_id)
                visible.append({"table": ch.table, "id": rec.get("id"), "version": rec.get("version"), "value": value, "role": role})
            if visible:
                await self._send(c, {"type": "records", "origin": origin_client_id, "records": visible})

    async def notify_user(self, user_id: str, payload: dict) -> None:
        text = json.dumps(payload)
        for c in list(self.clients):
            if c.user_id == user_id:
                await self._send(c, text)
