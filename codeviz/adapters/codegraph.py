"""CodeGraph SQLite adapter: ``.codegraph/codegraph.db`` -> ``codeviz/v1``.

The database is opened read-only.  Only the ``files``, ``nodes`` and ``edges``
tables are needed; every other table is ignored so this keeps working when the
CodeGraph schema grows.

Symbols are limited to ``function`` / ``method`` nodes and keep the CodeGraph
node id verbatim, which is what makes the ``calls`` edges line up.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

from .. import graph, overlays
from ..config import match_module
from ..metrics import python_ast
from ..model import SCHEMA, warn

TZ = timezone(timedelta(hours=8))
SYMBOL_KINDS = ("function", "method")
ENTRY_EDGE_KINDS = ("references", "calls")


class AdapterError(RuntimeError):
    """Raised when the database exists but is not a usable CodeGraph index."""


def build_data(project_path: str | Path, config: dict) -> dict:
    """Build a ``codeviz/v1`` payload from a CodeGraph index."""

    root = Path(project_path).expanduser().resolve()
    database = _database_path(root, config)
    if not database.is_file():
        raise FileNotFoundError(
            f"找不到 CodeGraph 索引: {database}\n"
            "请先在该项目运行 `codegraph init` / `codegraph sync`，"
            "或在 codeviz.json 的 index.database 指定数据库路径。"
        )

    connection = _open_readonly(database)
    try:
        tables = _table_names(connection)
        for required in ("files", "nodes", "edges"):
            if required not in tables:
                raise AdapterError(f"{database} 不是 CodeGraph 索引：缺少 {required} 表")
        # One read transaction gives a consistent snapshot even while the
        # CodeGraph watcher is writing (WAL mode).
        connection.execute("BEGIN")
        try:
            total_files = _count(connection, "files")
            total_nodes = _count(connection, "nodes")
            total_edges = _count(connection, "edges")
            file_rows = connection.execute("SELECT * FROM files").fetchall()
            node_rows = connection.execute("SELECT * FROM nodes").fetchall()
            edge_rows = connection.execute("SELECT * FROM edges").fetchall()
        finally:
            connection.rollback()
    finally:
        connection.close()

    metrics_config = config.get("metrics") or {}
    metric_options = {
        "source_lines": _int(metrics_config.get("source_lines"), 60),
        "source_chars": _int(metrics_config.get("source_chars"), 4000),
        "include_source": bool(metrics_config.get("include_source", True)),
    }

    exclude = [str(item) for item in (config.get("exclude") or []) if isinstance(item, str)]
    file_meta: dict[str, dict] = {}
    for row in file_rows:
        path = _posix(_row(row, "path"))
        if not path or _excluded(path, exclude):
            continue
        file_meta[path] = {
            "path": path,
            "language": _str(_row(row, "language")) or "unknown",
            "size": _int(_row(row, "size"), 0),
            "generated": bool(_int(_row(row, "generated"), 0)),
        }

    # Node -> file mapping is needed for route/import/class edges.
    node_files: dict[str, str] = {}
    nodes_by_id: dict[str, sqlite3.Row] = {}
    for row in node_rows:
        node_id = _str(_row(row, "id"))
        path = _posix(_row(row, "file_path"))
        if not node_id:
            continue
        if path and path in file_meta:
            node_files[node_id] = path
            nodes_by_id[node_id] = row

    # File line counts + Python AST metrics (one read per file).
    scans: dict[str, dict[str, dict]] = {}
    line_counts: dict[str, int] = {}
    file_end_lines: dict[str, int] = {}
    for row in node_rows:
        if _str(_row(row, "kind")) != "file":
            continue
        path = _posix(_row(row, "file_path"))
        if path:
            file_end_lines[path] = _int(_row(row, "end_line"), 0)

    for path, meta in file_meta.items():
        lines = None
        try:
            lines = python_ast.read_source(root / path)
        except OSError:
            lines = None
        if lines is None:
            line_counts[path] = file_end_lines.get(path, 0)
            continue
        line_counts[path] = len(lines)
        if meta["language"] == "python":
            scans[path] = python_ast.scan_lines(lines, **metric_options)

    # Module assignment per file (glob rules are order-sensitive).
    file_modules: dict[str, dict] = {
        path: match_module(path, config) for path in file_meta
    }

    symbols: list[dict] = []
    file_stats: dict[str, dict] = {
        path: {"symbols": 0, "branches": 0, "excepts": 0}
        for path in file_meta
    }

    for row in node_rows:
        kind = _str(_row(row, "kind"))
        if kind not in SYMBOL_KINDS:
            continue
        path = _posix(_row(row, "file_path"))
        if path not in file_meta:
            continue
        node_id = _str(_row(row, "id"))
        if not node_id:
            continue

        name = _str(_row(row, "name")) or node_id
        qualified = _str(_row(row, "qualified_name")) or name
        start = max(1, _int(_row(row, "start_line"), 1))
        end = max(start, _int(_row(row, "end_line"), start))
        module = file_modules[path]

        symbol: dict = {
            "id": node_id,
            "name": name,
            "qualified": qualified,
            "file": path,
            "line": start,
            "end": end,
            "kind": kind,
            "module": module["id"],
            "group": module["group"],
            "signature": _one_line(_str(_row(row, "signature"))),
            "doc": _str(_row(row, "docstring")) or "",
            "lines": end - start + 1,
            "branches": 0,
            "excepts": 0,
        }

        scan = scans.get(path)
        hit = None
        if scan:
            hit = python_ast.lookup(
                scan,
                {"line": start, "name": name, "qualified": qualified},
            )
        if hit is not None:
            symbol["branches"] = _int(hit.get("branches"), 0)
            symbol["excepts"] = _int(hit.get("excepts"), 0)
            if hit.get("doc"):
                symbol["doc"] = hit["doc"]
            if hit.get("signature") and not symbol["signature"]:
                symbol["signature"] = hit["signature"]
            if metric_options["include_source"] and hit.get("source"):
                symbol["source"] = hit["source"]
            if not symbol["lines"] and hit.get("lines"):
                symbol["lines"] = _int(hit.get("lines"), 1)

        if not symbol["signature"]:
            symbol.pop("signature")
        if not symbol["doc"]:
            symbol.pop("doc")
        if _int(_row(row, "is_async"), 0):
            symbol["async"] = True

        stats = file_stats[path]
        stats["symbols"] += 1
        stats["branches"] += symbol["branches"]
        stats["excepts"] += symbol["excepts"]
        symbols.append(symbol)

    files = []
    for path in sorted(file_meta):
        meta = file_meta[path]
        module = file_modules[path]
        stats = file_stats[path]
        files.append(
            {
                "path": path,
                "module": module["id"],
                "group": module["group"],
                "lines": line_counts.get(path, 0),
                "symbols": stats["symbols"],
                "branches": stats["branches"],
                "excepts": stats["excepts"],
                "functions": stats["symbols"],
                "language": meta["language"],
                "size": meta["size"],
            }
        )

    modules = _build_modules(files, symbols, file_modules)

    groups = dict(config.get("groups") or {})
    for module in modules:
        group = module["group"]
        if group and group not in groups:
            groups[group] = {"label": group}

    edges = [{key: _row(row, key) for key in ("source", "target", "kind", "line")} for row in edge_rows]
    calls = graph.collect_calls(symbols, edges)
    module_edges, file_edges = graph.aggregate(files, symbols, edges, node_files=node_files)
    entries = _build_entries(node_rows, edge_rows, nodes_by_id, symbols)

    included_edges = sum(
        1
        for edge in edges
        if isinstance(edge.get("source"), str)
        and edge["source"] in node_files
        and isinstance(edge.get("target"), str)
        and edge["target"] in node_files
    )
    included_routes = sum(
        1
        for row in node_rows
        if _str(_row(row, "kind")) == "route" and _str(_row(row, "id")) in node_files
    )

    database_label = _relative_to(root, database)
    data = {
        "schema": SCHEMA,
        "project": {
            "name": config.get("project", {}).get("name") or root.name or "codeviz",
            "root": root.as_posix(),
            "generated_at": datetime.now(TZ).isoformat(timespec="seconds"),
        },
        "index": {
            "database": database_label,
            "files": len(file_meta),
            "nodes": len(node_files),
            "edges": included_edges,
            "routes": included_routes,
            "databaseFiles": total_files,
            "databaseNodes": total_nodes,
            "databaseEdges": total_edges,
        },
        "groups": groups,
        "modules": modules,
        "moduleEdges": module_edges,
        "files": files,
        "fileEdges": file_edges,
        "symbols": symbols,
        "calls": calls,
        "entries": entries,
        "overlays": overlays.load_overlays(config),
    }

    description = config.get("project", {}).get("description")
    if isinstance(description, str) and description.strip():
        data["project"]["description"] = description.strip()
    return data


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _database_path(root: Path, config: dict) -> Path:
    raw = (config.get("index") or {}).get("database") or ".codegraph/codegraph.db"
    candidate = Path(str(raw)).expanduser()
    if candidate.is_absolute():
        return candidate
    return root / candidate


def _open_readonly(database: Path) -> sqlite3.Connection:
    try:
        connection = sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True)
    except sqlite3.Error as exc:
        raise AdapterError(f"无法打开 CodeGraph 索引 {database}: {exc}") from exc
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA query_only = ON")
    except sqlite3.Error:
        pass
    return connection


def _table_names(connection: sqlite3.Connection) -> set[str]:
    try:
        rows = connection.execute(
            "SELECT name FROM sqlite_master WHERE type IN ('table', 'view')"
        ).fetchall()
    except sqlite3.Error as exc:
        raise AdapterError(f"读取数据库结构失败: {exc}") from exc
    return {str(row[0]) for row in rows}


def _count(connection: sqlite3.Connection, table: str) -> int:
    try:
        return int(connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
    except sqlite3.Error:
        return 0


def _build_modules(files: Iterable[dict], symbols: Iterable[dict], file_modules: dict[str, dict]) -> list[dict]:
    modules: dict[str, dict] = {}
    order: dict[str, int] = {}
    for file in files:
        module_id = file["module"]
        info = file_modules[file["path"]]
        entry = modules.get(module_id)
        if entry is None:
            entry = {
                "id": module_id,
                "label": info.get("label") or module_id,
                "group": info.get("group") or file.get("group") or "other",
                "fileCount": 0,
                "symbols": 0,
                "files": [],
            }
            desc = info.get("desc")
            if isinstance(desc, str) and desc:
                entry["desc"] = desc
            modules[module_id] = entry
            order[module_id] = _int(info.get("index"), 10**6)
        entry["fileCount"] += 1
        entry["files"].append(file["path"])
        order[module_id] = min(order[module_id], _int(info.get("index"), 10**6))

    for symbol in symbols:
        entry = modules.get(symbol["module"])
        if entry is not None:
            entry["symbols"] += 1

    for entry in modules.values():
        entry["files"].sort()

    return sorted(modules.values(), key=lambda item: (order.get(item["id"], 10**6), item["id"]))


def _build_entries(
    node_rows: list[sqlite3.Row],
    edge_rows: list[sqlite3.Row],
    nodes_by_id: dict[str, sqlite3.Row],
    symbols: list[dict],
) -> list[dict]:
    routes: dict[str, sqlite3.Row] = {}
    for row in node_rows:
        if _str(_row(row, "kind")) != "route":
            continue
        route_id = _str(_row(row, "id"))
        if route_id:
            routes[route_id] = row
    if not routes:
        return []

    targets: dict[str, list[str]] = {}
    for row in edge_rows:
        source = _str(_row(row, "source"))
        if source not in routes:
            continue
        if _str(_row(row, "kind")).lower() not in ENTRY_EDGE_KINDS:
            continue
        target = _str(_row(row, "target"))
        if not target:
            continue
        bucket = targets.setdefault(source, [])
        if target not in bucket:
            bucket.append(target)

    symbol_by_file: dict[str, list[dict]] = {}
    for symbol in symbols:
        symbol_by_file.setdefault(symbol["file"], []).append(symbol)
    for items in symbol_by_file.values():
        items.sort(key=lambda item: (item.get("line") or 0, item.get("name") or ""))

    entries: list[dict] = []
    missing = 0
    for route_id, route in routes.items():
        label = _str(_row(route, "name")) or _str(_row(route, "qualified_name")) or route_id
        route_file = _posix(_row(route, "file_path"))
        route_line = _int(_row(route, "start_line"), 0)
        candidates = [
            (target, nodes_by_id.get(target)) for target in targets.get(route_id, [])
        ]
        chosen = _pick_target(candidates)

        entry: dict = {"label": label, "id": chosen[0]} if chosen else {}
        if chosen is None:
            fallback = _fallback_target(symbol_by_file.get(route_file, []), route_line)
            if fallback is not None:
                chosen = (fallback["id"], None)
                entry = {"label": label, "id": fallback["id"]}
                entry["file"] = fallback["file"]
                entry["line"] = fallback["line"]
                entry["module"] = fallback["module"]
                entry["group"] = fallback["group"]
                entry["targetKind"] = fallback["kind"]
        if chosen is None:
            missing += 1
            continue

        target_row = chosen[1]
        if target_row is not None:
            entry.setdefault("file", _posix(_row(target_row, "file_path")))
            entry.setdefault("line", _int(_row(target_row, "start_line"), 0))
            entry["targetKind"] = _str(_row(target_row, "kind")) or "unknown"
        entry["route"] = route_id
        if route_file:
            entry["routeFile"] = route_file
            entry["routeLine"] = route_line
        entries.append(entry)

    if missing:
        warn(f"{missing} 个 route 节点没有可解析的处理函数，已从 entries 跳过")
    entries.sort(key=lambda item: (item.get("routeFile") or "", item.get("routeLine") or 0, item["label"]))
    return entries


def _pick_target(candidates: list[tuple[str, sqlite3.Row | None]]) -> tuple[str, sqlite3.Row | None] | None:
    if not candidates:
        return None
    priority = {"function": 0, "method": 1, "component": 2, "class": 3}
    ordered = sorted(
        candidates,
        key=lambda item: (
            priority.get(_str(_row(item[1], "kind")) if item[1] is not None else "", 9),
            _posix(_row(item[1], "file_path")) if item[1] is not None else item[0],
            _int(_row(item[1], "start_line"), 0) if item[1] is not None else 0,
        ),
    )
    return ordered[0]


def _fallback_target(symbols: list[dict], route_line: int) -> dict | None:
    if not symbols:
        return None
    after = [symbol for symbol in symbols if (symbol.get("line") or 0) >= route_line]
    if after:
        return after[0]
    return symbols[-1]


def _relative_to(root: Path, path: Path) -> str:
    try:
        return path.resolve().relative_to(root).as_posix()
    except (ValueError, OSError):
        return path.as_posix()


def _excluded(path: str, patterns: list[str]) -> bool:
    if not patterns:
        return False
    from ..config import glob_match

    return any(glob_match(path, pattern) for pattern in patterns)


def _row(row: sqlite3.Row, key: str, default: Any = None) -> Any:
    if key in row.keys():
        value = row[key]
        return default if value is None else value
    return default


def _str(value: Any) -> str:
    if value is None:
        return ""
    return str(value)


def _one_line(value: str) -> str:
    return " ".join(value.split()) if value else ""


def _int(value: Any, default: int) -> int:
    if isinstance(value, bool):
        return default
    if isinstance(value, int):
        return value
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _posix(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    text = value.replace("\\", "/").strip()
    while text.startswith("./"):
        text = text[2:]
    return text
