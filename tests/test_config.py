"""配置加载与模块映射（CONTRACT 第 3 节）。"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

from codeviz import config as config_module
from codeviz.config import load_config, module_for


def test_load_config_auto_discover(demo_dir: Path) -> None:
    cfg = load_config(demo_dir)

    assert isinstance(cfg, dict)
    assert cfg["schema"] == "codeviz/v1"
    assert cfg["project"]["name"] == "codeviz-demo"
    assert cfg["index"]["database"] == ".codegraph/codegraph.db"
    assert cfg["groups"]["router"]["label"] == "路由"
    assert cfg["modules"], "demo 配置应至少有一条模块规则"
    assert cfg["defaults"]["group"] == "other"


def test_load_config_explicit_path(demo_dir: Path) -> None:
    explicit = demo_dir / "codeviz.json"
    cfg = load_config(demo_dir, str(explicit))

    assert cfg["project"]["name"] == "codeviz-demo"
    assert cfg["metrics"]["source_lines"] == 60
    assert cfg["overlays"][0]["id"] == "business"


def test_load_config_explicit_relative_path(demo_dir: Path) -> None:
    cfg = load_config(demo_dir, "codeviz.json")

    assert cfg["project"]["name"] == "codeviz-demo"


def test_load_config_without_file_uses_defaults(tmp_path: Path) -> None:
    cfg = load_config(tmp_path)

    assert isinstance(cfg, dict)
    defaults = cfg.get("defaults") or {}
    assert defaults.get("id") == "{dir}"
    assert defaults.get("group") == "other"
    assert module_for("lib/a/b.py", cfg) == ("lib/a", "other")


@pytest.mark.skipif(
    importlib.util.find_spec("yaml") is None,
    reason="未安装 PyYAML（yaml 为可选依赖）",
)
def test_load_config_yaml(tmp_path: Path) -> None:
    (tmp_path / "codeviz.yml").write_text(
        "schema: codeviz/v1\n"
        "project:\n"
        "  name: yaml-demo\n"
        "groups:\n"
        "  service:\n"
        "    label: 服务\n"
        "modules:\n"
        "  - glob: svc/*.py\n"
        "    id: 'service:{stem}'\n"
        "    group: service\n",
        encoding="utf-8",
    )

    cfg = load_config(tmp_path)

    assert cfg["project"]["name"] == "yaml-demo"
    assert module_for("svc/user.py", cfg) == ("service:user", "service")


def test_module_rules_from_demo_config(demo_config: dict) -> None:
    assert module_for("app/router/task_router.py", demo_config) == ("router:task_router", "router")
    assert module_for("app/router/report_router.py", demo_config) == ("router:report_router", "router")
    assert module_for("app/service/task_service.py", demo_config) == ("service:task_service", "service")
    assert module_for("app/service/report_service.py", demo_config) == ("service:report_service", "service")


def test_module_template_dir_and_stem(demo_config: dict) -> None:
    # app/**/__init__.py -> pkg:{dir}
    assert module_for("app/router/__init__.py", demo_config) == ("pkg:app/router", "app")
    # app/*.py -> app:{stem}
    assert module_for("app/models.py", demo_config) == ("app:models", "app")
    assert module_for("app/main.py", demo_config) == ("app:main", "app")


def test_module_defaults_dir(demo_config: dict) -> None:
    assert module_for("scripts/seed.py", demo_config) == ("scripts", "other")


def test_module_first_rule_wins() -> None:
    cfg = {
        "modules": [
            {"glob": "pkg/*.py", "id": "first:{stem}", "group": "a"},
            {"glob": "pkg/*.py", "id": "second:{stem}", "group": "b"},
        ],
        "defaults": {"id": "{dir}", "group": "other"},
    }

    assert module_for("pkg/x.py", cfg) == ("first:x", "a")


def test_module_template_rel_and_name() -> None:
    cfg = {
        "modules": [
            {"glob": "pkg/sub/*.py", "id": "{rel}", "label": "{name}", "group": "g"},
        ],
        "defaults": {"id": "{dir}", "group": "other"},
    }

    assert module_for("pkg/sub/mod.py", cfg) == ("pkg/sub/mod", "g")


def test_module_normalizes_windows_separators(demo_config: dict) -> None:
    assert module_for("app\\router\\task_router.py", demo_config) == ("router:task_router", "router")
    assert module_for("app\\service\\task_service.py", demo_config) == ("service:task_service", "service")


def test_template_helper() -> None:
    template = getattr(config_module, "template", None)
    if not callable(template):
        pytest.skip("config.template 未作为公开函数暴露")

    assert template("router:{stem}", "server/routers/log_router.py") == "router:log_router"
    assert template("{dir}", "app/service/task_service.py") == "app/service"
    assert template("{name}", "app/service/task_service.py") == "task_service.py"
    assert template("{rel}", "app/service/task_service.py") == "app/service/task_service"
    assert template("{stem}-{dir}", "a/b/c.py") == "c-a/b"


def test_demo_config_is_valid_json(demo_dir: Path) -> None:
    payload = json.loads((demo_dir / "codeviz.json").read_text(encoding="utf-8"))

    assert payload["schema"] == "codeviz/v1"
    assert payload["modules"][0]["glob"] == "app/router/*_router.py"


def test_defaults_label_and_desc_are_preserved(tmp_path: Path) -> None:
    (tmp_path / "codeviz.json").write_text(
        json.dumps(
            {
                "defaults": {
                    "group": "other",
                    "id": "{dir}",
                    "label": "默认 · {stem}",
                    "desc": "没有命中规则的模块",
                }
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    cfg = load_config(tmp_path)

    assert cfg["defaults"]["label"] == "默认 · {stem}"
    assert cfg["defaults"]["desc"] == "没有命中规则的模块"

    info = config_module.match_module("scripts/seed.py", cfg)
    assert info["label"] == "默认 · seed"
    assert info["desc"] == "没有命中规则的模块"


def test_defaults_label_and_desc_ignore_bad_types(tmp_path: Path) -> None:
    (tmp_path / "codeviz.json").write_text(
        json.dumps({"defaults": {"label": 3, "desc": ["nope"], "group": 5, "id": None}}),
        encoding="utf-8",
    )

    cfg = load_config(tmp_path)

    assert "label" not in cfg["defaults"]
    assert "desc" not in cfg["defaults"]
    assert cfg["defaults"]["group"] == "other"
    assert cfg["defaults"]["id"] == "{dir}"


def test_exclude_merges_default_patterns(tmp_path: Path) -> None:
    (tmp_path / "codeviz.json").write_text(
        json.dumps({"exclude": ["build/**", ".codeviz/**", "dist/**", "build/**"]}),
        encoding="utf-8",
    )

    cfg = load_config(tmp_path)

    assert cfg["exclude"] == [".codeviz/**", "build/**", "dist/**"]


def test_exclude_non_list_falls_back_to_defaults(tmp_path: Path) -> None:
    (tmp_path / "codeviz.json").write_text(
        json.dumps({"exclude": "build/**"}),
        encoding="utf-8",
    )

    cfg = load_config(tmp_path)

    assert cfg["exclude"] == [".codeviz/**"]
