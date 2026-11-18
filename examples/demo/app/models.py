"""领域模型：任务与日报。"""

from __future__ import annotations

from dataclasses import dataclass, field

STATUS_TODO = "todo"
STATUS_DONE = "done"


@dataclass
class Task:
    """一条工作任务。"""

    task_id: str
    title: str
    minutes: int
    owner: str = "me"
    status: str = STATUS_TODO

    def complete(self) -> None:
        """标记完成；重复完成是幂等的。"""
        if self.status == STATUS_DONE:
            return
        self.status = STATUS_DONE

    def is_overtime(self) -> bool:
        """超过 8 小时算加班。"""
        return self.status != STATUS_DONE and self.minutes > 8 * 60

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "title": self.title,
            "minutes": self.minutes,
            "owner": self.owner,
            "status": self.status,
        }


@dataclass
class Report:
    """某个人某天的日报。"""

    owner: str
    tasks: list[Task] = field(default_factory=list)

    def add_task(self, task: Task) -> None:
        for existing in self.tasks:
            if existing.task_id == task.task_id:
                return
        self.tasks.append(task)

    @property
    def total_minutes(self) -> int:
        total = 0
        for task in self.tasks:
            total += task.minutes
        return total

    def to_dict(self) -> dict:
        done = 0
        for task in self.tasks:
            if task.status == STATUS_DONE:
                done += 1
        return {
            "owner": self.owner,
            "tasks": [task.to_dict() for task in self.tasks],
            "total_minutes": self.total_minutes,
            "done": done,
        }
