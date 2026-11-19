"""Configuration loading and module (glob) mapping.

Public interface (also used by the adapters / CLI)::

    load_config(project_path, config_path=None) -> dict
    module_for(path, config) -> (module_id, group)
    template(value, path) -> str
    match_module(path, config) -> dict      # richer variant used internally

The normalised config always contains the keys ``schema``, ``project``,
``index``, ``groups``, ``defaults``, ``modules``, ``metrics`` and ``overlays``,
plus ``_source`` (the config file path, or ``None``) and any unknown top-level
keys copied verbatim from the source file (for forward compatibility).
"""

from __future__ import annotations

import fnmatch
import json
import os
import re
import sys
from pathlib import Path, PurePosixPath
from typing import Any

SCHEMA = "codeviz/v1"

CONFIG_FILENAMES = ("codeviz.json", "codeviz.yml", "codeviz.yaml")

DEFAULT_DATABASE = ".codegraph/codegraph.db"
DEFAULT_EXCLUDE = (
    # Own output directory: keeps repeated builds from indexing the generated
    # site (and its embedded sources).  Additional patterns can be configured
    # with the optional top-level ``exclude`` array.
    ".codeviz/**",
)

#: Fields exposed by ``match_module`` with their defaults.
_DEFAULT_METRICS = {
    "language": "python",
    "source_lines": 60,
    "source_chars": 4000,
    "include_source": True,
}


class ConfigError(RuntimeError):
    """Raised for missing / malformed configuration files."""


def load_config(project_path: str | Path, config_path: str | None = None) -> dict:
    """Load and normalise the config for ``project_path``.

    ``config_path`` may be relative (resolved against the project first, then
    the current working directory).  When omitted the usual candidates are
    probed in order: ``codeviz.json``, ``codeviz.yml``, ``codeviz.yaml``.
    """

    root = Path(project_path).expanduser()
    try:
        root = root.resolve()
    except OSError:
        pass

    source = _find_config(root, config_path)
    if source is None:
        return normalize_config({}, root, source=None)

    suffix = source.suffix.lower()
    try:
        text = source.read_text(encoding="utf-8")
    except OSError as exc:
        raise ConfigError(f"无法读取配置文件 {source}: {exc}") from exc

    if suffix == ".json":
        try:
            raw = json.loads(text, parse_constant=_reject_constant)
        except json.JSONDecodeError as exc:
            raise ConfigError(f"配置文件 {source} 不是合法 JSON: {exc}") from exc
        except ValueError as exc:
            raise ConfigError(f"配置文件 {source} 含非法常量: {exc}") from exc
    elif suffix in (".yml", ".yaml"):
        raw = _load_yaml(text, source)
    else:
        raise ConfigError(f"不支持的配置文件类型: {source}（请使用 .json / .yml / .yaml）")

    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise ConfigError(f"配置文件 {source} 顶层必须是对象（实际为 {type(raw).__name__}）")

    return normalize_config(raw, root, source=source)


def _reject_constant(value: str) -> Any:
    raise ValueError(f"{value} 不是合法的 JSON 值")


def _load_yaml(text: str, source: Path) -> Any:
    try:
        import yaml  # type: ignore[import-not-found]
    except ImportError as exc:
        raise ConfigError(
            f"读取 {source.name} 需要 PyYAML，但当前环境未安装。\n"
            "请改用 codeviz.json，或执行 `pip install PyYAML`（可选依赖 extra: codeviz[yaml]）。"
        ) from exc

    try:
        return yaml.safe_load(text)
    except Exception as exc:  # yaml.YAMLError, but keep PyYAML optional
        raise ConfigError(f"配置文件 {source} 不是合法 YAML: {exc}") from exc


def _find_config(root: Path, config_path: str | None) -> Path | None:
    if config_path:
        candidate = Path(config_path).expanduser()
        if not candidate.is_absolute():
            project_relative = root / candidate
            if project_relative.exists():
                candidate = project_relative
            elif not candidate.exists():
                raise ConfigError(
                    f"找不到配置文件: {config_path}（已尝试 {project_relative} 与 {Path.cwd() / candidate}）"
                )
        if not candidate.exists():
            raise ConfigError(f"找不到配置文件: {config_path}")
        if candidate.is_dir():
            raise ConfigError(f"配置文件路径是目录: {candidate}")
        return candidate.resolve()

    for name in CONFIG_FILENAMES:
        candidate = root / name
        if candidate.is_file():
            return candidate
    return None


def normalize_config(raw: dict, project_path: Path, *, source: Path | None = None) -> dict:
    """Normalise a raw config mapping into the internal shape."""

    config: dict = dict(raw)  # keep unknown keys (e.g. ``data``) for extensions

    project = raw.get("project")
    project = dict(project) if isinstance(project, dict) else {}
    project.setdefault("name", project_path.name or "codeviz")
    if not isinstance(project.get("name"), str) or not project["name"].strip():
        project["name"] = project_path.name or "codeviz"
    if project.get("description") is not None and not isinstance(project["description"], str):
        project["description"] = str(project["description"])

    index = raw.get("index")
    index = dict(index) if isinstance(index, dict) else {}
    database = index.get("database")
    index["database"] = database if isinstance(database, str) and database.strip() else DEFAULT_DATABASE

    groups: dict[str, dict] = {}
    raw_groups = raw.get("groups")
    if isinstance(raw_groups, dict):
        for key, value in raw_groups.items():
            if not isinstance(key, str) or not key:
                continue
            entry = dict(value) if isinstance(value, dict) else {}
            entry.setdefault("label", key)
            if not isinstance(entry.get("label"), str):
                entry["label"] = key
            color = entry.get("color")
            valid_color = isinstance(color, str) and re.fullmatch(
                r"#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})", color
            )
            if not valid_color:
                entry.pop("color", None)
            groups[key] = entry

    raw_defaults = raw.get("defaults")
    raw_defaults = dict(raw_defaults) if isinstance(raw_defaults, dict) else {}
    default_group = raw_defaults.get("group")
    default_id = raw_defaults.get("id")
    defaults = {
        "group": default_group if isinstance(default_group, str) and default_group else "other",
        "id": default_id if isinstance(default_id, str) and default_id else "{dir}",
    }
    # ``label`` / ``desc`` must be read before rebuilding the dict, and are
    # optional (bad types are ignored rather than rejecting the config).
    for key in ("label", "desc"):
        value = raw_defaults.get(key)
        if isinstance(value, str) and value:
            defaults[key] = value

    modules: list[dict] = []
    raw_modules = raw.get("modules")
    if isinstance(raw_modules, list):
        for position, rule in enumerate(raw_modules):
            if not isinstance(rule, dict):
                continue
            glob = rule.get("glob")
            if not isinstance(glob, str) or not glob.strip():
                continue
            entry = {key: value for key, value in rule.items() if isinstance(key, str)}
            entry["glob"] = glob.strip()
            if not isinstance(entry.get("id"), str) or not entry["id"]:
                entry["id"] = defaults["id"]
            if not isinstance(entry.get("group"), str) or not entry["group"]:
                entry["group"] = defaults["group"]
            entry["_index"] = position
            modules.append(entry)

    metrics = raw.get("metrics")
    metrics = dict(metrics) if isinstance(metrics, dict) else {}
    source_lines = _positive_int(metrics.get("source_lines"), _DEFAULT_METRICS["source_lines"])
    source_chars = _positive_int(metrics.get("source_chars"), _DEFAULT_METRICS["source_chars"])
    include_source = metrics.get("include_source", _DEFAULT_METRICS["include_source"])
    language = metrics.get("language", _DEFAULT_METRICS["language"])
    metrics = {
        "language": language if isinstance(language, str) and language else "python",
        "source_lines": source_lines,
        "source_chars": source_chars,
        "include_source": bool(include_source),
    }

    overlays = raw.get("overlays")
    overlays = [item for item in overlays if isinstance(item, dict)] if isinstance(overlays, list) else []

    # ``exclude`` extends the defaults (README: 额外排除); it never replaces
    # them, so repeated builds keep ignoring their own output directory.
    exclude = list(DEFAULT_EXCLUDE)
    raw_exclude = raw.get("exclude")
    if isinstance(raw_exclude, list):
        for item in raw_exclude:
            if isinstance(item, str) and item and item not in exclude:
                exclude.append(item)

    config.update(
        {
            "schema": SCHEMA,
            "project": project,
            "index": index,
            "groups": groups,
            "defaults": defaults,
            "modules": modules,
            "metrics": metrics,
            "overlays": overlays,
            "exclude": exclude,
            "_source": str(source) if source else None,
            "_root": str(project_path),
        }
    )
    return config


def _positive_int(value: Any, default: int) -> int:
    if isinstance(value, bool):
        return default
    if isinstance(value, int):
        return value if value > 0 else default
    if isinstance(value, str) and value.strip().isdigit():
        parsed = int(value.strip())
        return parsed if parsed > 0 else default
    return default


# ---------------------------------------------------------------------------
# Module mapping
# ---------------------------------------------------------------------------


def template(value: str, path: str) -> str:
    """Expand ``{stem}`` / ``{name}`` / ``{dir}`` / ``{rel}`` for ``path``."""

    if not isinstance(value, str):
        return ""
    rel = _relative_posix(path)
    pure = PurePosixPath(rel)
    stem = pure.stem
    name = pure.name
    parent = pure.parent
    directory = "" if str(parent) in ("", ".") else str(parent)
    variables = {
        "{stem}": stem,
        "{name}": name,
        "{dir}": directory,
        "{rel}": str(pure.with_suffix("")) if pure.suffix else rel,
    }
    result = value
    for key, replacement in variables.items():
        result = result.replace(key, replacement)
    return result


def match_module(path: str, config: dict) -> dict:
    """Return ``{id,label,group,index,files...}`` metadata for ``path``."""

    rel = _relative_posix(path, config.get("_root"))
    defaults = config.get("defaults") or {}
    modules = config.get("modules") or []

    for rule in modules:
        pattern = str(rule.get("glob") or "")
        if not pattern or not glob_match(rel, pattern):
            continue
        module_id = template(str(rule.get("id") or defaults.get("id") or "{dir}"), rel)
        module_id = module_id or "root"
        label = template(str(rule.get("label") or rule.get("id") or ""), rel) if rule.get("label") else ""
        label = label or module_id
        group = str(rule.get("group") or defaults.get("group") or "other")
        desc = rule.get("desc")
        if isinstance(desc, str) and desc:
            desc = template(desc, rel)
        else:
            desc = ""
        return {
            "id": module_id,
            "label": label,
            "group": group,
            "desc": desc,
            "rule": rule,
            "index": int(rule.get("_index", len(modules))),
        }

    module_id = template(str(defaults.get("id") or "{dir}"), rel) or "root"
    label = template(str(defaults.get("label") or ""), rel) if defaults.get("label") else ""
    desc = defaults.get("desc") if isinstance(defaults.get("desc"), str) else ""
    return {
        "id": module_id,
        "label": label or module_id,
        "group": str(defaults.get("group") or "other"),
        "desc": desc or "",
        "rule": None,
        "index": len(modules),
    }


def module_for(path: str, config: dict) -> tuple[str, str]:
    """Return ``(module_id, group)`` for a project-relative path."""

    info = match_module(path, config)
    return info["id"], info["group"]


def _relative_posix(path: str, root: str | None = None) -> str:
    text = str(path).replace("\\", "/").strip()
    if root and text:
        try:
            if os.path.isabs(text):
                text = os.path.relpath(text, root).replace("\\", "/")
        except ValueError:
            pass
    while text.startswith("./"):
        text = text[2:]
    drive, tail = os.path.splitdrive(text)
    if drive:
        text = tail
    return text.lstrip("/")


def glob_match(path: str, pattern: str) -> bool:
    """Match ``path`` against a glob supporting ``**`` (crosses directories).

    ``*`` / ``?`` never cross ``/``; ``**`` does.  A pattern without ``/`` is
    matched against the file name, which keeps configs like ``*.py`` useful.
    """

    path = _relative_posix(path)
    pattern = _relative_posix(pattern)
    if not pattern:
        return False
    if "/" not in pattern:
        return fnmatch.fnmatchcase(PurePosixPath(path).name, pattern)
    return _glob_to_regex(pattern).fullmatch(path) is not None


_SPECIAL = set(".^$+{}()|\\")


def _glob_to_regex(pattern: str) -> re.Pattern[str]:
    parts = pattern.split("/")
    out: list[str] = []
    for position, part in enumerate(parts):
        if part == "**":
            # ``**/`` may match zero directories; a trailing ``**`` matches all.
            if position == len(parts) - 1:
                out.append(".*")
            else:
                out.append("(?:.*/)?")
            continue

        index = 0
        while index < len(part):
            char = part[index]
            if char == "*":
                out.append("[^/]*")
            elif char == "?":
                out.append("[^/]")
            elif char == "[":
                end = part.find("]", index + 1)
                if end < 0:
                    out.append("\\[")
                else:
                    body = part[index + 1 : end]
                    if body.startswith("!"):
                        body = "^" + body[1:]
                    out.append("[" + body + "]")
                    index = end
            elif char in _SPECIAL:
                out.append("\\" + char)
            else:
                out.append(char)
            index += 1
        if position != len(parts) - 1:
            out.append("/")
    return re.compile("".join(out) + r"\Z")


def describe(config: dict) -> str:
    """Human readable one-line summary, used in build logs."""

    source = config.get("_source") or "默认配置"
    return f"配置 {source} · 模块规则 {len(config.get('modules') or [])} 条"


def warn(message: str) -> None:
    print(f"codeviz 警告: {message}", file=sys.stderr)
