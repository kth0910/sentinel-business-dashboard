import pytest
from app.dev.sample_users import seed_sample_users, SAMPLE_USERS
from app.auth.users import find_user_by_email

async def test_seed_sample_users_is_idempotent(db):
    assert await seed_sample_users(db, "sample-dev-only", "development") == len(SAMPLE_USERS)
    assert await seed_sample_users(db, "sample-dev-only", "development") == 0
    admin = await find_user_by_email(db, "admin@example.com")
    assert admin.is_admin and admin.name == "관리자"

async def test_seed_refused_in_production(db):
    with pytest.raises(RuntimeError):
        await seed_sample_users(db, "sample-dev-only", "production")
