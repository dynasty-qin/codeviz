"""Generic ``codeviz/v1`` adapter.

Accepts either a plain ``.json`` payload or a generated ``data.js`` file
(``window.CODEVIZ_DATA = {...};``) so the output of a previous build can be
re-rendered, validated or inspected without a CodeGraph index.
"""

from __future__ import annotations

import json
from pathlib import Path

from .. import model


class GenericDataError(ValueError):
    """Raised when the input file cannot be interpreted as codeviz data."""


def load_data(path: str | Path) -> dict:
    """Load a ``codeviz/v1`` payload from JSON or a ``data.js`` file."""

    source = Path(path).expanduser()
    if not source.is_file():
        raise FileNotFoundError(f"找不到数据文件: {source}")

    try:
        text = source.read_text(encoding="utf-8")
    except OSError as exc:
        raise GenericDataError(f"无法读取 {source}: {exc}") from exc

    suffix = source.suffix.lower()
    if suffix in (".js", ".mjs"):
        try:
            data = model.load_js_data(text)
        except ValueError as exc:
            raise GenericDataError(f"{source}: {exc}") from exc
    else:
        try:
            data = json.loads(text, parse_constant=_reject_constant)
        except json.JSONDecodeError as exc:
            raise GenericDataError(f"{source} 不是合法 JSON: {exc}") from exc
        except ValueError as exc:
            raise GenericDataError(f"{source} 含非法常量: {exc}") from exc

    if not isinstance(data, dict):
        raise GenericDataError(f"{source} 顶层必须是 JSON 对象")
    if data.get("schema") != model.SCHEMA:
        raise GenericDataError(
            f"{source} 的 schema 是 {data.get('schema')!r}，期望 {model.SCHEMA!r}"
        )
    return model.ensure_data(data)


def _reject_constant(value: str):
    raise ValueError(f"{value} 不是合法的 JSON 值")
