"""通用 JSON 适配器：直接读取 codeviz/v1 数据。"""

from __future__ import annotations

import json
from pathlib import Path

from codeviz.adapters.generic import load_data


def test_load_minimal_data(minimal_data_path: Path, minimal_data: dict) -> None:
    data = load_data(minimal_data_path)

    assert data["schema"] == "codeviz/v1"
    assert data == minimal_data


def test_load_data_top_level_keys(minimal_data_path: Path) -> None:
    data = load_data(minimal_data_path)

    for key in (
        "project",
        "index",
        "groups",
        "modules",
        "moduleEdges",
        "files",
        "fileEdges",
        "symbols",
        "calls",
        "entries",
        "overlays",
    ):
        assert key in data, f"缺少顶层字段 {key}"

    assert data["project"]["name"] == "minimal-fixture"
    assert data["modules"][0]["id"] == "router:demo"
    assert data["symbols"][0]["kind"] == "function"
    assert data["calls"][0]["target"] == "function:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    assert data["entries"][0]["label"] == "POST /api/demo"
    assert data["overlays"][0]["type"] == "layers"


def test_load_data_missing_file_raises(tmp_path: Path) -> None:
    missing = tmp_path / "nope.json"

    try:
        load_data(missing)
    except Exception as exc:  # 文件不存在应显式失败，而不是返回空结构
        assert exc is not None
    else:  # pragma: no cover - 明确失败信息
        raise AssertionError("读取不存在的 JSON 应抛异常")


def test_load_data_roundtrip_json(minimal_data_path: Path) -> None:
    data = load_data(minimal_data_path)

    assert json.loads(json.dumps(data, ensure_ascii=False))["schema"] == "codeviz/v1"
