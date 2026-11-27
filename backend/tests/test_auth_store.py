import pytest
from datetime import datetime, timedelta, timezone
from sqlalchemy import update
from app.auth.users import create_user, find_user_by_email, normalize_email
from app.auth.passwords import hash_password, verify_password
from app.auth.sessions import create_session, user_for_token, destroy_session, session_cookie
from app.auth.models import AuthSession
from app.rpc.registry import rpc

def test_password_hash_round_trip():
    h = hash_password("secret-123")
    assert h != "secret-123" and h.startswith("$argon2")
    assert verify_password(h, "secret-123") and not verify_password(h, "wrong")

def test_normalize_email():
    assert normalize_email("  Hong@Example.COM ") == "hong@example.com"

async def test_create_and_find_user(db):
    u = await create_user(db, " Hong@Example.com", "홍길동", "secret-123", is_admin=True)
    assert u.email == "hong@example.com" and u.is_admin and u.auth_source == "local"
    assert (await find_user_by_email(db, "HONG@example.com ")).id == u.id

async def test_duplicate_email_rejected(db):
    await create_user(db, "a@example.com", "가", "secret-123")
    with pytest.raises(ValueError):
        await create_user(db, "A@example.com", "나", "secret-123")

async def test_session_round_trip(db):
    u = await create_user(db, "s@example.com", "세션", "secret-123")
    token = await create_session(db, u.id)
    assert await user_for_token(db, token) == u.id
    await destroy_session(db, token)
    assert await user_for_token(db, token) is None

async def test_expired_session_is_anonymous(db):
    u = await create_user(db, "e@example.com", "만료", "secret-123")
    token = await create_session(db, u.id)
    await db.execute(update(AuthSession).values(expires_at=datetime.now(timezone.utc) - timedelta(seconds=1)))
    assert await user_for_token(db, token) is None
    assert await user_for_token(db, "not-a-token") is None
    assert await user_for_token(db, None) is None

def test_session_cookie_format():
    assert session_cookie("tok", secure=False) == "lit_session=tok; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000"
    assert session_cookie("tok", secure=True).endswith("; Secure")


@rpc("_testWhoAmI")
async def _who_am_i(ctx, body):
    return {"userId": ctx.user_id}


async def test_rpc_context_resolves_user_from_cookie(client, db):
    u = await create_user(db, "c@example.com", "쿠키", "secret-123")
    token = await create_session(db, u.id)
    res = await client.post("/api/rpc/_testWhoAmI", json={}, headers={"cookie": f"lit_session={token}"})
    assert res.json()["userId"] == u.id
    res = await client.post("/api/rpc/_testWhoAmI", json={}, headers={"cookie": "lit_session=bogus"})
    assert res.json()["userId"] is None
