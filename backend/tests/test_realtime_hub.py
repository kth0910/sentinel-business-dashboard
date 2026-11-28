import asyncio
import json

import pytest

from app.realtime.hub import Hub
from app.records.apply import Change


class FakeConn:
    def __init__(self):
        self.sent: list[dict] = []

    async def send_text(self, data: str) -> None:
        self.sent.append(json.loads(data))

    def of(self, kind: str) -> list[dict]:
        return [m for m in self.sent if m["type"] == kind]


class FakeAccess:
    """members: {space_id: {user_ids}}, roles: {(user_id, record_id): role}, pages: {user_id: {page_ids}}"""

    def __init__(self, members=None, roles=None, pages=None):
        self.members = members or {}
        self.roles = roles or {}
        self.pages = pages or {}

    async def space(self, space_id, user_id):
        return user_id in self.members.get(space_id, set())

    async def page(self, page_id, user_id):
        return page_id in self.pages.get(user_id, set())

    async def role(self, table, rec, user_id):
        return self.roles.get((user_id, rec["id"]), "reader")

    async def view(self, table, rec, user_id):
        return rec


def block(id: str, space: str = "s1", **extra) -> Change:
    return Change("block", {"id": id, "version": 3, "space_id": space, **extra}, space)


async def join(hub: Hub, user_id: str, client_id: str = "c"):
    conn = FakeConn()
    client = await hub.connect(conn, user_id, client_id)
    return conn, client


async def test_hello_on_connect():
    hub = Hub(FakeAccess())
    conn, _ = await join(hub, "u1")
    await hub.drain()
    assert conn.sent == [{"type": "hello", "userId": "u1"}]


async def test_ping_pong():
    hub = Hub(FakeAccess())
    conn, client = await join(hub, "u1")
    await hub.handle(client, json.dumps({"type": "ping", "t": 123}))
    await hub.handle(client, json.dumps({"type": "ping"}))
    await hub.handle(client, "not json")
    await hub.drain()
    assert conn.of("pong") == [{"type": "pong", "t": 123}, {"type": "pong", "t": None}]


async def test_subscribe_filters_non_member_spaces():
    hub = Hub(FakeAccess(members={"s1": {"u1"}, "s2": {"u2"}}))
    _, client = await join(hub, "u1")
    await hub.handle(client, json.dumps({"type": "subscribe", "spaceIds": ["s1", "s2", 5]}))
    await hub.drain()
    assert client.spaces == {"s1"}


async def test_broadcast_sends_to_subscribers_with_role():
    access = FakeAccess(members={"s1": {"u1", "u2"}}, roles={("u2", "b1"): "none", ("u1", "b1"): "editor"})
    hub = Hub(access)
    c1, cl1 = await join(hub, "u1", "client-1")
    c2, cl2 = await join(hub, "u2", "client-2")
    for cl in (cl1, cl2):
        await hub.handle(cl, json.dumps({"type": "subscribe", "spaceIds": ["s1"]}))
    await hub.broadcast([block("b1")], "client-1")
    await hub.drain()
    assert c1.of("records") == [
        {
            "type": "records",
            "origin": "client-1",
            "records": [{"table": "block", "id": "b1", "version": 3, "value": {"id": "b1", "version": 3, "space_id": "s1"}, "role": "editor"}],
        }
    ]
    assert c2.of("records") == []


async def test_broadcast_skips_other_workspaces():
    hub = Hub(FakeAccess(members={"s1": {"u1"}, "s2": {"u2"}}))
    c1, cl1 = await join(hub, "u1")
    c2, cl2 = await join(hub, "u2")
    await hub.handle(cl1, json.dumps({"type": "subscribe", "spaceIds": ["s1"]}))
    await hub.handle(cl2, json.dumps({"type": "subscribe", "spaceIds": ["s2"]}))
    await hub.broadcast([block("b1", space="s1")], None)
    await hub.drain()
    assert len(c1.of("records")) == 1
    assert c1.of("records")[0]["origin"] is None
    assert c2.of("records") == []


async def test_owner_records_delivered_without_subscription():
    hub = Hub(FakeAccess())
    c1, _ = await join(hub, "u1")
    c2, _ = await join(hub, "u2")
    sv = Change("space_view", {"id": "sv1", "version": 1, "parent_id": "u1"}, "s1")
    await hub.broadcast([sv], None)
    await hub.drain()
    assert [r["id"] for r in c1.of("records")[0]["records"]] == ["sv1"]
    assert c2.of("records") == []


async def test_open_page_receives_changes_without_subscription():
    # 게스트: 공간을 구독하지 않아도 페이지를 열고 있으면 읽을 수 있는 변경을 받는다
    hub = Hub(FakeAccess(pages={"u1": {"p1"}}))
    c1, cl1 = await join(hub, "u1")
    await hub.handle(cl1, json.dumps({"type": "presence", "pageId": "p1", "data": {}}))
    await hub.broadcast([block("b1")], None)
    await hub.drain()
    assert len(c1.of("records")) == 1


async def test_presence_join_move_leave():
    hub = Hub(FakeAccess(pages={"u1": {"p1", "p2"}, "u2": {"p1", "p2"}}))
    c1, cl1 = await join(hub, "u1", "a")
    c2, cl2 = await join(hub, "u2", "b")
    await hub.handle(cl1, json.dumps({"type": "presence", "pageId": "p1", "data": {"x": 1}}))
    await hub.handle(cl2, json.dumps({"type": "presence", "pageId": "p1", "data": None}))
    await hub.drain()
    last = c1.of("presence")[-1]
    await hub.drain()
    assert last["pageId"] == "p1"
    assert last["viewers"] == [
        {"userId": "u1", "clientId": "a", "data": {"x": 1}},
        {"userId": "u2", "clientId": "b", "data": None},
    ] or last["viewers"] == [
        {"userId": "u2", "clientId": "b", "data": None},
        {"userId": "u1", "clientId": "a", "data": {"x": 1}},
    ]
    assert len(last["viewers"]) == 2
    assert len(c2.of("presence")[-1]["viewers"]) == 2

    # u2가 다른 페이지로 이동 → 남은 u1은 viewers 1명
    await hub.handle(cl2, json.dumps({"type": "presence", "pageId": "p2", "data": None}))
    await hub.drain()
    last = c1.of("presence")[-1]
    await hub.drain()
    assert last["pageId"] == "p1" and [v["userId"] for v in last["viewers"]] == ["u1"]

    # 다시 합류한 뒤 연결이 끊기면 남은 사람이 viewers 1명을 받는다
    await hub.handle(cl2, json.dumps({"type": "presence", "pageId": "p1", "data": None}))
    await hub.drain()
    assert len(c1.of("presence")[-1]["viewers"]) == 2
    await hub.disconnect(cl2)
    await hub.drain()
    last = c1.of("presence")[-1]
    await hub.drain()
    assert [v["userId"] for v in last["viewers"]] == ["u1"]


async def test_presence_on_unopenable_page_is_ignored():
    hub = Hub(FakeAccess())
    c1, cl1 = await join(hub, "u1")
    await hub.handle(cl1, json.dumps({"type": "presence", "pageId": "secret", "data": {}}))
    await hub.drain()
    assert cl1.page is None
    assert c1.of("presence") == []


async def test_presence_too_large_is_dropped():
    hub = Hub(FakeAccess(pages={"u1": {"p1"}}))
    c1, cl1 = await join(hub, "u1")
    await hub.handle(cl1, json.dumps({"type": "presence", "pageId": "p1", "data": {"s": "x" * 4097}}))
    await hub.drain()
    assert c1.of("presence")[-1]["viewers"][0]["data"] is None


async def test_failed_send_drops_client_from_broadcast():
    class Broken(FakeConn):
        async def send_text(self, data):
            raise RuntimeError("closed")

    hub = Hub(FakeAccess())
    client = await hub.connect(Broken(), "u1", "c")
    await hub.drain()
    assert client.open is False
    await hub.broadcast([block("b1")], None)  # 예외 없이 지나가야 한다


async def test_notify_user():
    hub = Hub(FakeAccess())
    c1, _ = await join(hub, "u1")
    c2, _ = await join(hub, "u2")
    await hub.notify_user("u1", {"type": "x"})
    await hub.drain()
    assert c1.of("x") == [{"type": "x"}] and c2.of("x") == []


async def test_stuck_client_does_not_block_broadcast():
    # 읽지 않는 탭: send_text가 영원히 끝나지 않아도 broadcast(요청 경로)는 바로 끝나고, 다른 사람은 받는다
    class Stuck(FakeConn):
        async def send_text(self, data):
            await asyncio.Event().wait()

    hub = Hub(FakeAccess(members={"s1": {"u1", "u2"}}))
    stuck = await hub.connect(Stuck(), "u1", "a")
    c2, cl2 = await join(hub, "u2", "b")
    for cl in (stuck, cl2):
        await hub.handle(cl, json.dumps({"type": "subscribe", "spaceIds": ["s1"]}))
    await asyncio.wait_for(hub.broadcast([block("b1")], None), timeout=1)
    await asyncio.wait_for(hub.broadcast([block("b2")], None), timeout=1)
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    assert [r["id"] for m in c2.of("records") for r in m["records"]] == ["b1", "b2"]
    await hub.disconnect(stuck)
    await hub.disconnect(cl2)


async def test_queue_overflow_closes_connection(monkeypatch):
    import app.realtime.hub as hub_module

    monkeypatch.setattr(hub_module, "MAX_QUEUED", 3)
    closed = []

    class Stuck(FakeConn):
        async def send_text(self, data):
            await asyncio.Event().wait()

        async def close(self):
            closed.append(True)

    hub = Hub(FakeAccess())
    client = await hub.connect(Stuck(), "u1", "a")
    for i in range(6):
        await hub.notify_user("u1", {"type": "x", "i": i})
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    assert client.open is False
    assert closed == [True]
    await hub.disconnect(client)


async def test_disconnect_cancels_writer():
    hub = Hub(FakeAccess())
    _, client = await join(hub, "u1")
    task = client.writer
    await hub.disconnect(client)
    await asyncio.sleep(0)
    assert task.done()
