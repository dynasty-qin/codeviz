"""Static output rendering (``site`` and ``single-file``).

* ``site`` copies ``codeviz/web`` into ``<out>/assets`` and writes
  ``assets/data.js`` (``window.CODEVIZ_DATA = {...};``); ``index.html`` lives at
  the output root.
* ``single-file`` inlines CSS, JS, the payload and overlay images (as data
  URIs) into one ``index.html``.
"""

from __future__ import annotations

import json
import re
import shutil
import webbrowser
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from . import model, overlays
from .adapters import codegraph, generic
from .config import ConfigError, load_config

TZ = timezone(timedelta(hours=8))

_SCRIPT_TAG = re.compile(r'<script\b[^>]*\bsrc="assets/([^"]+)"[^>]*>\s*</script>')
_STYLE_TAG = re.compile(r'<link\b[^>]*href="assets/([^"]+)"[^>]*>')


def web_dir() -> Path:
    return Path(__file__).resolve().parent / "web"


def build_project(
    project_path,
    *,
    out_dir=None,
    config_path=None,
    output_format: str = "site",
    open_browser: bool = False,
) -> int:
    """Build the visualization and return a process exit code."""

    if output_format not in ("site", "single-file"):
        raise ValueError(f"未知输出格式: {output_format}（仅支持 site / single-file）")

    target = Path(project_path or ".").expanduser()
    if not target.exists():
        raise FileNotFoundError(f"找不到项目路径: {target}")
    target = target.resolve()

    config: dict = {}
    if target.is_file():
        root = target.parent
        data = generic.load_data(target)
        source_label = f"数据文件 {target.name}"
    else:
        root = target
        config = load_config(root, config_path)
        input_data = config.get("data")
        if isinstance(input_data, str) and input_data.strip():
            data_path = Path(input_data.strip()).expanduser()
            if not data_path.is_absolute():
                data_path = root / data_path
            data = generic.load_data(data_path)
            source_label = f"数据文件 {data_path.name}"
        else:
            data = codegraph.build_data(root, config)
            source_label = f"CodeGraph · {config.get('index', {}).get('database')}"

    data = model.ensure_data(data)
    project = data["project"]
    if isinstance(config.get("project"), dict):
        project.setdefault("name", config["project"].get("name"))
        description = config["project"].get("description")
        if description and not project.get("description"):
            project["description"] = description
    if not project.get("name"):
        project["name"] = root.name or "codeviz"
    if not target.is_file() or not project.get("root"):
        project["root"] = root.as_posix()
    project["generated_at"] = datetime.now(TZ).isoformat(timespec="seconds")

    if not data["overlays"] and config:
        data["overlays"] = overlays.load_overlays(config)

    asset_root = root
    if target.is_file():
        declared_root = project.get("root")
        if isinstance(declared_root, str) and Path(declared_root).is_dir():
            asset_root = Path(declared_root)

    output = Path(out_dir).expanduser() if out_dir else root / ".codeviz"
    if not output.is_absolute():
        output = root / output
    output = output.resolve()
    _guard_output(output)

    if output_format == "single-file":
        index_path = render_single_file(data, output, project_path=asset_root)
        kind_label = "single-file"
    else:
        index_path = render_site(data, output, project_path=asset_root)
        kind_label = "site"

    _print_summary(data, index_path, kind_label, source_label)

    if open_browser:
        try:
            webbrowser.open(index_path.as_uri())
        except Exception as exc:  # pragma: no cover - environment specific
            model.warn(f"无法自动打开浏览器: {exc}")
    return 0


def render_site(data: dict, out_dir: Path, *, project_path: Path | None = None) -> Path:
    """Write the multi-file static site and return ``<out>/index.html``."""

    output = Path(out_dir)
    web = web_dir()
    if not (web / "index.html").is_file():
        raise FileNotFoundError(f"缺少 web 模板目录: {web}")

    assets = output / "assets"
    if assets.exists():
        shutil.rmtree(assets)
    assets.mkdir(parents=True, exist_ok=True)

    asset_root = _asset_root(data, project_path)
    if asset_root is not None:
        overlays.copy_overlay_images(data.get("overlays") or [], asset_root, output)

    shutil.copytree(
        web,
        assets,
        dirs_exist_ok=True,
        ignore=shutil.ignore_patterns("index.html", "__pycache__"),
    )

    payload = model.dumps_json(data)
    (assets / "data.js").write_text(model.data_js(data), encoding="utf-8")
    (assets / "viz-data.json").write_text(payload, encoding="utf-8")

    index_path = output / "index.html"
    shutil.copyfile(web / "index.html", index_path)
    return index_path


def render_single_file(data: dict, out_dir: Path, *, project_path: Path | None = None) -> Path:
    """Write one self-contained HTML file and return its path."""

    output = Path(out_dir)
    output.mkdir(parents=True, exist_ok=True)

    html = build_single_html(data, project_path=project_path)
    index_path = output / "index.html"
    index_path.write_text(html, encoding="utf-8")
    return index_path


def build_single_html(data: dict, *, project_path: Path | None = None) -> str:
    """Return the self-contained HTML for ``data``."""

    web = web_dir()
    template_path = web / "index.html"
    if not template_path.is_file():
        raise FileNotFoundError(f"缺少 web 模板目录: {web}")
    html = template_path.read_text(encoding="utf-8")

    payload_data = dict(data)
    asset_root = _asset_root(data, project_path)
    if asset_root is not None:
        data["overlays"] = overlays.inline_overlay_images(
            data.get("overlays") or [], asset_root
        )
        payload_data["overlays"] = data["overlays"]
    payload = _inline_safe(model.data_js(payload_data))

    def replace_style(match: re.Match[str]) -> str:
        relative = match.group(1)
        path = web / relative
        if not path.is_file():
            model.warn(f"单文件模式找不到样式 {relative}")
            return ""
        content = path.read_text(encoding="utf-8")
        return "<style>\n" + content + "\n</style>"

    def replace_script(match: re.Match[str]) -> str:
        relative = match.group(1)
        if relative.replace("\\", "/") == "data.js":
            content = payload
        else:
            path = web / relative
            if not path.is_file():
                model.warn(f"单文件模式找不到脚本 {relative}")
                return ""
            content = _inline_safe(path.read_text(encoding="utf-8"))
        return "<script>\n" + content + "\n</script>"

    html = _STYLE_TAG.sub(replace_style, html)
    html = _SCRIPT_TAG.sub(replace_script, html)
    if "CODEVIZ_DATA" not in html:
        # Defensive: a template without a data.js tag would produce an empty app.
        html = html.replace("</body>", "<script>\n" + payload + "\n</script>\n</body>")
    return html


def validate_data_file(path) -> int:
    """Validate a ``.json`` / ``.js`` payload; return a process exit code."""

    source = Path(path).expanduser()
    if not source.is_file():
        print(f"校验失败：找不到文件 {source}")
        return 2

    try:
        text = source.read_text(encoding="utf-8")
    except OSError as exc:
        print(f"校验失败：无法读取 {source}: {exc}")
        return 2

    try:
        if source.suffix.lower() in (".js", ".mjs"):
            data = model.load_js_data(text)
        else:
            data = json.loads(text, parse_constant=_reject_constant)
    except (json.JSONDecodeError, ValueError) as exc:
        print(f"校验失败：{source} 不是合法数据（{exc}）")
        return 1

    errors = model.validate_data(data)
    summary = _payload_summary(data) if isinstance(data, dict) else ""
    if errors:
        print(f"校验失败：{source}（{len(errors)} 项问题）")
        for error in errors:
            print(f"  - {error}")
        return 1

    print(f"校验通过：{source}")
    if summary:
        print(f"  {summary}")
    return 0


def _reject_constant(value: str) -> Any:
    raise ValueError(f"JSON 中不允许 {value}")


def _guard_output(output: Path) -> None:
    web = web_dir().resolve()
    try:
        relative = output.relative_to(web)
    except ValueError:
        relative = None
    if relative is not None:
        raise ValueError(f"输出目录不能位于 web 模板目录内: {output}")


def _asset_root(data: dict, project_path: Path | None) -> Path | None:
    """Resolve the project root used for overlay images."""

    if project_path is not None:
        return Path(project_path)
    declared = (data.get("project") or {}).get("root")
    if isinstance(declared, str) and declared and Path(declared).is_dir():
        return Path(declared)
    return None


def _inline_safe(content: str) -> str:
    # ``</script`` inside an inline <script> would terminate the tag early.
    return content.replace("</script", "<\\/script")


def _print_summary(data: dict, index_path: Path, kind: str, source: str) -> None:
    modules = data.get("modules") or []
    files = data.get("files") or []
    symbols = data.get("symbols") or []
    calls = data.get("calls") or []
    entries = data.get("entries") or []
    index = data.get("index") or {}

    print(f"[codeviz] 数据源: {source}")
    if index:
        print(
            "[codeviz] 索引: "
            f"{index.get('database', '?')} · files {index.get('files', 0)} · "
            f"nodes {index.get('nodes', 0)} · edges {index.get('edges', 0)} · "
            f"routes {index.get('routes', 0)}"
        )
    print(
        "[codeviz] 统计: "
        f"模块 {len(modules)} · 文件 {len(files)} · 符号 {len(symbols)} · "
        f"调用 {len(calls)} · 入口 {len(entries)}"
    )
    print(
        "[codeviz] 聚合: "
        f"模块边 {len(data.get('moduleEdges') or [])} · "
        f"文件边 {len(data.get('fileEdges') or [])} · "
        f"覆盖层 {len(data.get('overlays') or [])}"
    )
    index_size = _human_size(_tree_size(index_path))
    extra = ""
    if kind == "site":
        data_path = index_path.parent / "assets" / "data.js"
        extra = f" · data.js {_human_size(_tree_size(data_path))}"
    print(f"[codeviz] 输出: {index_path}（{kind} · index {index_size}{extra}）")


def _payload_summary(data: dict) -> str:
    return (
        f"schema {data.get('schema')} · 模块 {len(data.get('modules') or [])} · "
        f"文件 {len(data.get('files') or [])} · 符号 {len(data.get('symbols') or [])} · "
        f"调用 {len(data.get('calls') or [])} · 入口 {len(data.get('entries') or [])}"
    )


def _tree_size(path: Path) -> int:
    if path.is_file():
        try:
            return path.stat().st_size
        except OSError:
            return 0
    total = 0
    for child in path.rglob("*"):
        if child.is_file():
            try:
                total += child.stat().st_size
            except OSError:
                continue
    return total


def _human_size(size: int) -> str:
    if size < 1024:
        return f"{size} B"
    for unit in ("KB", "MB", "GB"):
        size /= 1024.0
        if size < 1024 or unit == "GB":
            return f"{size:.1f} {unit}"
    return f"{size:.1f} GB"


# Re-export the config error so callers importing from ``render`` keep working.
__all__ = [
    "ConfigError",
    "build_project",
    "render_site",
    "render_single_file",
    "validate_data_file",
    "web_dir",
]
