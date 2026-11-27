import pytest

from app.auth.providers import Identity
from app.auth.users import create_user
from app.config import get_settings


@pytest.fixture
async def user(db):
    return await create_user(db, "hong@example.com", "홍길동", "secret-123")


async def call(client, name, body=None):
    return await client.post(f"/api/rpc/{name}", json=body or {})


async def test_check_sign_in_methods(client, user):
    assert (await call(client, "checkSignInMethods", {"email": "hong@example.com"})).json() == {
        "hasAccount": True,
        "passwordSignIn": True,
        "mustReverify": False,
    }
    assert (await call(client, "checkSignInMethods", {"email": "none@example.com"})).json()["hasAccount"] is False


async def test_sign_in_sets_cookie_and_loads_account(client, user):
    res = await call(client, "signInWithEmail", {"email": "hong@example.com", "password": "secret-123"})
    assert res.status_code == 200 and res.json() == {"userId": user.id, "isNewUser": False}
    assert "lit_session=" in res.headers["set-cookie"] and "HttpOnly" in res.headers["set-cookie"]
    data = (await call(client, "loadAccountData")).json()
    record = data["recordMap"]["lit_user"][user.id]["value"]
    assert record["role"] == "editor"
    assert record["value"]["name"] == "홍길동"
    assert record["value"]["email"] == "hong@example.com"
    assert record["value"]["onboarding_completed"] is False
    assert record["value"]["created_time"] == int(user.created_at.timestamp() * 1000)
    assert data["recordMap"]["user_root"][user.id]["value"]["value"]["space_views"] == []
    assert data["recordMap"]["user_settings"][user.id]["value"]["value"]["settings"]["locale"] == "ko-KR"
    assert data["lsn"] == 0
    assert data["demoMode"] == {"enabled": False}


async def test_sign_in_normalizes_email(client, user):
    assert (
        await call(client, "signInWithEmail", {"email": "  HONG@Example.com ", "password": "secret-123"})
    ).status_code == 200


async def test_sign_in_wrong_password_and_unknown_email_look_the_same(client, user):
    a = await call(client, "signInWithEmail", {"email": "hong@example.com", "password": "nope"})
    b = await call(client, "signInWithEmail", {"email": "ghost@example.com", "password": "nope"})
    for r in (a, b):
        assert r.status_code == 401
        assert r.json()["message"] == "이메일 또는 비밀번호가 올바르지 않습니다."
        assert "set-cookie" not in r.headers


async def test_code_sign_in_not_supported(client, user):
    for name, body in (
        ("sendSignInCode", {"email": "hong@example.com"}),
        ("signInWithEmail", {"email": "hong@example.com", "code": "123456"}),
    ):
        r = await call(client, name, body)
        assert r.status_code == 400 and "비밀번호로 로그인" in r.json()["message"]


class FakeMailProvider:
    name = "mail"
    allows_provisioning = True

    async def authenticate(self, db, email, password):
        return Identity(email=email, name="박영희", external_id="mail-1") if password == "mail-pw" else None


async def test_sign_in_with_provisioning_provider(client, use_auth_provider):
    use_auth_provider(FakeMailProvider())
    first = await call(client, "signInWithEmail", {"email": "park@company.co.kr", "password": "mail-pw"})
    assert first.status_code == 200 and first.json()["isNewUser"] is True
    await call(client, "signOut")
    again = await call(client, "signInWithEmail", {"email": "park@company.co.kr", "password": "mail-pw"})
    assert again.json() == {"userId": first.json()["userId"], "isNewUser": False}


async def test_check_sign_in_methods_with_provisioning_provider(client, use_auth_provider):
    use_auth_provider(FakeMailProvider())
    r = await call(client, "checkSignInMethods", {"email": "new@company.co.kr"})
    assert r.json() == {"hasAccount": True, "passwordSignIn": True, "mustReverify": False}


async def test_provisioning_never_merges_with_other_source(client, use_auth_provider, user):
    use_auth_provider(FakeMailProvider())
    r = await call(client, "signInWithEmail", {"email": "hong@example.com", "password": "mail-pw"})
    assert r.status_code == 401
    assert r.json()["message"] == "이메일 또는 비밀번호가 올바르지 않습니다."
    assert "set-cookie" not in r.headers


async def test_load_account_data_anonymous(client):
    r = await call(client, "loadAccountData")
    assert r.status_code == 401 and r.json()["name"] == "UnauthorizedError"
    client.cookies.set("lit_session", "garbage")
    assert (await call(client, "loadAccountData")).status_code == 401


async def test_sign_out_clears_session(client, user):
    await call(client, "signInWithEmail", {"email": "hong@example.com", "password": "secret-123"})
    r = await call(client, "signOut")
    assert "Max-Age=0" in r.headers["set-cookie"]
    assert (await call(client, "loadAccountData")).status_code == 401


async def test_cookie_secure_setting_applies_over_http(client, user, monkeypatch):
    creds = {"email": "hong@example.com", "password": "secret-123"}
    plain = await call(client, "signInWithEmail", creds)
    assert not plain.headers["set-cookie"].endswith("; Secure")
    monkeypatch.setattr(get_settings(), "cookie_secure", True)
    secured = await call(client, "signInWithEmail", creds)
    assert secured.headers["set-cookie"].endswith("; Secure")


async def test_send_code_unknown_email_says_not_registered(client, user):
    r = await call(client, "sendSignInCode", {"email": "ghost@example.com"})
    assert r.status_code == 400
    assert r.json()["message"] == "등록되지 않은 이메일입니다. 주소를 확인하거나 관리자에게 문의해 주세요."
