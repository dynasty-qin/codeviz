"""Python AST 指标（CONTRACT 第 2 节符号字段 + 第 4 节 metrics）。"""

from __future__ import annotations

from pathlib import Path

import pytest

from codeviz.metrics.python_ast import scan_file, scan_symbol

SAMPLE = '''\
"""metrics sample."""


def flat(value):
    return value


def cond(value):
    if value:
        return 1
    return 0


def loop(items):
    total = 0
    for item in items:
        total += item
    return total


def guard(value):
    try:
        return 10 // value
    except ZeroDivisionError:
        return 0
    except TypeError:
        return -1
'''


def _write(tmp_path: Path, name: str, text: str) -> Path:
    path = tmp_path / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def _metrics_for(result: dict, name: str) -> dict:
    """scan_file 以行号为 key（实现细节），这里按函数名查找。"""
    if name in result:
        return result[name]
    for key, value in result.items():
        if isinstance(value, dict) and value.get("name") == name:
            return value
        tail = str(key).replace("::", ".").split(".")[-1]
        if tail == name or str(key).endswith(name):
            return value
    raise AssertionError(f"scan_file 结果中没有 {name!r}，实际 keys={list(result)}")


@pytest.fixture
def sample_file(tmp_path: Path) -> Path:
    return _write(tmp_path, "pkg/sample.py", SAMPLE)


def test_scan_file_returns_all_functions(sample_file: Path) -> None:
    result = scan_file(sample_file)

    assert isinstance(result, dict)
    assert result, "scan_file 不应返回空字典"
    for name in ("flat", "cond", "loop", "guard"):
        _metrics_for(result, name)


def test_scan_file_lines(sample_file: Path) -> None:
    result = scan_file(sample_file)

    assert _metrics_for(result, "flat")["lines"] == 2  # def flat .. return value
    assert _metrics_for(result, "cond")["lines"] == 4  # 8..11
    assert _metrics_for(result, "loop")["lines"] == 5  # 14..18
    assert _metrics_for(result, "guard")["lines"] == 7  # 21..27


def test_scan_file_branches_and_excepts(sample_file: Path) -> None:
    result = scan_file(sample_file)

    assert _metrics_for(result, "flat")["branches"] == 0
    assert _metrics_for(result, "flat")["excepts"] == 0
    assert _metrics_for(result, "cond")["branches"] == 1
    assert _metrics_for(result, "loop")["branches"] == 1
    guard = _metrics_for(result, "guard")
    assert guard["excepts"] == 2
    assert guard["branches"] >= 1, "try/except 至少算一个分支"


def test_scan_file_source_snippet(sample_file: Path) -> None:
    result = scan_file(sample_file)

    guard = _metrics_for(result, "guard")
    assert "def guard" in guard["source"]
    assert "ZeroDivisionError" in guard["source"]
    assert "return -1" in guard["source"]


def _long_source(total_lines: int = 100) -> str:
    body = ["def long_one(value):", "    total = value"]
    while len(body) < total_lines - 1:
        body.append("    total += 1")
    body.append("    return total")
    return "\n".join(body) + "\n"


def test_scan_file_truncates_source(tmp_path: Path) -> None:
    path = _write(tmp_path, "pkg/long.py", _long_source(100))

    default = _metrics_for(scan_file(path), "long_one")
    assert "def long_one" in default["source"]
    assert len(default["source"].splitlines()) <= 61, "默认截断 60 行（允许一行省略标记）"
    assert len(default["source"]) <= 4100, "默认截断 4000 字符（允许少量省略标记）"
    assert "return total" not in default["source"], "超长函数不应完整返回"

    short = _metrics_for(scan_file(path, source_lines=5), "long_one")
    assert len(short["source"].splitlines()) <= 6, "source_lines=5 时应截断到 5 行左右"
    assert "def long_one" in short["source"]


def test_scan_symbol_attaches_metrics(sample_file: Path) -> None:
    symbol = {
        "id": "function:test",
        "name": "cond",
        "file": "pkg/sample.py",
        "line": 8,
        "end": 11,
        "kind": "function",
    }

    scan_symbol(sample_file.parent.parent, symbol)

    assert symbol["lines"] == 4
    assert symbol["branches"] == 1
    assert symbol["excepts"] == 0
    assert "def cond" in symbol["source"]


def test_scan_symbol_respects_source_lines(sample_file: Path, tmp_path: Path) -> None:
    long_path = _write(tmp_path, "pkg/long2.py", _long_source(80))
    symbol = {
        "id": "function:long",
        "name": "long_one",
        "file": "pkg/long2.py",
        "line": 1,
        "end": 80,
        "kind": "function",
    }

    scan_symbol(tmp_path, symbol, source_lines=10)

    assert len(symbol["source"].splitlines()) <= 11
    assert symbol["lines"] == 80
