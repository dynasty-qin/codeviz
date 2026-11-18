"""Python AST metrics: lines, branches, excepts and source snippets.

Branch counting follows CONTRACT.md: ``if`` (each ``elif`` is a nested ``if``),
``for`` / ``async for``, ``while``, ``try``, boolean operators (one branch per
extra operand), conditional expressions and ``match`` statements (one for the
``match`` plus one per ``case``).  ``except`` handlers are counted separately in
``excepts`` (they are not added to ``branches``).

Nested ``def`` / ``class`` bodies are *not* counted towards their parent: they
are their own symbols and are measured independently.
"""

from __future__ import annotations

import ast
from pathlib import Path
from typing import Any, Iterable

TRUNCATED_MARK = "\n# ...（源码已截断）"

_BRANCH_SKIP = (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)


def read_source(path: str | Path) -> list[str]:
    """Read a source file as a list of lines (UTF-8, tolerant of bad bytes)."""

    text = Path(path).read_text(encoding="utf-8", errors="replace")
    return text.splitlines()


def scan_file(
    path: str | Path,
    *,
    source_lines: int = 60,
    source_chars: int = 4000,
    include_source: bool = True,
) -> dict[str, dict]:
    """Scan one Python file, keyed by the ``def`` line number as a string."""

    try:
        return scan_lines(
            read_source(path),
            source_lines=source_lines,
            source_chars=source_chars,
            include_source=include_source,
        )
    except (OSError, SyntaxError, ValueError):
        return {}


def scan_lines(
    lines: Iterable[str],
    *,
    source_lines: int = 60,
    source_chars: int = 4000,
    include_source: bool = True,
) -> dict[str, dict]:
    """Scan already-loaded source lines (see :func:`scan_file`)."""

    lines = list(lines)
    text = "\n".join(lines)
    try:
        tree = ast.parse(text)
    except (SyntaxError, ValueError):
        return {}

    collector = _Collector(lines, source_lines, source_chars, include_source)
    collector.visit(tree)
    return collector.functions


def scan_symbol(
    project_path: str | Path,
    symbol: dict,
    *,
    source_lines: int = 60,
    source_chars: int = 4000,
    include_source: bool = True,
) -> None:
    """Attach metrics / source from a Python file to ``symbol`` in place."""

    file_path = symbol.get("file")
    if not isinstance(file_path, str) or not file_path:
        return
    path = Path(project_path) / file_path
    scan = scan_file(
        path,
        source_lines=source_lines,
        source_chars=source_chars,
        include_source=include_source,
    )
    if not scan:
        return
    hit = lookup(scan, symbol)
    if hit is None:
        return
    _apply(symbol, hit)


def lookup(scan: dict[str, dict], symbol: dict) -> dict | None:
    """Find the AST record matching a CodeGraph symbol.

    CodeGraph sometimes stores the decorator line instead of the ``def`` line,
    so a line match is preferred but a same-name match within a few lines is
    accepted.
    """

    line = symbol.get("line")
    if isinstance(line, int):
        exact = scan.get(str(line))
        if exact is not None:
            return exact

    name = symbol.get("name")
    if not isinstance(name, str) or not name:
        return None

    candidates = [item for item in scan.values() if item.get("name") == name]
    if not candidates:
        return None
    if isinstance(line, int):
        candidates.sort(key=lambda item: abs(int(item.get("line") or 0) - line))
        best = candidates[0]
        if abs(int(best.get("line") or 0) - line) <= 8:
            return best
    qualified = symbol.get("qualified")
    if isinstance(qualified, str):
        tail = qualified.split("::")[-1].split(".")[-1]
        for item in candidates:
            if item.get("qualified") == tail or item.get("qualified", "").endswith(tail):
                return item
    return candidates[0]


def _apply(symbol: dict, metrics: dict) -> None:
    symbol["branches"] = metrics.get("branches", 0)
    symbol["excepts"] = metrics.get("excepts", 0)
    if metrics.get("doc"):
        symbol["doc"] = metrics["doc"]
    if metrics.get("signature"):
        symbol["signature"] = metrics["signature"]
    if metrics.get("source"):
        symbol["source"] = metrics["source"]
    if not symbol.get("lines") and metrics.get("lines"):
        symbol["lines"] = metrics["lines"]


class _Collector(ast.NodeVisitor):
    def __init__(
        self,
        lines: list[str],
        source_lines: int,
        source_chars: int,
        include_source: bool,
    ) -> None:
        self.lines = lines
        self.source_lines = max(1, int(source_lines))
        self.source_chars = max(1, int(source_chars))
        self.include_source = include_source
        self.functions: dict[str, dict] = {}
        # Stack of (kind, name) where kind is "class" or "function".
        self._stack: list[tuple[str, str]] = []

    # -- traversal ---------------------------------------------------------
    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self._stack.append(("class", node.name))
        try:
            self.generic_visit(node)
        finally:
            self._stack.pop()

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._visit_function(node, is_async=False)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self._visit_function(node, is_async=True)

    def _visit_function(self, node: ast.AST, *, is_async: bool = False) -> None:
        name = getattr(node, "name", "")
        if not name:
            return

        is_method = bool(self._stack) and self._stack[-1][0] == "class"
        record: dict[str, Any] = {
            "name": name,
            "qualified": ".".join([*(part for _kind, part in self._stack), name]),
            "line": int(getattr(node, "lineno", 0) or 0),
            "end": int(getattr(node, "end_lineno", 0) or 0),
            "kind": "method" if is_method else "function",
            "lines": max(
                1,
                int(getattr(node, "end_lineno", 0) or 0) - int(getattr(node, "lineno", 0) or 0) + 1,
            ),
            "branches": count_branches(node),
            "excepts": count_excepts(node),
            "doc": ast.get_docstring(node, clean=True) or "",
            "signature": _signature(node),
            "is_async": is_async,
        }
        if self.include_source:
            record["source"] = self._source(node)

        key = str(record["line"])
        # Nested functions can share a line (rare, e.g. d = lambda: ...); keep
        # the first one because CodeGraph resolves by line too.
        self.functions.setdefault(key, record)

        self._stack.append(("function", name))
        try:
            self.generic_visit(node)
        finally:
            self._stack.pop()

    # -- source ------------------------------------------------------------
    def _source(self, node: ast.AST) -> str:
        start = int(getattr(node, "lineno", 0) or 0)
        end = int(getattr(node, "end_lineno", 0) or start)
        if start <= 0:
            return ""
        snippet = self.lines[start - 1 : end]
        truncated = False
        if len(snippet) > self.source_lines:
            snippet = snippet[: self.source_lines]
            truncated = True
        text = "\n".join(snippet)
        if len(text) > self.source_chars:
            text = text[: self.source_chars]
            truncated = True
        if truncated:
            text = text.rstrip() + TRUNCATED_MARK
        return text


def _signature(node: ast.AST) -> str:
    try:
        args = ast.unparse(node.args)  # type: ignore[attr-defined]
    except Exception:
        args = ""
    returns = getattr(node, "returns", None)
    suffix = ""
    if returns is not None:
        try:
            suffix = " -> " + ast.unparse(returns)
        except Exception:
            suffix = ""
    return "(" + args + ")" + suffix


def count_branches(function: ast.AST) -> int:
    """Count decision points inside ``function`` (excluding nested defs)."""

    total = 0

    def walk(node: ast.AST) -> None:
        nonlocal total
        if isinstance(node, _BRANCH_SKIP):
            return
        if isinstance(node, ast.If):
            total += 1
        elif isinstance(node, (ast.For, ast.AsyncFor, ast.While)):
            total += 1
        elif isinstance(node, ast.Try) or node.__class__.__name__ == "TryStar":
            total += 1
        elif isinstance(node, ast.IfExp):
            total += 1
        elif isinstance(node, ast.BoolOp):
            total += max(1, len(node.values) - 1)
        elif isinstance(node, ast.Match):
            total += 1 + len(node.cases)

        for child in ast.iter_child_nodes(node):
            walk(child)

    for statement in getattr(function, "body", []) or []:
        walk(statement)
    return total


def count_excepts(function: ast.AST) -> int:
    """Count ``except`` handlers inside ``function`` (excluding nested defs)."""

    total = 0

    def walk(node: ast.AST) -> None:
        nonlocal total
        if isinstance(node, _BRANCH_SKIP):
            return
        if isinstance(node, ast.ExceptHandler):
            total += 1
        for child in ast.iter_child_nodes(node):
            walk(child)

    for statement in getattr(function, "body", []) or []:
        walk(statement)
    return total
