"""示例项目自身的可运行性 / 配置覆盖率检查。"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from codeviz.config import module_for


def test_demo_file_count(demo_dir: Path) -> None:
    py_files = [
        path
        for path in demo_dir.rglob("*.py")
        if "__pycache__" not in path.parts
    ]

    assert 8 <= len(py_files) <= 12, f"示例项目应保持 8~12 个 Python 文件，当前 {len(py_files)}"


def test_demo_layers_exist(demo_dir: Path) -> None:
    app = demo_dir / "app"

    assert (app / "router" / "task_router.py").is_file()
    assert (app / "router" / "report_router.py").is_file()
    assert (app / "service" / "task_service.py").is_file()
    assert (app / "service" / "report_service.py").is_file()
    assert (app / "main.py").is_file()


def test_demo_config_covers_every_file(demo_dir: Path, demo_config: dict) -> None:
    for path in sorted(demo_dir.rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        rel = path.relative_to(demo_dir).as_posix()
        module_id, group = module_for(rel, demo_config)
        assert module_id, f"{rel} 没有映射到模块"
        assert group != "other", f"{rel} 落到了默认分组，示例配置应显式覆盖"


def test_demo_runs(project: Path) -> None:
    """在临时副本里跑，避免在仓库内留下 __pycache__。"""
    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONPATH"] = str(project)

    completed = subprocess.run(
        [sys.executable, "-m", "app.main"],
        cwd=str(project),
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=60,
    )

    assert completed.returncode == 0, completed.stderr
    assert "created" in completed.stdout
    assert "report" in completed.stdout
