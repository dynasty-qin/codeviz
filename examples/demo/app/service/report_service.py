"""日报聚合服务。"""

from __future__ import annotations

from ..models import Report, Task
from ..util import summarize_titles
from .task_service import TaskService


class ReportService:
    """把任务聚合成日报。"""

    def __init__(self, task_service: TaskService) -> None:
        self.task_service = task_service

    def build(self, owner: str, include_done: bool = True) -> Report:
        """生成某个人的日报。"""
        tasks = self.task_service.list_by_owner(owner, include_done=include_done)
        report = Report(owner=owner)
        for task in tasks:
            report.add_task(task)
        return report

    def summary(self, owner: str) -> dict:
        """日报摘要：条数、工时、标题一行流。"""
        report = self.build(owner)
        done = 0
        overtime = 0
        for task in report.tasks:
            if task.status == "done":
                done += 1
            if task.is_overtime():
                overtime += 1
        return {
            "owner": owner,
            "count": len(report.tasks),
            "done": done,
            "overtime": overtime,
            "total_minutes": report.total_minutes,
            "titles": summarize_titles([task.title for task in report.tasks]),
        }

    def group_by_status(self, owner: str) -> dict[str, list[Task]]:
        """按状态分组，供前端看板使用。"""
        buckets: dict[str, list[Task]] = {}
        for task in self.build(owner).tasks:
            buckets.setdefault(task.status, []).append(task)
        return buckets
