"""CLI 端到端（CONTRACT 第 1 / 6 节）。

用生成的最小 `.codegraph/codegraph.db` 跑 `codeviz build`，不依赖真实 TeamSync 索引。
"""

from __future__ import annotations

import json
from pathlib import Path

from codeviz.cli import main


def _run_cli(argv: list[str]) -> int:
    """main() 以 SystemExit 结束，这里统一收敛成退出码。"""
    try:
        result = main(argv)
    except SystemExit as exc:  # noqa: PERF203 - CLI 正常路径
        code = exc.code
        if code is None:
            return 0
        return code if isinstance(code, int) else 1
    return int(result or 0)


def test_cli_build_demo_site(project: Path, tmp_path: Path) -> None:
    out_dir = tmp_path / "out"

    code = _run_cli(
        [
            "build",
            str(project),
            "--out",
            str(out_dir),
            "--config",
            str(project / "codeviz.json"),
        ]
    )

    assert code == 0
    assert (out_dir / "index.html").is_file()
    data_js = out_dir / "assets" / "data.js"
    assert data_js.is_file()
    assert "window.CODEVIZ_DATA" in data_js.read_text(encoding="utf-8")


def test_cli_build_demo_single_file(project: Path, tmp_path: Path) -> None:
    out_dir = tmp_path / "single"

    code = _run_cli(
        [
            "build",
            str(project),
            "--out",
            str(out_dir),
            "--config",
            str(project / "codeviz.json"),
            "--format",
            "single-file",
        ]
    )

    assert code == 0
    html_files = sorted(out_dir.rglob("*.html"))
    assert html_files, "single-file 模式应生成 html"
    text = html_files[0].read_text(encoding="utf-8")
    assert "window.CODEVIZ_DATA" in text
    assert "<style" in text


def test_cli_default_out_dir_is_codeviz(project: Path) -> None:
    code = _run_cli(["build", str(project), "--config", str(project / "codeviz.json")])

    assert code == 0
    assert (project / ".codeviz" / "index.html").is_file()


def test_cli_build_from_json_data(minimal_data_path: Path, tmp_path: Path) -> None:
    out_dir = tmp_path / "from-json"

    code = _run_cli(["build", str(minimal_data_path), "--out", str(out_dir)])

    assert code == 0
    assert (out_dir / "index.html").is_file()
    assert (out_dir / "assets" / "data.js").is_file()


def test_cli_validate_minimal_data(minimal_data_path: Path) -> None:
    assert _run_cli(["validate", str(minimal_data_path)]) == 0


def test_cli_validate_rejects_invalid_data(tmp_path: Path) -> None:
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps({"schema": "codeviz/v0"}), encoding="utf-8")

    assert _run_cli(["validate", str(bad)]) != 0
