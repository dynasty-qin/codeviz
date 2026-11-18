"""测试用最小 CodeGraph 索引库生成器。

真实 CodeGraph 库的表结构见 `.codegraph/codegraph.db`；这里只复刻 codeviz 需要的
`files` / `nodes` / `edges`（以及 `project_metadata`）四张表，字段与真实库保持一致。

用途：
- 在临时目录里造一个"已索引"的 Python 项目，避免测试依赖真实 TeamSync 索引；
- 索引逻辑（AST -> nodes/edges）只服务测试，与被测实现无关。
"""

from __future__ import annotations

import ast
import hashlib
import json
import sqlite3
import time
from pathlib import Path

FILES_DDL = """
CREATE TABLE files (
    path TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,
    language TEXT NOT NULL,
    size INTEGER NOT NULL,
    modified_at INTEGER NOT NULL,
    indexed_at INTEGER NOT NULL,
    node_count INTEGER DEFAULT 0,
    errors TEXT,
    generated INTEGER NOT NULL DEFAULT 0
)
"""

NODES_DDL = """
CREATE TABLE nodes (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    qualified_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    language TEXT NOT NULL,
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    start_column INTEGER NOT NULL,
    end_column INTEGER NOT NULL,
    docstring TEXT,
    signature TEXT,
    visibility TEXT,
    is_exported INTEGER DEFAULT 0,
    is_async INTEGER DEFAULT 0,
    is_static INTEGER DEFAULT 0,
    is_abstract INTEGER DEFAULT 0,
    decorators TEXT,
    type_parameters TEXT,
    return_type TEXT,
    updated_at INTEGER NOT NULL
)
"""

EDGES_DDL = """
CREATE TABLE edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    kind TEXT NOT NULL,
    metadata TEXT,
    line INTEGER,
    col INTEGER,
    provenance TEXT DEFAULT NULL
)
"""

METADATA_DDL = """
CREATE TABLE project_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
)
"""

_IGNORED_DIRS = {"__pycache__", ".git", ".codegraph", ".venv", "node_modules", ".codeviz"}


def _node_id(kind: str, rel: str, qualified: str, line: int) -> str:
    digest = hashlib.md5(f"{kind}:{rel}:{qualified}:{line}".encode("utf-8")).hexdigest()
    return f"{kind}:{digest}"


def _signature(node: ast.AST) -> str | None:
    args = getattr(node, "args", None)
    if args is None:
        return None
    try:
        rendered = "(" + ast.unparse(args) + ")"
    except Exception:  # pragma: no cover - 老 Python 兜底
        rendered = "(...)"
    returns = getattr(node, "returns", None)
    if returns is not None:
        try:
            rendered += " -> " + ast.unparse(returns)
        except Exception:  # pragma: no cover
            pass
    return rendered


def _decorator_info(node: ast.AST) -> list[dict]:
    info: list[dict] = []
    for deco in getattr(node, "decorator_list", []):
        if isinstance(deco, ast.Call):
            name = ""
            if isinstance(deco.func, ast.Name):
                name = deco.func.id
            elif isinstance(deco.func, ast.Attribute):
                name = deco.func.attr
            args: list[object] = []
            for arg in deco.args:
                try:
                    args.append(ast.literal_eval(arg))
                except Exception:
                    args.append(None)
            info.append({"name": name, "args": args, "line": deco.lineno})
        elif isinstance(deco, ast.Name):
            info.append({"name": deco.id, "args": [], "line": deco.lineno})
        elif isinstance(deco, ast.Attribute):
            info.append({"name": deco.attr, "args": [], "line": deco.lineno})
    return info


class _Collector(ast.NodeVisitor):
    """收集函数 / 类 / 调用，足够测试使用。"""

    def __init__(self, rel: str, now: int) -> None:
        self.rel = rel
        self.now = now
        self.nodes: list[dict] = []
        self.calls: list[dict] = []
        self.routes: list[dict] = []
        self._stack: list[str] = []

    # -- 节点 ---------------------------------------------------------------
    def _add_symbol(self, node: ast.AST, kind: str, name: str, qualified: str) -> str:
        node_id = _node_id(kind, self.rel, qualified, node.lineno)
        self.nodes.append(
            {
                "id": node_id,
                "kind": kind,
                "name": name,
                "qualified_name": qualified,
                "file_path": self.rel,
                "start_line": node.lineno,
                "end_line": getattr(node, "end_lineno", node.lineno) or node.lineno,
                "docstring": ast.get_docstring(node),
                "signature": _signature(node),
                "decorators": json.dumps([d["name"] for d in _decorator_info(node)], ensure_ascii=False)
                if getattr(node, "decorator_list", None)
                else None,
                "updated_at": self.now,
            }
        )
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for deco in _decorator_info(node):
                args = deco.get("args") or []
                if deco["name"] == "route" and len(args) >= 2 and all(isinstance(a, str) for a in args[:2]):
                    method, path = args[0], args[1]
                    route_qualified = f"{self.rel}::{method.upper()}:{path}"
                    route_id = f"route:{self.rel}:{deco['line']}:{method.upper()}:{path}"
                    self.routes.append(
                        {
                            "id": route_id,
                            "name": f"{method.upper()} {path}",
                            "qualified_name": route_qualified,
                            "file_path": self.rel,
                            "line": deco["line"],
                            "handler_id": node_id,
                            "handler": name,
                        }
                    )
        return node_id

    def visit_ClassDef(self, node: ast.ClassDef) -> None:  # noqa: N802
        qualified = "::".join(self._stack + [node.name])
        self._add_symbol(node, "class", node.name, qualified)
        self._stack.append(node.name)
        self.generic_visit(node)
        self._stack.pop()

    def _visit_function(self, node: ast.AST, kind: str) -> None:
        name = node.name
        qualified = "::".join(self._stack + [name])
        caller_id = self._add_symbol(node, kind, name, qualified)
        self._stack.append(name)
        for child in _body_calls(node):
            callee = _call_name(child)
            if callee:
                self.calls.append({"line": child.lineno, "caller": caller_id, "callee": callee})
        # 继续遍历嵌套定义
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                self.visit(child)
        self._stack.pop()

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:  # noqa: N802
        self._visit_function(node, "method" if self._stack else "function")

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:  # noqa: N802
        self._visit_function(node, "method" if self._stack else "function")


def _body_calls(node: ast.AST) -> list[ast.Call]:
    """收集函数体里的调用，跳过装饰器与嵌套定义（它们各自独立统计）。"""

    found: list[ast.Call] = []
    stack = list(getattr(node, "body", []) or [])
    while stack:
        current = stack.pop()
        if isinstance(current, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            continue
        if isinstance(current, ast.Call):
            found.append(current)
        stack.extend(ast.iter_child_nodes(current))
    return found


def _call_name(call: ast.Call) -> str | None:
    func = call.func
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return None


def _module_file(root: Path, parts: list[str]) -> str | None:
    if not parts:
        return None
    candidates = [Path(*parts).with_suffix(".py"), Path(*parts) / "__init__.py"]
    for candidate in candidates:
        if (root / candidate).is_file():
            return candidate.as_posix()
    return None


def _import_target(root: Path, rel: str, node: ast.ImportFrom) -> str | None:
    if not node.module and not node.level:
        return None
    base = Path(rel).parent
    for _ in range(max(node.level - 1, 0)):
        base = base.parent
    parts = [p for p in base.parts if p not in (".", "")]
    if node.module:
        parts.extend(node.module.split("."))
    return _module_file(root, parts)


def index_project(project_root: Path, db_path: Path) -> dict:
    """扫描 project_root 下的 .py 文件，写一个最小 CodeGraph 库。

    返回 {"files": n, "nodes": n, "edges": n, "routes": n}。
    """
    project_root = project_root.resolve()
    now = int(time.time() * 1000)
    py_files = sorted(
        p
        for p in project_root.rglob("*.py")
        if not any(part in _IGNORED_DIRS for part in p.relative_to(project_root).parts)
    )

    files: list[dict] = []
    nodes: list[dict] = []
    edges: list[dict] = []
    collectors: list[tuple[str, "_Collector"]] = []

    parsed: list[tuple[str, str, ast.Module | None]] = []
    for path in py_files:
        rel = path.relative_to(project_root).as_posix()
        text = path.read_text(encoding="utf-8")
        try:
            tree: ast.Module | None = ast.parse(text)
        except SyntaxError:
            tree = None
        parsed.append((rel, text, tree))
        files.append(
            {
                "path": rel,
                "content_hash": hashlib.sha256(text.encode("utf-8")).hexdigest(),
                "language": "python",
                "size": len(text.encode("utf-8")),
                "modified_at": int(path.stat().st_mtime * 1000),
                "indexed_at": now,
                "node_count": 0,
                "errors": None,
                "generated": 0,
            }
        )

    for rel, text, tree in parsed:
        file_id = f"file:{rel}"
        end_line = max(len(text.splitlines()), 1)
        nodes.append(
            {
                "id": file_id,
                "kind": "file",
                "name": Path(rel).name,
                "qualified_name": rel,
                "file_path": rel,
                "start_line": 1,
                "end_line": end_line,
                "docstring": None,
                "signature": None,
                "decorators": None,
                "updated_at": now,
            }
        )
        if tree is None:
            continue
        collector = _Collector(rel, now)
        for child in tree.body:
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                collector.visit(child)
        collectors.append((rel, collector))
        for symbol in collector.nodes:
            nodes.append(
                {
                    "id": symbol["id"],
                    "kind": symbol["kind"],
                    "name": symbol["name"],
                    "qualified_name": symbol["qualified_name"],
                    "file_path": rel,
                    "start_line": symbol["start_line"],
                    "end_line": symbol["end_line"],
                    "docstring": symbol["docstring"],
                    "signature": symbol["signature"],
                    "decorators": symbol["decorators"],
                    "updated_at": now,
                }
            )
            edges.append({"source": file_id, "target": symbol["id"], "kind": "contains", "metadata": None, "line": None})
        for route in collector.routes:
            nodes.append(
                {
                    "id": route["id"],
                    "kind": "route",
                    "name": route["name"],
                    "qualified_name": route["qualified_name"],
                    "file_path": rel,
                    "start_line": route["line"],
                    "end_line": route["line"],
                    "docstring": None,
                    "signature": None,
                    "decorators": None,
                    "updated_at": now,
                }
            )
            edges.append({"source": file_id, "target": route["id"], "kind": "contains", "metadata": None, "line": None})
            edges.append(
                {
                    "source": route["id"],
                    "target": route["handler_id"],
                    "kind": "references",
                    "metadata": json.dumps(
                        {"refName": route["handler"], "resolvedBy": "exact-match", "confidence": 0.9},
                        ensure_ascii=False,
                    ),
                    "line": route["line"],
                }
            )
        for imp in ast.walk(tree):
            if isinstance(imp, ast.ImportFrom):
                target = _import_target(project_root, rel, imp)
                if target and target != rel:
                    edges.append(
                        {
                            "source": file_id,
                            "target": f"file:{target}",
                            "kind": "imports",
                            "metadata": json.dumps({"refName": imp.module, "resolvedBy": "import"}, ensure_ascii=False),
                            "line": imp.lineno,
                        }
                    )
            elif isinstance(imp, ast.Import):
                for alias in imp.names:
                    target = _module_file(project_root, alias.name.split("."))
                    if target and target != rel:
                        edges.append(
                            {
                                "source": file_id,
                                "target": f"file:{target}",
                                "kind": "imports",
                                "metadata": json.dumps({"refName": alias.name, "resolvedBy": "import"}, ensure_ascii=False),
                                "line": imp.lineno,
                            }
                        )

        by_name: dict[str, list[str]] = {}
        for symbol in collector.nodes:
            if symbol["kind"] in ("function", "method"):
                by_name.setdefault(symbol["name"], []).append(symbol["id"])
        same_file = {symbol["id"] for symbol in collector.nodes}
        for call in collector.calls:
            candidates = by_name.get(call["callee"], [])
            local = [cid for cid in candidates if cid in same_file]
            if len(local) == 1:
                target = local[0]
            elif len(candidates) == 1:
                target = candidates[0]
            else:
                continue
            if target == call["caller"]:
                continue
            edges.append(
                {
                    "source": call["caller"],
                    "target": target,
                    "kind": "calls",
                    "metadata": json.dumps({"refName": call["callee"]}, ensure_ascii=False),
                    "line": call["line"],
                }
            )

    # 先收集全项目的函数名，再解析调用边（同文件优先，其次全局唯一）
    global_names: dict[str, list[str]] = {}
    for _rel, collector in collectors:
        for symbol in collector.nodes:
            if symbol["kind"] in ("function", "method"):
                global_names.setdefault(symbol["name"], []).append(symbol["id"])

    for _rel, collector in collectors:
        local_ids = {symbol["id"] for symbol in collector.nodes}
        for call in collector.calls:
            candidates = global_names.get(call["callee"], [])
            local = [cid for cid in candidates if cid in local_ids]
            if len(local) == 1:
                target = local[0]
            elif len(candidates) == 1:
                target = candidates[0]
            else:
                continue
            if target == call["caller"]:
                continue
            edges.append(
                {
                    "source": call["caller"],
                    "target": target,
                    "kind": "calls",
                    "metadata": json.dumps({"refName": call["callee"]}, ensure_ascii=False),
                    "line": call["line"],
                }
            )

    node_counts: dict[str, int] = {}
    for node in nodes:
        node_counts[node["file_path"]] = node_counts.get(node["file_path"], 0) + 1
    for row in files:
        row["node_count"] = node_counts.get(row["path"], 0)

    db_path.parent.mkdir(parents=True, exist_ok=True)
    if db_path.exists():
        db_path.unlink()
    conn = sqlite3.connect(str(db_path))
    try:
        cur = conn.cursor()
        cur.execute(FILES_DDL)
        cur.execute(NODES_DDL)
        cur.execute(EDGES_DDL)
        cur.execute(METADATA_DDL)
        cur.execute("CREATE INDEX idx_nodes_file_line ON nodes(file_path, start_line)")
        cur.execute("CREATE INDEX idx_nodes_kind ON nodes(kind, file_path, start_line, id)")
        cur.execute("CREATE INDEX idx_edges_kind ON edges(kind)")
        now_ms = now
        cur.executemany(
            "INSERT INTO files (path, content_hash, language, size, modified_at, indexed_at, node_count, errors, generated)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                (
                    row["path"],
                    row["content_hash"],
                    row["language"],
                    row["size"],
                    row["modified_at"],
                    row["indexed_at"],
                    row["node_count"],
                    row["errors"],
                    row["generated"],
                )
                for row in files
            ],
        )
        cur.executemany(
            "INSERT INTO nodes (id, kind, name, qualified_name, file_path, language, start_line, end_line,"
            " start_column, end_column, docstring, signature, visibility, is_exported, is_async, is_static,"
            " is_abstract, decorators, type_parameters, return_type, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, NULL, 0, 0, 0, 0, ?, NULL, NULL, ?)",
            [
                (
                    node["id"],
                    node["kind"],
                    node["name"],
                    node["qualified_name"],
                    node["file_path"],
                    "python",
                    node["start_line"],
                    node["end_line"],
                    node["docstring"],
                    node["signature"],
                    node["decorators"],
                    node["updated_at"],
                )
                for node in nodes
            ],
        )
        cur.executemany(
            "INSERT INTO edges (source, target, kind, metadata, line, col, provenance) VALUES (?, ?, ?, ?, ?, NULL, NULL)",
            [(edge["source"], edge["target"], edge["kind"], edge["metadata"], edge["line"]) for edge in edges],
        )
        cur.executemany(
            "INSERT INTO project_metadata (key, value, updated_at) VALUES (?, ?, ?)",
            [
                ("index_state", "complete", now_ms),
                ("indexed_with_version", "1.6.2", now_ms),
                ("index_files_discovered", str(len(files)), now_ms),
            ],
        )
        conn.commit()
    finally:
        conn.close()

    return {
        "files": len(files),
        "nodes": len(nodes),
        "edges": len(edges),
        "routes": sum(1 for node in nodes if node["kind"] == "route"),
    }
