"""Data-contract helpers for the ``codeviz/v1`` payload.

This module is intentionally dependency-free (standard library only).  It owns
the small amount of shared plumbing every other module needs:

* the schema version and the list of top-level fields,
* tolerant normalisation of partially filled payloads (``ensure_data``),
* JSON serialisation that never emits ``NaN`` / ``Infinity``,
* reading ``window.CODEVIZ_DATA = {...};`` files produced by ``render``,
* the structural validation used by ``codeviz validate``.
"""

from __future__ import annotations

import json
import math
import sys
from typing import Any

SCHEMA = "codeviz/v1"

#: Top-level fields mandated by CONTRACT.md section 2.
REQUIRED_FIELDS = (
    "schema",
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
)

#: Fields that must be JSON arrays.
ARRAY_FIELDS = (
    "modules",
    "moduleEdges",
    "files",
    "fileEdges",
    "symbols",
    "calls",
    "entries",
    "overlays",
)


def warn(message: str) -> None:
    """Print a warning on stderr without disturbing machine-readable stdout."""

    print(f"codeviz 警告: {message}", file=sys.stderr)


def empty_data(name: str = "codeviz", root: str = "") -> dict:
    """Return a structurally complete, empty payload."""

    return {
        "schema": SCHEMA,
        "project": {"name": name, "root": root},
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


def ensure_data(data: Any) -> dict:
    """Return ``data`` with every contract field present and correctly typed.

    Missing values receive empty defaults, non-list values for array fields are
    replaced with ``[]`` and non-dict items are dropped.  The input object is
    not mutated.
    """

    if not isinstance(data, dict):
        return empty_data()

    out: dict = dict(data)
    if not isinstance(out.get("schema"), str) or not out.get("schema"):
        out["schema"] = SCHEMA

    project = out.get("project")
    if not isinstance(project, dict):
        project = {}
    project = dict(project)
    if not isinstance(project.get("name"), str) or not project.get("name"):
        project["name"] = "codeviz"
    out["project"] = project

    for key in ("index", "groups"):
        value = out.get(key)
        out[key] = dict(value) if isinstance(value, dict) else {}

    for key in ARRAY_FIELDS:
        value = out.get(key)
        if not isinstance(value, (list, tuple)):
            out[key] = []
        else:
            out[key] = [item for item in value if isinstance(item, dict)]

    # ``kinds`` on moduleEdges is documented as an object; keep it tolerant.
    for edge in out["moduleEdges"]:
        if not isinstance(edge.get("kinds"), dict):
            edge["kinds"] = {}
        if not _is_number(edge.get("weight")):
            edge["weight"] = 0

    for edge in out["fileEdges"]:
        if not _is_number(edge.get("weight")):
            edge["weight"] = 0

    return out


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def sanitize(value: Any) -> Any:
    """Recursively replace non-finite floats and non-JSON values."""

    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {str(k): sanitize(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [sanitize(item) for item in value]
    if value is None or isinstance(value, (str, int, bool)):
        return value
    return str(value)


def dumps_json(obj: Any, *, indent: int | None = None) -> str:
    """Serialise ``obj`` as UTF-8 JSON without ``NaN`` / ``Infinity``."""

    kwargs = {
        "ensure_ascii": False,
        "allow_nan": False,
    }
    if indent is None:
        kwargs["separators"] = (",", ":")
    else:
        kwargs["indent"] = indent
    return json.dumps(sanitize(obj), **kwargs)


def data_js(data: dict) -> str:
    """Render the payload as the ``assets/data.js`` file content."""

    return "window.CODEVIZ_DATA = " + dumps_json(data) + ";\n"


def load_js_data(text: str) -> dict:
    """Extract ``window.CODEVIZ_DATA = {...};`` from a JS payload."""

    marker = "CODEVIZ_DATA"
    position = text.find(marker)
    if position < 0:
        raise ValueError("不是 codeviz 数据文件：未找到 CODEVIZ_DATA")
    brace = text.find("{", position)
    if brace < 0:
        raise ValueError("不是 codeviz 数据文件：未找到 JSON 对象")
    try:
        data, _end = json.JSONDecoder().raw_decode(text[brace:])
    except json.JSONDecodeError as exc:
        raise ValueError(f"CODEVIZ_DATA 解析失败: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError("CODEVIZ_DATA 不是 JSON 对象")
    return data


def validate_data(data: Any) -> list[str]:
    """Validate a ``codeviz/v1`` payload and return a list of problems."""

    errors: list[str] = []
    if not isinstance(data, dict):
        return ["顶层必须是 JSON 对象"]

    if data.get("schema") != SCHEMA:
        errors.append(f"schema 必须为 {SCHEMA!r}，实际为 {data.get('schema')!r}")

    project = data.get("project")
    if not isinstance(project, dict):
        errors.append("project 必须是对象")
    elif not isinstance(project.get("name"), str) or not project.get("name").strip():
        errors.append("project.name 必须是非空字符串")

    for key in ("index", "groups"):
        if key not in data:
            errors.append(f"缺少顶层字段 {key}")
        elif not isinstance(data[key], dict):
            errors.append(f"{key} 必须是对象")

    for key in ARRAY_FIELDS:
        if key not in data:
            errors.append(f"缺少顶层字段 {key}")
        elif not isinstance(data[key], list):
            errors.append(f"{key} 必须是数组")

    errors.extend(_validate_items(data))
    errors.extend(_find_non_finite(data))

    if len(errors) > 50:
        errors = errors[:50] + [f"……其余 {len(errors) - 50} 项问题已省略"]
    return errors


def _validate_items(data: dict) -> list[str]:
    errors: list[str] = []

    for index, module in enumerate(_list(data.get("modules"))):
        where = f"modules[{index}]"
        if not isinstance(module.get("id"), str) or not module["id"]:
            errors.append(f"{where}.id 必须是非空字符串")
        if "files" in module and not isinstance(module["files"], list):
            errors.append(f"{where}.files 必须是数组")

    for index, edge in enumerate(_list(data.get("moduleEdges"))):
        where = f"moduleEdges[{index}]"
        if not isinstance(edge.get("source"), str):
            errors.append(f"{where}.source 必须是字符串")
        if not isinstance(edge.get("target"), str):
            errors.append(f"{where}.target 必须是字符串")
        if not _is_number(edge.get("weight")):
            errors.append(f"{where}.weight 必须是数字")
        if "kinds" in edge and not isinstance(edge["kinds"], dict):
            errors.append(f"{where}.kinds 必须是对象")

    for index, file_item in enumerate(_list(data.get("files"))):
        where = f"files[{index}]"
        if not isinstance(file_item.get("path"), str) or not file_item["path"]:
            errors.append(f"{where}.path 必须是非空字符串")

    for index, edge in enumerate(_list(data.get("fileEdges"))):
        where = f"fileEdges[{index}]"
        if not isinstance(edge.get("source"), str):
            errors.append(f"{where}.source 必须是字符串")
        if not isinstance(edge.get("target"), str):
            errors.append(f"{where}.target 必须是字符串")
        if not _is_number(edge.get("weight")):
            errors.append(f"{where}.weight 必须是数字")

    for index, symbol in enumerate(_list(data.get("symbols"))):
        where = f"symbols[{index}]"
        if not isinstance(symbol.get("id"), str) or not symbol["id"]:
            errors.append(f"{where}.id 必须是非空字符串")
        if not isinstance(symbol.get("name"), str):
            errors.append(f"{where}.name 必须是字符串")
        if not isinstance(symbol.get("file"), str):
            errors.append(f"{where}.file 必须是字符串")
        line = symbol.get("line")
        if not isinstance(line, int) or isinstance(line, bool) or line < 1:
            errors.append(f"{where}.line 必须是正整数")

    for index, call in enumerate(_list(data.get("calls"))):
        where = f"calls[{index}]"
        if not isinstance(call.get("source"), str):
            errors.append(f"{where}.source 必须是字符串")
        if not isinstance(call.get("target"), str):
            errors.append(f"{where}.target 必须是字符串")

    for index, entry in enumerate(_list(data.get("entries"))):
        where = f"entries[{index}]"
        if not isinstance(entry.get("label"), str) or not entry["label"]:
            errors.append(f"{where}.label 必须是非空字符串")
        if not isinstance(entry.get("id"), str) or not entry["id"]:
            errors.append(f"{where}.id 必须是非空字符串")

    for index, overlay in enumerate(_list(data.get("overlays"))):
        where = f"overlays[{index}]"
        if not isinstance(overlay.get("id"), str) or not overlay["id"]:
            errors.append(f"{where}.id 必须是非空字符串")
        if overlay.get("type") not in ("layers", "image"):
            errors.append(f"{where}.type 必须是 layers 或 image")
        if overlay.get("type") == "layers":
            if not isinstance(overlay.get("layers"), list):
                errors.append(f"{where}.layers 必须是数组")
            else:
                for layer_index, layer in enumerate(overlay["layers"]):
                    if not isinstance(layer, dict):
                        errors.append(f"{where}.layers[{layer_index}] 必须是对象")
                        continue
                    if not isinstance(layer.get("items", []), list):
                        errors.append(f"{where}.layers[{layer_index}].items 必须是数组")
        if overlay.get("type") == "image":
            if not isinstance(overlay.get("image"), str) or not overlay["image"]:
                errors.append(f"{where}.image 必须是字符串")
    return errors


def _list(value: Any) -> list[dict]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _find_non_finite(value: Any, path: str = "$") -> list[str]:
    if isinstance(value, float):
        return [] if math.isfinite(value) else [f"{path} 含 NaN/Infinity"]
    if isinstance(value, dict):
        errors: list[str] = []
        for key, item in value.items():
            errors.extend(_find_non_finite(item, f"{path}.{key}"))
        return errors
    if isinstance(value, list):
        errors = []
        for index, item in enumerate(value):
            errors.extend(_find_non_finite(item, f"{path}[{index}]"))
        return errors
    return []
