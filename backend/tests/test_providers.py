import pytest
from app.config import Settings
from app.auth.providers import Identity, LocalPasswordProvider, get_auth_provider
from app.auth.users import create_user, provision_external_user

async def test_local_provider_checks_password(db):
    await create_user(db, "hong@example.com", "홍길동", "secret-123")
    p = LocalPasswordProvider()
    ok = await p.authenticate(db, "hong@example.com", "secret-123")
    assert ok == Identity(email="hong@example.com", name="홍길동", external_id=None)
    assert await p.authenticate(db, "hong@example.com", "nope") is None
    assert await p.authenticate(db, "ghost@example.com", "secret-123") is None

def test_get_auth_provider_by_setting():
    s = Settings(database_url="x", test_database_url="x", auth_provider="local")
    assert get_auth_provider(s).name == "local"
    with pytest.raises(ValueError):
        get_auth_provider(Settings(database_url="x", test_database_url="x", auth_provider="nope"))

async def test_provision_external_user_once(db):
    ident = Identity(email="Park@Company.co.kr", name="박영희", external_id="mail-123")
    first = await provision_external_user(db, ident, source="mail")
    second = await provision_external_user(db, ident, source="mail")
    assert first.id == second.id
    assert first.email == "park@company.co.kr" and first.auth_source == "mail" and first.password_hash is None
