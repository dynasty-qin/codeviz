"""任务相关 HTTP 路由。

示例项目不依赖 FastAPI：用 `@route(method, path)` 把处理函数登记到 ROUTES，
形状与真实项目的装饰器路由一致，方便 CodeGraph 识别。
"""

from __future__ import annotations

from collections.abc import Callable

from ..container import CONTAINER
from ..util import ValidationError
from ..service.task_service import TaskNotFound

ROUTES: dict[str, Callable[[dict], dict]] = {}


def route(method: str, path: str):
    """注册一条路由。"""

    def register(func: Callable[[dict], dict]) -> Callable[[dict], dict]:
        ROUTES[f"{method.upper()} {path}"] = func
        return func

    return register


@route("POST", "/api/tasks")
def create_task(payload: dict) -> dict:
    """创建任务。"""
    service = CONTAINER.get_task_service()
    try:
        task = service.create(payload.get("title"), payload.get("minutes"), payload.get("owner", "me"))
    except ValidationError as exc:
        return {"ok": False, "error": str(exc)}
    return {"ok": True, "task": task.to_dict()}


@route("GET", "/api/tasks")
def list_tasks(payload: dict) -> dict:
    """按 owner 列出任务。"""
    owner = payload.get("owner", "me")
    tasks = CONTAINER.get_task_service().list_by_owner(owner)
    titles = []
    for task in tasks:
        titles.append(task.title)
    return {"ok": True, "count": len(tasks), "titles": titles}


@route("POST", "/api/tasks/{task_id}/complete")
def complete_task(payload: dict) -> dict:
    """完成任务，幂等。"""
    task_id = payload.get("task_id", "")
    if not task_id:
        return {"ok": False, "error": "缺少 task_id"}
    try:
        task = CONTAINER.get_task_service().complete(task_id)
    except TaskNotFound as exc:
        return {"ok": False, "error": str(exc)}
    return {"ok": True, "task": task.to_dict()}
