"""CLI entry point.

Commands::

    codeviz build [PATH] --out .codeviz --config codeviz.json --format site|single-file [--open]
    codeviz validate [DATA.json|DATA.js]

``PATH`` may be a project directory (with a ``.codegraph/codegraph.db`` index or
a ``codeviz/v1`` JSON referenced by ``config["data"]``) or a data file itself.
"""

from __future__ import annotations

import argparse
import sys

__version__ = "0.1.0"


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        prog="codeviz",
        description="CodeGraph 架构 / 调用链 / 复杂度静态可视化",
    )
    parser.add_argument("--version", action="version", version=f"codeviz {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    build = sub.add_parser("build", help="生成静态可视化站点")
    build.add_argument("path", nargs="?", default=".", help="项目目录或 codeviz/v1 数据文件")
    build.add_argument("--out", default=None, help="输出目录（默认 <project>/.codeviz）")
    build.add_argument("--config", default=None, help="配置文件（默认自动查找 codeviz.json / codeviz.yml）")
    build.add_argument(
        "--format",
        choices=["site", "single-file"],
        default="site",
        help="site: 多文件静态站点（默认）；single-file: 单 HTML，内联全部资源",
    )
    build.add_argument("--open", action="store_true", dest="open_browser", help="构建完成后打开浏览器")

    validate = sub.add_parser("validate", help="校验 codeviz/v1 数据文件（.json 或 data.js）")
    validate.add_argument("data", help="数据文件路径")

    args = parser.parse_args(argv)

    if args.command == "build":
        from .adapters.codegraph import AdapterError
        from .config import ConfigError
        from .render import build_project

        try:
            return build_project(
                args.path,
                out_dir=args.out,
                config_path=args.config,
                output_format=args.format,
                open_browser=args.open_browser,
            )
        except KeyboardInterrupt:
            print("已取消", file=sys.stderr)
            return 130
        except (FileNotFoundError, ConfigError, ValueError, AdapterError, OSError) as exc:
            print(f"codeviz 错误: {exc}", file=sys.stderr)
            return 2

    if args.command == "validate":
        from .render import validate_data_file

        return validate_data_file(args.data)

    parser.error(f"未知命令: {args.command}")
    return 2


if __name__ == "__main__":
    sys.exit(main())
