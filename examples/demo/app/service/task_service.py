"""任务领域服务。"""

from __future__ import annotations

from ..models import Task
from ..store import MemoryStore
from ..util import ValidationError, normalize_title, parse_minutes, summarize_titles

MAX_TASKS_PER_OWNER = 50


class TaskNotFound(LookupError):
    """任务不存在。"""


class TaskService:
    """任务创建 / 完成 / 查询。"""

    def __init__(self, store: MemoryStore) -> None:
        self.store = store

    def create(self, title: str | None, minutes: str | int | None, owner: str = "me") -> Task:
        """创建任务；校验失败抛 ValidationError。"""
        clean_title = normalize_title(title)
        clean_minutes = parse_minutes(minutes)
        if len(self.list_by_owner(owner, include_done=True)) >= MAX_TASKS_PER_OWNER:
            raise ValidationError("任务太多，先清理已完成任务")
        task = Task(
            task_id=self._next_id(),
            title=clean_title,
            minutes=clean_minutes,
            owner=owner or "me",
        )
        try:
            self.store.save(task)
        except ValueError as exc:  # 存储层兜底校验
            raise ValidationError(str(exc)) from exc
        return task

    def complete(self, task_id: str) -> Task:
        """完成任务；不存在抛 TaskNotFound。"""
        task = self._load(task_id)
        if task.status == "done":
            return task
        task.complete()
        self.store.save(task)
        return task

    def list_by_owner(self, owner: str, include_done: bool = False) -> list[Task]:
        """按 owner 过滤任务，默认隐藏已完成。"""
        result: list[Task] = []
        for task in self.store.all():
            if task.owner != owner:
                continue
            if not include_done and task.status == "done":
                continue
            result.append(task)
        return result

    def summarize(self, owner: str) -> str:
        """给日报提供一行摘要。"""
        tasks = self.list_by_owner(owner)
        if not tasks:
            return "（暂无任务）"
        return summarize_titles([task.title for task in tasks])

    def _load(self, task_id: str) -> Task:
        try:
            return self.store.get(task_id)
        except KeyError as exc:
            raise TaskNotFound(str(exc)) from exc

    def _next_id(self) -> str:
        return f"T{self.store.count() + 1:04d}"
