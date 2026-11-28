import pytest
from starlette.testclient import TestClient, WebSocketDisconnect

import app.realtime.endpoint as endpoint
from app.auth.sessions import COOKIE_NAME
from app.main import app


@pytest.fixture
def ws_client(monkeypatch):
    async def fake_authenticate(token):
        return "u1" if token == "good" else None

    monkeypatch.setattr(endpoint, "authenticate", fake_authenticate)
    with TestClient(app) as c:
        yield c


def test_ws_rejects_anonymous(ws_client):
    with pytest.raises(WebSocketDisconnect) as e:
        with ws_client.websocket_connect("/ws?clientId=a"):
            pass
    assert e.value.code == 4401


def test_ws_rejects_foreign_origin(ws_client):
    ws_client.cookies.set(COOKIE_NAME, "good")
    with pytest.raises(WebSocketDisconnect) as e:
        with ws_client.websocket_connect("/ws?clientId=a", headers={"Origin": "http://evil.example"}):
            pass
    assert e.value.code == 4403


def test_ws_hello_for_logged_in_user(ws_client):
    ws_client.cookies.set(COOKIE_NAME, "good")
    with ws_client.websocket_connect("/ws?clientId=a", headers={"Origin": "http://testserver"}) as ws:
        assert ws.receive_json() == {"type": "hello", "userId": "u1"}
        ws.send_json({"type": "ping", "t": 7})
        assert ws.receive_json() == {"type": "pong", "t": 7}


def test_ws_oversize_message_closes(ws_client):
    ws_client.cookies.set(COOKIE_NAME, "good")
    with ws_client.websocket_connect("/ws?clientId=a") as ws:
        ws.receive_json()
        ws.send_text("x" * (64 * 1024 + 1))
        with pytest.raises(WebSocketDisconnect) as e:
            ws.receive_json()
        assert e.value.code == 1009


def test_commit_hook_is_registered_once():
    from app.main import create_app
    from app.records import apply

    create_app()
    create_app()
    assert sum(1 for f in apply._commit_hooks if getattr(f, "__self__", None) is endpoint.hub) == 1
