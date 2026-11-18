"""日报相关 HTTP 路由。"""

from __future__ import annotations

from collections.abc import Callable

from ..container import CONTAINER
from ..util import ValidationError

ROUTES: dict[str, Callable[[dict], dict]] = {}


def route(method: str, path: str):
    """注册一条路由。"""

    def register(func: Callable[[dict], dict]) -> Callable[[dict], dict]:
        ROUTES[f"{method.upper()} {path}"] = func
        return func

    return register


@route("GET", "/api/reports")
def get_report(payload: dict) -> dict:
    """生成日报摘要。"""
    owner = payload.get("owner", "me")
    try:
        summary = CONTAINER.get_report_service().summary(owner)
    except ValidationError as exc:
        return {"ok": False, "error": str(exc)}
    return {"ok": True, "report": summary}


@route("GET", "/api/reports/status")
def get_status_board(payload: dict) -> dict:
    """按状态分组的看板数据。"""
    owner = payload.get("owner", "me")
    buckets = CONTAINER.get_report_service().group_by_status(owner)
    counts = {}
    for status, tasks in buckets.items():
        counts[status] = len(tasks)
    return {"ok": True, "counts": counts}
