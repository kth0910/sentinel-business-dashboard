from app.rpc.errors import ValidationError
from app.rpc.registry import rpc

import pytest


@rpc("_testEcho")
async def _echo(ctx, body):
    return {"body": body, "userId": ctx.user_id}


@rpc("_testFail")
async def _fail(ctx, body):
    raise ValidationError("값이 올바르지 않습니다.")


@rpc("_testCrash")
async def _crash(ctx, body):
    raise RuntimeError("secret detail")


@rpc("_testCookie")
async def _cookie(ctx, body):
    ctx.cookies.append("a=1; Path=/")
    ctx.cookies.append("b=2; Path=/")
    return {}


@rpc("_testClientId")
async def _client_id(ctx, body):
    return {"clientId": ctx.client_id}


JSON = {"content-type": "application/json"}


async def test_rpc_echoes_json_body(client):
    res = await client.post("/api/rpc/_testEcho", json={"a": 1})
    assert res.status_code == 200
    assert res.json() == {"body": {"a": 1}, "userId": None}


async def test_unknown_rpc_returns_not_found(client):
    res = await client.post("/api/rpc/noSuchThing", json={})
    assert res.status_code == 404
    data = res.json()
    assert data["name"] == "NotFound" and data["message"] and data["errorId"]


async def test_non_json_content_type_is_415(client):
    res = await client.post(
        "/api/rpc/_testEcho",
        content="a=1",
        headers={"content-type": "application/x-www-form-urlencoded"},
    )
    assert res.status_code == 415
    assert res.json()["name"] == "ValidationError"


async def test_broken_json_is_400(client):
    res = await client.post("/api/rpc/_testEcho", content="{oops", headers=JSON)
    assert res.status_code == 400
    assert res.json()["name"] == "ValidationError"


async def test_array_or_empty_body_becomes_empty_object(client):
    assert (await client.post("/api/rpc/_testEcho", content="[1,2]", headers=JSON)).json()["body"] == {}
    assert (await client.post("/api/rpc/_testEcho", content="", headers=JSON)).json()["body"] == {}


async def test_rpc_error_maps_to_status_and_name(client):
    res = await client.post("/api/rpc/_testFail", json={})
    assert res.status_code == 400
    assert res.json()["name"] == "ValidationError"
    assert res.json()["message"] == "값이 올바르지 않습니다."
    assert res.json()["errorId"]


async def test_unexpected_error_hides_details(client):
    res = await client.post("/api/rpc/_testCrash", json={})
    assert res.status_code == 500
    assert res.json()["name"] == "InternalError"
    assert "secret" not in res.json()["message"]
    assert res.json()["errorId"]


async def test_body_over_1mb_is_413(client):
    big = '{"a":"' + "x" * (1024 * 1024) + '"}'
    res = await client.post("/api/rpc/_testEcho", content=big, headers=JSON)
    assert res.status_code == 413
    assert res.json()["name"] == "ValidationError"


async def test_ctx_cookies_become_set_cookie_headers(client):
    res = await client.post("/api/rpc/_testCookie", json={})
    assert res.headers.get_list("set-cookie") == ["a=1; Path=/", "b=2; Path=/"]


def test_duplicate_registration_raises():
    with pytest.raises(ValueError):

        @rpc("_testEcho")
        async def _again(ctx, body):
            return {}


async def test_client_id_comes_from_lit_header_and_is_cut_to_100(client):
    res = await client.post("/api/rpc/_testClientId", json={}, headers={"x-lit-client-id": "a" * 150})
    assert res.json()["clientId"] == "a" * 100
    res = await client.post("/api/rpc/_testClientId", json={})
    assert res.json()["clientId"] is None
