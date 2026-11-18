"""CodeGraph SQLite 适配器（CONTRACT 第 2 / 4 节）。

夹具是临时目录里生成的 demo 副本 + `.codegraph/codegraph.db`，
不依赖真实 TeamSync 索引。
"""

from __future__ import annotations

import json
from pathlib import Path

from codeviz.adapters.codegraph import build_data
from codeviz.config import load_config


def test_schema_and_project(project: Path, demo_data: dict) -> None:
    assert demo_data["schema"] == "codeviz/v1"
    project_meta = demo_data["project"]
    assert project_meta["name"] == "codeviz-demo"
    root = Path(str(project_meta.get("root") or ""))
    assert root.is_dir(), "project.root 应指向项目目录"
    assert (root / "codeviz.json").is_file()
    assert project_meta.get("generated_at"), "project.generated_at 应存在"


def test_index_counts(demo_data: dict, db_counts: dict) -> None:
    index = demo_data["index"]

    assert index["files"] == db_counts["files"]
    assert index["nodes"] == db_counts["nodes"]
    assert index["edges"] == db_counts["edges"]
    assert index["routes"] == db_counts["routes"] == 5
    assert index["database"] == ".codegraph/codegraph.db"


def test_files_have_metrics(demo_data: dict) -> None:
    files = {row["path"]: row for row in demo_data["files"]}

    router = files["app/router/task_router.py"]
    assert router["module"] == "router:task_router"
    assert router["group"] == "router"
    assert router["lines"] >= 40
    assert router["functions"] >= 3
    assert router["symbols"] >= 3
    assert router["branches"] >= 2, "task_router 里有 if / try 分支"
    assert router["excepts"] >= 1

    service = files["app/service/task_service.py"]
    assert service["module"] == "service:task_service"
    assert service["group"] == "service"
    assert service["functions"] >= 4
    assert service["excepts"] >= 2

    assert files["app/models.py"]["module"] == "app:models"
    assert files["app/models.py"]["group"] == "app"


def test_modules_aggregate_files_and_symbols(demo_data: dict) -> None:
    modules = {row["id"]: row for row in demo_data["modules"]}

    router = modules["router:task_router"]
    assert router["label"]
    assert router["group"] == "router"
    assert router["fileCount"] == 1
    assert router["files"] == ["app/router/task_router.py"]
    assert router["symbols"] >= 3

    service = modules["service:task_service"]
    assert service["fileCount"] == 1
    assert service["files"] == ["app/service/task_service.py"]
    assert service["symbols"] >= 2

    # 模块内文件数与 symbols 之和要自洽
    for module in demo_data["modules"]:
        assert module["fileCount"] == len(module["files"])
        counted = sum(1 for row in demo_data["files"] if row["module"] == module["id"])
        assert counted == module["fileCount"]


def test_module_edges(project: Path, demo_data: dict) -> None:
    edges = {(row["source"], row["target"]): row for row in demo_data["moduleEdges"]}

    assert ("router:task_router", "service:task_service") in edges
    edge = edges[("router:task_router", "service:task_service")]
    assert edge["weight"] >= 1
    assert isinstance(edge.get("kinds", {}), dict)


def test_file_edges(project: Path, demo_data: dict) -> None:
    edges = {(row["source"], row["target"]): row for row in demo_data["fileEdges"]}

    assert ("app/router/task_router.py", "app/service/task_service.py") in edges
    assert edges[("app/router/task_router.py", "app/service/task_service.py")]["weight"] >= 1
    assert ("app/service/report_service.py", "app/service/task_service.py") in edges


def test_symbols_structure(demo_data: dict) -> None:
    symbols = demo_data["symbols"]
    by_name = {}
    for symbol in symbols:
        by_name.setdefault(symbol["name"], []).append(symbol)

    create = by_name["create"][0]
    assert create["file"] == "app/service/task_service.py"
    assert create["kind"] in ("method", "function")
    assert create["module"] == "service:task_service"
    assert create["group"] == "service"
    assert create["line"] > 0
    assert create["end"] >= create["line"]
    assert create["lines"] == create["end"] - create["line"] + 1
    assert "def create" in create["source"]
    assert len(create["source"].splitlines()) <= 61, "symbols[].source 默认截断 60 行"

    # 所有符号都必须能映射回 files / modules
    module_ids = {row["id"] for row in demo_data["modules"]}
    file_paths = {row["path"] for row in demo_data["files"]}
    for symbol in symbols:
        assert symbol["kind"] in ("function", "method")
        assert symbol["file"] in file_paths
        assert symbol["module"] in module_ids
        assert symbol["id"]


def test_calls_graph(demo_data: dict) -> None:
    by_id = {symbol["id"]: symbol for symbol in demo_data["symbols"]}
    calls = demo_data["calls"]
    assert calls, "demo 里应能抽到调用边"

    for call in calls:
        assert call["source"] in by_id
        assert call["target"] in by_id

    handler = next(
        symbol
        for symbol in demo_data["symbols"]
        if symbol["name"] == "create_task" and symbol["file"].endswith("task_router.py")
    )
    targets = [by_id[call["target"]] for call in calls if call["source"] == handler["id"]]
    assert any(target["file"] == "app/service/task_service.py" for target in targets), "路由应调用 service"


def test_entries_point_to_handlers(demo_data: dict) -> None:
    by_id = {symbol["id"]: symbol for symbol in demo_data["symbols"]}
    entries = {entry["label"]: entry for entry in demo_data["entries"]}

    assert set(entries) >= {
        "POST /api/tasks",
        "GET /api/tasks",
        "POST /api/tasks/{task_id}/complete",
        "GET /api/reports",
        "GET /api/reports/status",
    }
    for label, entry in entries.items():
        assert entry["id"] in by_id, f"{label} 的 id 应指向符号而不是路由节点"
    assert by_id[entries["POST /api/tasks"]["id"]]["name"] == "create_task"
    assert by_id[entries["GET /api/reports"]["id"]]["file"] == "app/router/report_router.py"


def test_overlays_loaded(project: Path, demo_data: dict) -> None:
    overlays = {row["id"]: row for row in demo_data["overlays"]}

    assert "business" in overlays
    business = overlays["business"]
    assert business["type"] == "layers"
    assert business["layers"]
    assert business["layers"][0]["items"]


def test_source_lines_config_respected(project: Path) -> None:
    config = load_config(project)
    config.setdefault("metrics", {})["source_lines"] = 3

    data = build_data(project, config)

    for symbol in data["symbols"]:
        source = symbol.get("source")
        if not source:
            continue
        assert len(source.splitlines()) <= 4, f"{symbol['name']} 的源码未按 source_lines=3 截断"


def test_build_data_is_json_serializable(demo_data: dict) -> None:
    payload = json.dumps(demo_data, ensure_ascii=False)

    assert "codeviz/v1" in payload
    assert "router:task_router" in payload
