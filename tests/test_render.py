"""渲染输出：site / single-file（CONTRACT 第 1 / 5 节）。"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from codeviz.render import (
    build_project,
    build_single_html,
    render_single_file,
    render_site,
    web_dir,
)

VIEW_FILES = ["source.js", "deps.js", "calls.js", "complexity.js", "overlay.js"]


def _extract_data_js(text: str) -> dict:
    marker = "window.CODEVIZ_DATA"
    index = text.find(marker)
    assert index >= 0, "未找到 window.CODEVIZ_DATA"
    brace = text.find("{", index + len(marker))
    assert brace >= 0, "window.CODEVIZ_DATA 后面不是 JSON 对象"
    value, _end = json.JSONDecoder().raw_decode(text[brace:])
    return value


def _find_site_root(result, out_dir: Path) -> Path:
    candidate = Path(result) if result is not None else out_dir
    if candidate.is_file():
        candidate = candidate.parent
    if (candidate / "index.html").is_file():
        return candidate
    if (out_dir / "index.html").is_file():
        return out_dir
    matches = sorted(out_dir.rglob("index.html"))
    assert matches, f"没有生成 index.html（输出目录: {out_dir}）"
    return matches[0].parent


def _find_html(result, out_dir: Path) -> Path:
    candidate = Path(result) if result is not None else out_dir
    if candidate.is_file() and candidate.suffix == ".html":
        return candidate
    matches = sorted(out_dir.rglob("*.html"))
    assert matches, f"单文件模式没有生成 html（输出目录: {out_dir}）"
    index = [path for path in matches if path.name == "index.html"]
    return index[0] if index else matches[0]


def test_render_site(minimal_data: dict, tmp_path: Path) -> None:
    out_dir = tmp_path / "site"

    result = render_site(minimal_data, out_dir)
    root = _find_site_root(result, out_dir)

    assert (root / "index.html").is_file()
    for rel in ("assets/data.js", "assets/app.js", "assets/styles.css"):
        assert (root / rel).is_file(), f"缺少 {rel}"
    for view in VIEW_FILES:
        assert (root / "assets" / "views" / view).is_file(), f"缺少 assets/views/{view}"

    text = (root / "assets" / "data.js").read_text(encoding="utf-8")
    assert "window.CODEVIZ_DATA" in text
    assert _extract_data_js(text)["schema"] == "codeviz/v1"

    html = (root / "index.html").read_text(encoding="utf-8")
    assert "assets/data.js" in html
    assert "assets/app.js" in html


def test_render_site_is_offline_friendly(minimal_data: dict, tmp_path: Path) -> None:
    out_dir = tmp_path / "site"
    root = _find_site_root(render_site(minimal_data, out_dir), out_dir)

    html = (root / "index.html").read_text(encoding="utf-8")
    assert "http://" not in html.replace("http://www.w3.org", ""), "站点不应依赖远程资源"
    assert "https://" not in html.replace("https://www.w3.org", "")


def test_render_single_file(minimal_data: dict, tmp_path: Path) -> None:
    out_dir = tmp_path / "single"

    result = render_single_file(minimal_data, out_dir)
    html_path = _find_html(result, out_dir)

    text = html_path.read_text(encoding="utf-8")
    assert "window.CODEVIZ_DATA" in text
    assert "<style" in text, "单文件必须内联 CSS"
    assert "<script" in text, "单文件必须内联 JS"
    assert "codeviz/v1" in text
    assert _extract_data_js(text)["project"]["name"] == "minimal-fixture"


def test_render_site_handles_empty_collections(tmp_path: Path) -> None:
    empty = {
        "schema": "codeviz/v1",
        "project": {"name": "empty", "root": ".", "generated_at": "2026-11-18T12:00:00+08:00"},
        "index": {"database": "", "files": 0, "nodes": 0, "edges": 0, "routes": 0},
        "groups": {},
        "modules": [],
        "moduleEdges": [],
        "files": [],
        "fileEdges": [],
        "symbols": [],
        "calls": [],
        "entries": [],
        "overlays": [],
    }
    out_dir = tmp_path / "empty"

    root = _find_site_root(render_site(empty, out_dir), out_dir)

    assert (root / "index.html").is_file()
    payload = _extract_data_js((root / "assets" / "data.js").read_text(encoding="utf-8"))
    assert payload["modules"] == []
    assert payload["calls"] == []


def test_render_single_file_handles_empty_collections(tmp_path: Path) -> None:
    empty = {
        "schema": "codeviz/v1",
        "project": {"name": "empty"},
        "index": {},
        "groups": {},
        "modules": [],
        "moduleEdges": [],
        "files": [],
        "fileEdges": [],
        "symbols": [],
        "calls": [],
        "entries": [],
        "overlays": [],
    }
    out_dir = tmp_path / "empty-single"

    html_path = _find_html(render_single_file(empty, out_dir), out_dir)

    assert "window.CODEVIZ_DATA" in html_path.read_text(encoding="utf-8")


def test_render_site_overwrites_existing_output(minimal_data: dict, tmp_path: Path) -> None:
    out_dir = tmp_path / "twice"

    first = _find_site_root(render_site(minimal_data, out_dir), out_dir)
    (first / "assets" / "data.js").write_text("stale", encoding="utf-8")
    second = _find_site_root(render_site(minimal_data, out_dir), out_dir)

    text = (second / "assets" / "data.js").read_text(encoding="utf-8")
    assert "window.CODEVIZ_DATA" in text


def test_render_site_refuses_foreign_assets(minimal_data: dict, tmp_path: Path) -> None:
    out_dir = tmp_path / "foreign"
    assets = out_dir / "assets"
    assets.mkdir(parents=True)
    marker = assets / "foo.txt"
    marker.write_text("user data", encoding="utf-8")

    with pytest.raises(ValueError, match="拒绝覆盖"):
        render_site(minimal_data, out_dir)

    assert marker.read_text(encoding="utf-8") == "user data"


def test_render_site_rebuilds_marked_output(minimal_data: dict, tmp_path: Path) -> None:
    out_dir = tmp_path / "rebuild"
    render_site(minimal_data, out_dir)
    assert (out_dir / ".codeviz-output").is_file()

    # A second build recognises its own marker and replaces the assets.
    root = _find_site_root(render_site(minimal_data, out_dir), out_dir)

    assert (root / "assets" / "data.js").is_file()
    assert (root / ".codeviz-output").is_file()


def test_render_site_allows_empty_assets_dir(minimal_data: dict, tmp_path: Path) -> None:
    out_dir = tmp_path / "empty-assets"
    (out_dir / "assets").mkdir(parents=True)

    root = _find_site_root(render_site(minimal_data, out_dir), out_dir)

    assert (root / "assets" / "data.js").is_file()


def test_render_site_rejects_project_root_output(minimal_data: dict, tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="项目根目录"):
        render_site(minimal_data, tmp_path, project_path=tmp_path)


def test_render_site_rejects_output_inside_web_dir(minimal_data: dict) -> None:
    target = web_dir() / "generated"
    assert not target.exists(), "测试不应在 web 目录中留下文件"

    with pytest.raises(ValueError, match="web 模板目录"):
        render_site(minimal_data, target)

    assert not target.exists()


def test_build_project_rejects_project_root_output(project: Path) -> None:
    with pytest.raises(ValueError, match="项目根目录"):
        build_project(project, out_dir=project, config_path=project / "codeviz.json")


def test_build_project_rejects_output_above_project_root(project: Path) -> None:
    with pytest.raises(ValueError, match="上级"):
        build_project(project, out_dir=project.parent, config_path=project / "codeviz.json")


def test_render_site_writes_data_json_by_default(minimal_data: dict, tmp_path: Path) -> None:
    out_dir = tmp_path / "with-json"

    root = _find_site_root(render_site(minimal_data, out_dir), out_dir)

    assert (root / "assets" / "data.js").is_file()
    assert (root / "assets" / "viz-data.json").is_file()
    payload = json.loads((root / "assets" / "viz-data.json").read_text(encoding="utf-8"))
    assert payload["schema"] == "codeviz/v1"


def test_render_site_can_skip_data_json(minimal_data: dict, tmp_path: Path) -> None:
    out_dir = tmp_path / "no-json"

    root = _find_site_root(
        render_site(minimal_data, out_dir, write_data_json=False),
        out_dir,
    )

    assert (root / "assets" / "data.js").is_file()
    assert not (root / "assets" / "viz-data.json").exists()


def test_build_single_html_is_repeatable(minimal_data: dict, tmp_path: Path) -> None:
    image = tmp_path / "arch.png"
    image.write_bytes(b"\x89PNG\r\n\x1a\nfake-image")
    data = dict(minimal_data)
    data["overlays"] = [{"id": "image", "type": "image", "image": "arch.png"}]
    before = json.loads(json.dumps(data))

    first = build_single_html(data, project_path=tmp_path)
    second = build_single_html(data, project_path=tmp_path)

    assert first == second
    assert data == before
    assert "data:image/png;base64," in first


def test_build_project_hide_root(project: Path, tmp_path: Path) -> None:
    out_dir = tmp_path / "hidden-root"

    build_project(
        project,
        out_dir=out_dir,
        config_path=project / "codeviz.json",
        hide_root=True,
    )

    payload = _extract_data_js((out_dir / "assets" / "data.js").read_text(encoding="utf-8"))
    assert payload["project"]["root"] == ""


def test_build_project_hide_root_from_config(project: Path, tmp_path: Path) -> None:
    config = json.loads((project / "codeviz.json").read_text(encoding="utf-8"))
    config.setdefault("project", {})["hide_root"] = True
    config_path = tmp_path / "hide-root.json"
    config_path.write_text(json.dumps(config, ensure_ascii=False), encoding="utf-8")
    out_dir = tmp_path / "config-hidden-root"

    build_project(project, out_dir=out_dir, config_path=config_path)

    payload = _extract_data_js((out_dir / "assets" / "data.js").read_text(encoding="utf-8"))
    assert payload["project"]["root"] == ""
