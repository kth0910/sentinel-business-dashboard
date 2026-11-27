from typing import Any

from sqlalchemy import select

from app.auth.models import User
from app.auth.sessions import clear_session_cookie, create_session, destroy_session, session_cookie
from app.auth.users import find_user_by_email, normalize_email, provision_external_user
from app.rpc.errors import UnauthorizedError, ValidationError
from app.rpc.registry import RpcContext, rpc

SIGN_IN_FAILED = "이메일 또는 비밀번호가 올바르지 않습니다."
CODE_NOT_SUPPORTED = "이메일 코드 로그인은 지원하지 않습니다. 비밀번호로 로그인해 주세요."


def _text(body: dict[str, Any], key: str) -> str:
    value = body.get(key)
    return value if isinstance(value, str) else ""


@rpc("checkSignInMethods")
async def check_sign_in_methods(ctx: RpcContext, body: dict[str, Any]) -> dict[str, Any]:
    email = normalize_email(_text(body, "email"))
    if ctx.auth_provider.allows_provisioning:
        has_account = True
    else:
        has_account = bool(email) and await find_user_by_email(ctx.db, email) is not None
    return {"hasAccount": has_account, "passwordSignIn": has_account, "mustReverify": False}


@rpc("sendSignInCode")
async def send_sign_in_code(ctx: RpcContext, body: dict[str, Any]) -> dict[str, Any]:
    raise ValidationError(CODE_NOT_SUPPORTED)


@rpc("signInWithEmail")
async def sign_in_with_email(ctx: RpcContext, body: dict[str, Any]) -> dict[str, Any]:
    email = normalize_email(_text(body, "email"))
    password = body.get("password")
    if not isinstance(password, str) or not password:
        if body.get("code") is not None:
            raise ValidationError(CODE_NOT_SUPPORTED)
        raise UnauthorizedError(SIGN_IN_FAILED)
    if not email:
        raise UnauthorizedError(SIGN_IN_FAILED)

    provider = ctx.auth_provider
    identity = await provider.authenticate(ctx.db, email, password)
    if identity is None:
        raise UnauthorizedError(SIGN_IN_FAILED)

    is_new = False
    if provider.allows_provisioning:
        is_new = not await _user_exists(ctx, identity.email, provider.name, identity.external_id)
        try:
            user = await provision_external_user(ctx.db, identity, provider.name)
        except ValueError:
            raise UnauthorizedError(SIGN_IN_FAILED) from None
    else:
        user = await find_user_by_email(ctx.db, identity.email)
        if user is None:
            raise UnauthorizedError(SIGN_IN_FAILED)

    token = await create_session(ctx.db, user.id)
    ctx.cookies.append(session_cookie(token, ctx.secure))
    return {"userId": user.id, "isNewUser": is_new}


async def _user_exists(ctx: RpcContext, email: str, source: str, external_id: str | None) -> bool:
    if await find_user_by_email(ctx.db, email) is not None:
        return True
    if external_id is None:
        return False
    found = await ctx.db.scalar(
        select(User.id).where(User.auth_source == source, User.external_id == external_id)
    )
    return found is not None


@rpc("signOut")
async def sign_out(ctx: RpcContext, body: dict[str, Any]) -> dict[str, Any]:
    await destroy_session(ctx.db, ctx.token)
    ctx.cookies.append(clear_session_cookie(ctx.secure))
    return {}


def _entry(value: dict[str, Any]) -> dict[str, Any]:
    return {"value": {"value": value, "role": "editor"}}


@rpc("loadAccountData")
async def load_account_data(ctx: RpcContext, body: dict[str, Any]) -> dict[str, Any]:
    if ctx.user_id is None:
        raise UnauthorizedError("로그인이 필요합니다.")
    user = await ctx.db.get(User, ctx.user_id)
    if user is None:
        raise UnauthorizedError("로그인이 필요합니다.")
    uid = user.id
    user_record = {
        "id": uid,
        "version": 1,
        "email": user.email,
        "name": user.name,
        "onboarding_completed": False,
        "created_time": int(user.created_at.timestamp() * 1000),
    }
    return {
        "recordMap": {
            "lit_user": {uid: _entry(user_record)},
            "user_root": {uid: _entry({"id": uid, "version": 1, "space_views": []})},
            "user_settings": {uid: _entry({"id": uid, "version": 1, "settings": {"locale": "ko-KR"}})},
        },
        "lsn": 0,
        "demoMode": {"enabled": False},
    }
