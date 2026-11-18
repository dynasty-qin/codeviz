"""服务容器：负责装配 store / service。

router 只依赖容器，不直接 new 服务，方便测试时替换内存实现。
"""

from __future__ import annotations

from .service.report_service import ReportService
from .service.task_service import TaskService
from .store import MemoryStore


class Container:
    def __init__(self) -> None:
        self.store = MemoryStore()
        self.task_service = TaskService(self.store)
        self.report_service = ReportService(self.task_service)

    def get_task_service(self) -> TaskService:
        return self.task_service

    def get_report_service(self) -> ReportService:
        return self.report_service


CONTAINER = Container()
