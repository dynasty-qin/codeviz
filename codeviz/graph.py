"""Module / file graph aggregation.

The adapters collect raw CodeGraph edges (``calls`` / ``imports`` /
``instantiates`` / ``references`` / ``extends``).  This module turns them into
the contract's aggregated ``moduleEdges`` and ``fileEdges``: internal edges are
dropped and parallel edges are collapsed into ``weight`` + per-kind counters.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Iterable, Mapping

EDGE_KINDS = ("calls", "imports", "instantiates", "references", "extends")


def aggregate(
    files: list[dict],
    symbols: list[dict],
    edges: Iterable[dict],
    *,
    node_files: Mapping[str, str] | None = None,
) -> tuple[list[dict], list[dict]]:
    """Aggregate cross-module / cross-file edges.

    ``files`` supplies ``path -> module``; ``symbols`` supplies symbol-id ->
    file; ``node_files`` (optional) maps any other node id (routes, imports,
    classes, ...) to its file so those edges are not lost.
    """

    file_module: dict[str, str] = {}
    for item in files:
        path = _posix(item.get("path"))
        module = item.get("module")
        if path and isinstance(module, str) and module:
            file_module[path] = module

    node_file: dict[str, str] = {}
    if node_files:
        for node_id, path in node_files.items():
            normalized = _posix(path)
            if node_id and normalized:
                node_file[node_id] = normalized
    for symbol in symbols:
        node_id = symbol.get("id")
        path = _posix(symbol.get("file"))
        if isinstance(node_id, str) and path:
            node_file[node_id] = path

    module_edges: dict[tuple[str, str], dict] = {}
    file_edges: dict[tuple[str, str], dict] = {}

    for edge in edges:
        if not isinstance(edge, dict):
            continue
        kind = str(edge.get("kind") or "").lower()
        if kind not in EDGE_KINDS:
            continue
        source_id = edge.get("source")
        target_id = edge.get("target")
        if not isinstance(source_id, str) or not isinstance(target_id, str):
            continue

        source_file = node_file.get(source_id)
        target_file = node_file.get(target_id)
        if not source_file or not target_file or source_file == target_file:
            continue

        file_key = (source_file, target_file)
        bucket = file_edges.setdefault(file_key, {"weight": 0, "kinds": {}})
        bucket["weight"] += 1
        bucket["kinds"][kind] = bucket["kinds"].get(kind, 0) + 1

        source_module = file_module.get(source_file) or _fallback_module(source_file)
        target_module = file_module.get(target_file) or _fallback_module(target_file)
        if not source_module or not target_module or source_module == target_module:
            continue

        module_key = (source_module, target_module)
        bucket = module_edges.setdefault(module_key, {"weight": 0, "kinds": {}})
        bucket["weight"] += 1
        bucket["kinds"][kind] = bucket["kinds"].get(kind, 0) + 1

    module_list = _sorted_edges(module_edges, "source", "target")
    file_list = _sorted_edges(file_edges, "source", "target")
    return module_list, file_list


def collect_calls(symbols: Iterable[dict], edges: Iterable[dict]) -> list[dict]:
    """Return de-duplicated symbol-to-symbol ``calls`` edges.

    The contract only requires ``source`` / ``target``; ``line`` is added as a
    convenience for the source panel and is safe to ignore.
    """

    symbol_ids = {symbol.get("id") for symbol in symbols if symbol.get("id")}
    calls: dict[tuple[str, str], dict] = {}
    for edge in edges:
        if not isinstance(edge, dict) or str(edge.get("kind") or "").lower() != "calls":
            continue
        source = edge.get("source")
        target = edge.get("target")
        if source not in symbol_ids or target not in symbol_ids:
            continue
        key = (source, target)
        if key in calls:
            continue
        item = {"source": source, "target": target}
        line = edge.get("line")
        if isinstance(line, int) and not isinstance(line, bool):
            item["line"] = line
        calls[key] = item
    return list(calls.values())


def _sorted_edges(buckets: dict[tuple[str, str], dict], source_key: str, target_key: str) -> list[dict]:
    items = []
    for (source, target), bucket in buckets.items():
        items.append(
            {
                source_key: source,
                target_key: target,
                "weight": bucket["weight"],
                "kinds": dict(sorted(bucket["kinds"].items(), key=lambda item: (-item[1], item[0]))),
            }
        )
    items.sort(key=lambda item: (-int(item.get("weight") or 0), item[source_key], item[target_key]))
    return items


def _posix(value) -> str:
    if not isinstance(value, str):
        return ""
    text = value.replace("\\", "/").strip()
    while text.startswith("./"):
        text = text[2:]
    return text


def _fallback_module(path: str) -> str:
    """Module id used for files that are absent from the ``files`` table."""

    directory = path.rsplit("/", 1)[0] if "/" in path else ""
    return directory or "root"
