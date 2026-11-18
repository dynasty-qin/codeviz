"""示例项目入口：装配路由并提供一个可直接跑通的冒烟场景。"""

from __future__ import annotations

from .container import CONTAINER
from .router import report_router, task_router


def build_app() -> dict:
    """把各 router 的 ROUTES 合并成一张路由表。"""
    routes: dict = {}
    for table in (task_router.ROUTES, report_router.ROUTES):
        for key, handler in table.items():
            routes[key] = handler
    return routes


def dispatch(routes: dict, key: str, payload: dict) -> dict:
    """按 "METHOD /path" 调用处理函数。"""
    handler = routes.get(key)
    if handler is None:
        return {"ok": False, "error": f"未注册的路由: {key}"}
    try:
        return handler(payload)
    except Exception as exc:  # 示例里兜底，真实项目交给中间件
        return {"ok": False, "error": f"内部错误: {exc}"}


def demo() -> dict:
    """跑一遍创建 -> 完成 -> 日报 的最小流程。"""
    routes = build_app()
    created = dispatch(routes, "POST /api/tasks", {"title": "写周报", "minutes": 30})
    task = created.get("task") or {}
    if task.get("task_id"):
        dispatch(routes, "POST /api/tasks/{task_id}/complete", {"task_id": task["task_id"]})
    dispatched = dispatch(routes, "GET /api/reports", {})
    return {"created": created, "report": dispatched}


if __name__ == "__main__":
    for key, value in demo().items():
        print(key, value)
