"""pytest 公共夹具。

从仓库根跑 `pytest codeviz/tests` 时，`codeviz` 包本身不在 sys.path 上；
这里把 `codeviz/`（pyproject 所在目录）加进去，避免依赖 `pip install -e`。
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

import pytest

PACKAGE_ROOT = Path(__file__).resolve().parents[1]  # <repo>/codeviz
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

DEMO_DIR = PACKAGE_ROOT / "examples" / "demo"
FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _codegraph_fixture import index_project  # noqa: E402


@pytest.fixture(scope="session")
def demo_dir() -> Path:
    """仓库内 demo 的原始路径（只读）。"""
    assert DEMO_DIR.is_dir(), f"示例项目缺失: {DEMO_DIR}"
    return DEMO_DIR


@pytest.fixture(scope="session")
def indexed_demo(tmp_path_factory) -> tuple[Path, dict]:
    """把 demo 复制到临时目录，并生成最小 CodeGraph 索引。"""
    project = tmp_path_factory.mktemp("demo_project")
    shutil.copytree(
        DEMO_DIR,
        project,
        dirs_exist_ok=True,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )
    counts = index_project(project, project / ".codegraph" / "codegraph.db")
    return project, counts


@pytest.fixture
def project(indexed_demo) -> Path:
    return indexed_demo[0]


@pytest.fixture
def db_counts(indexed_demo) -> dict:
    return indexed_demo[1]


@pytest.fixture
def demo_config(project: Path) -> dict:
    from codeviz.config import load_config

    return load_config(project)


@pytest.fixture
def demo_data(project: Path, demo_config: dict) -> dict:
    from codeviz.adapters.codegraph import build_data

    return build_data(project, demo_config)


@pytest.fixture(scope="session")
def minimal_data_path() -> Path:
    path = FIXTURE_DIR / "minimal_data.json"
    assert path.is_file(), f"通用 JSON 夹具缺失: {path}"
    return path


@pytest.fixture
def minimal_data(minimal_data_path: Path) -> dict:
    import json

    return json.loads(minimal_data_path.read_text(encoding="utf-8"))
