"""内存存储，代替真实数据库。

真实项目里这一层是 MySQL / PooledDB，这里用一个 dict 模拟同样的增删改查。
"""

from __future__ import annotations

from .models import Task


class MemoryStore:
    """最小可用的任务仓库。"""

    def __init__(self) -> None:
        self._rows: dict[str, Task] = {}

    def save(self, task: Task) -> Task:
        """写入或覆盖一条任务。"""
        if not task.task_id:
            raise ValueError("task_id 不能为空")
        self._rows[task.task_id] = task
        return task

    def get(self, task_id: str) -> Task:
        """按 id 取任务，不存在时抛 KeyError。"""
        try:
            return self._rows[task_id]
        except KeyError as exc:
            raise KeyError(f"任务不存在: {task_id}") from exc

    def all(self) -> list[Task]:
        """列出全部任务，按 id 排序保证可复现。"""
        return [self._rows[key] for key in sorted(self._rows)]

    def delete(self, task_id: str) -> bool:
        """删除任务，返回是否真的删掉了。"""
        if task_id in self._rows:
            del self._rows[task_id]
            return True
        return False

    def count(self) -> int:
        return len(self._rows)
