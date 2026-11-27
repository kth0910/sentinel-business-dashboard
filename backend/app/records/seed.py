"""사용자·워크스페이스 레코드 만들기: 원본 litpage-ref/apps/server/src/seed.ts의 createUser·createWorkspace·createPage를
옮긴 것. 시작 내용은 한국어로 바꿨고, 모든 함수는 커밋하지 않는다(호출하는 쪽이 커밋한다).
"""
import random
import re
import unicodedata
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.records.store import get_record, new_id, now_ms, put_record

RichText = list[list[Any]]


async def save(db: AsyncSession, table: str, rec: dict) -> dict:
    """이전 version + 1(처음이면 1)로 저장한다."""
    prev = await get_record(db, table, rec["id"])
    rec["version"] = (prev["version"] if prev else 0) + 1
    await put_record(db, table, rec)
    return rec


async def ensure_user_records(db: AsyncSession, user: User) -> None:
    """lit_user·user_root·user_settings가 없을 때만 만든다(있으면 그대로)."""
    if await get_record(db, "lit_user", user.id) is None:
        await save(db, "lit_user", {
            "id": user.id, "email": user.email.lower(), "name": user.name, "given_name": user.name,
            "created_time": int(user.created_at.timestamp() * 1000), "onboarding_completed": False,
        })
    if await get_record(db, "user_root", user.id) is None:
        await save(db, "user_root", {"id": user.id, "space_views": []})
    if await get_record(db, "user_settings", user.id) is None:
        await save(db, "user_settings", {
            "id": user.id,
            "settings": {
                "locale": "ko-KR", "time_zone": "Asia/Seoul", "start_day_of_week": 0, "preferred_theme": "system",
            },
        })


def slug_domain(name: str) -> str:
    """원본 slugDomain과 같다: 영문·숫자만 남기고(한글만이면 `workspace`) 뒤에 4자리 숫자를 붙인다."""
    base = re.sub(r"[^a-z0-9]+", "", unicodedata.normalize("NFKD", name.lower()))[:24] or "workspace"
    return f"{base}{random.randint(1000, 9999)}"


def _t(text: str) -> RichText:
    return [[text]]


def _welcome_content() -> list[dict]:
    return [
        {"type": "text", "title": _t("👋 CoolNotion!에 오신 것을 환영합니다. 이 페이지는 마음껏 연습해 봐도 됩니다.")},
        {"type": "to_do", "title": _t("/ 를 입력해 제목, 콜아웃, 하위 페이지를 추가해 보세요.")},
        {"type": "to_do", "title": _t("줄 왼쪽의 ⋮⋮ 손잡이를 끌어 순서를 바꿔 보세요.")},
        {"type": "to_do", "title": _t("데이터베이스를 만들고 표, 보드, 캘린더 보기로 바꿔 보세요.")},
        {"type": "to_do", "title": _t("페이지를 팀원과 공유하고 편집·댓글·읽기 권한을 골라 보세요.")},
        {"type": "to_do", "title": _t("Ctrl + P로 페이지를 찾고, Ctrl + K로 빠른 실행을 열어 보세요.")},
        {
            "type": "callout", "title": _t("Ctrl + Shift + L로 밝은 화면과 어두운 화면을 바꿀 수 있습니다."),
            "format": {"page_icon": "💡", "block_color": "gray_background"},
        },
    ]


async def _make_blocks(
    db: AsyncSession, specs: list[dict], parent_id: str, parent_table: str, space_id: str, user_id: str, now: int,
) -> list[str]:
    ids: list[str] = []
    for s in specs:
        bid = new_id()
        child_ids = await _make_blocks(db, s["children"], bid, "block", space_id, user_id, now) if s.get("children") else []
        block: dict[str, Any] = {
            "id": bid, "type": s["type"],
            "properties": {**({"title": s["title"]} if s.get("title") else {}), **(s.get("props") or {})},
            "parent_id": parent_id, "parent_table": parent_table, "space_id": space_id, "alive": True,
            "created_time": now, "created_by_id": user_id, "created_by_table": "lit_user",
            "last_edited_time": now, "last_edited_by_id": user_id, "last_edited_by_table": "lit_user",
        }
        if child_ids:
            block["content"] = child_ids
        if s.get("format"):
            block["format"] = s["format"]
        await save(db, "block", block)
        ids.append(bid)
    return ids


async def create_page(
    db: AsyncSession, *, space_id: str, user_id: str, parent_id: str, parent_table: str, title: str,
    icon: str | None = None, content: list[dict] | None = None, permissions: list[dict] | None = None,
) -> dict:
    now = now_ms()
    pid = new_id()
    content_ids = await _make_blocks(db, content or [], pid, "block", space_id, user_id, now)
    page: dict[str, Any] = {
        "id": pid, "type": "page", "properties": {"title": [[title]]}, "content": content_ids,
        "format": {"page_icon": icon} if icon else {},
        "parent_id": parent_id, "parent_table": parent_table, "space_id": space_id, "alive": True,
        "created_time": now, "created_by_id": user_id, "created_by_table": "lit_user",
        "last_edited_time": now, "last_edited_by_id": user_id, "last_edited_by_table": "lit_user",
    }
    if permissions:
        page["permissions"] = permissions
    return await save(db, "block", page)


async def create_workspace(db: AsyncSession, user_id: str, name: str, icon: str | None = None) -> dict:
    """space, 기본 팀 `일반`, 환영 페이지, 팀 홈, space_view를 만들고 user_root에 연결한다. space 레코드를 돌려준다."""
    now = now_ms()
    space_id = new_id()
    space: dict[str, Any] = {
        "id": space_id, "name": name, "icon": icon or "", "domain": slug_domain(name), "pages": [],
        "permissions": [{"type": "user_permission", "role": "owner", "user_id": user_id, "added_timestamp": now}],
        "plan_type": "plus", "created_by_id": user_id, "created_time": now,
        # 사내용이므로 게스트와 공개 페이지는 기본으로 끈다
        "settings": {"allow_members_to_create_pages": True, "allow_guests": False, "allow_public_pages": False},
        "invite_link_code": new_id().replace("-", "")[:20],
    }
    team_id = new_id()
    team: dict[str, Any] = {
        "id": team_id, "space_id": space_id, "name": "일반", "icon": "🏠", "description": "", "team_pages": [],
        "parent_id": space_id, "parent_table": "space", "alive": True,
        "membership": [{"user_id": user_id, "role": "owner", "added_time": now}],
        "settings": {"type": "open", "default_page_role": "editor"}, "created_time": now,
        "created_by_id": user_id, "is_default": True,
    }
    space["default_team_ids"] = [team_id]
    await save(db, "space", space)
    await save(db, "team", team)
    welcome = await create_page(
        db, space_id=space_id, user_id=user_id, parent_id=space_id, parent_table="space",
        title="CoolNotion!에 오신 것을 환영합니다", icon="👋", content=_welcome_content(),
        permissions=[{"type": "user_permission", "role": "editor", "user_id": user_id}],
    )
    team_home = await create_page(
        db, space_id=space_id, user_id=user_id, parent_id=team_id, parent_table="team", title="팀 홈", icon="🏠",
        content=[{"type": "text", "title": _t("이 팀의 문서, 위키, 프로젝트를 모아 두는 공간입니다.")}],
    )
    team["team_pages"] = [team_home["id"]]
    await save(db, "team", team)
    sv_id = new_id()
    await save(db, "space_view", {
        "id": sv_id, "space_id": space_id, "parent_id": user_id, "parent_table": "user_root", "alive": True,
        "private_pages": [welcome["id"]], "bookmarked_pages": [], "joined_teams": [team_id],
        "first_joined_space_time": now, "settings": {},
        "notify_desktop": True, "notify_email": True, "notify_mobile": True,
    })
    root = await get_record(db, "user_root", user_id)
    if root:
        await save(db, "user_root", {**root, "space_views": [*(root.get("space_views") or []), sv_id]})
    return space
