import argparse
import asyncio
import getpass
import sys

from app.auth.users import create_user
from app.config import get_settings
from app.db import SessionLocal, engine
from app.dev.join_workspace import join_workspace
from app.dev.sample_users import seed_sample_users


async def _create_user(email: str, name: str, admin: bool, password: str) -> None:
    async with SessionLocal() as db:
        user = await create_user(db, email, name, password, is_admin=admin)
    print(f"created user {user.email}")


async def _seed(password: str, app_env: str) -> None:
    async with SessionLocal() as db:
        count = await seed_sample_users(db, password, app_env)
    print(f"created {count} sample users")


async def _join(email: str, space_id: str, role: str, app_env: str) -> None:
    async with SessionLocal() as db:
        await join_workspace(db, email, space_id, role, app_env)
    print(f"{email} 을(를) 워크스페이스 {space_id} 에 {role} 로 추가했습니다.")


async def _run(coro) -> None:
    try:
        await coro
    finally:
        await engine.dispose()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    cu = sub.add_parser("create-user", help="사용자를 만든다")
    cu.add_argument("--email", required=True)
    cu.add_argument("--name", required=True)
    cu.add_argument("--admin", action="store_true")
    sub.add_parser("seed-sample-users", help="개발용 샘플 계정을 만든다")
    jw = sub.add_parser("join-workspace", help="개발용: 기존 사용자를 워크스페이스에 넣는다")
    jw.add_argument("email")
    jw.add_argument("space_id")
    jw.add_argument("--role", default="editor", choices=["editor", "comment_only", "reader"])
    args = parser.parse_args(argv)
    settings = get_settings()

    try:
        if args.command == "create-user":
            password = getpass.getpass("비밀번호: ")
            if password != getpass.getpass("비밀번호 확인: "):
                print("비밀번호가 서로 다릅니다.", file=sys.stderr)
                return 1
            if not password:
                print("비밀번호를 입력하세요.", file=sys.stderr)
                return 1
            coro = _create_user(args.email, args.name, args.admin, password)
        elif args.command == "join-workspace":
            coro = _join(args.email, args.space_id, args.role, settings.app_env)
        else:
            if not settings.sample_user_password:
                print("SAMPLE_USER_PASSWORD 설정이 필요합니다.", file=sys.stderr)
                return 1
            coro = _seed(settings.sample_user_password, settings.app_env)

        # psycopg 비동기는 Windows에서 SelectorEventLoop가 필요하다.
        with asyncio.Runner(loop_factory=asyncio.SelectorEventLoop) as runner:
            runner.run(_run(coro))
    except (ValueError, RuntimeError) as err:
        print(str(err), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
