# AGENTS.md

单包 Python 3.10+ CLI：把 CodeGraph 索引（`.codegraph/codegraph.db`）或一份 `codeviz/v1` JSON
渲染成可离线打开的静态站点。用户文档见 `README.md`，接口基线见 `CONTRACT.md`。

## 用 CodeGraph 查代码

- 只有存在 `.codegraph/` 的目录才能用 CodeGraph 查。**本仓库已初始化索引**（`.codegraph/` 已 gitignore，勿提交），
  查这里时传 `projectPath: F:\codeviz`，或在仓库根直接用 shell `codegraph explore`。给其他项目建索引由用户决定，
  不要擅自跑 `codegraph init`。
- 已索引的项目优先用图查询而不是 grep：MCP `codegraph_explore`（同时查多个项目时传 `projectPath`）
  或 shell `codegraph explore "<符号名或问题>"` 一次拿到符号源码 + 调用路径；单点追查用
  `codegraph node <name>` / `callers` / `callees` / `impact`。
- 索引是增量的：改完代码跑 `codegraph sync`；先用 `codegraph status` 确认状态，异常时 `codegraph index` 全量重建。
- codeviz 读的就是 `<project>/.codegraph/codegraph.db`（可用 `codeviz.json` 的 `index.database` 改路径）。
  所以 `codegraph init -y`（非交互）之后 `codeviz build .` 才有数据；没有索引时 CLI 直接报"找不到 CodeGraph 索引"。
- 索引库只归 CodeGraph 维护，codeviz 以只读方式打开（`?mode=ro`），不要写入或手工改表。

## 数据流

`codeviz/cli.py` → `render.build_project` →（`config["data"]` 指定的 JSON / 数据文件路径 → `adapters/generic.py`；
否则 `adapters/codegraph.py`）→ `model.ensure_data` → `render_site` / `render_single_file`。
`graph.py` 负责模块/文件边与调用链聚合，`metrics/python_ast.py` 只统计 Python 指标。

- `CONTRACT.md` 是 `codeviz/v1` 与前端视图的基线：扩展只能追加字段，不能改既有语义；视图必须容忍空数组。
- 传入的 `path` 是数据文件时，`build` 跳过 `codeviz.json`，直接渲染该文件。

## 命令

```bash
python -m pytest -q                     # 仓库根运行，无需先 pip install（conftest 注入 sys.path）
python -m pytest tests/test_render.py -q   # 单个文件；加 -k 关键词筛用例
python -m codeviz.cli build examples/demo --config examples/demo/codeviz.json --out .tmp-site
pip install -e ".[yaml]"                # 只有读 codeviz.yml 才需要 PyYAML；JSON 配置零依赖
```

- 没有 lint / format / typecheck 配置，不要臆造那类命令；CI（`.github/workflows/tests.yml`）只跑 `pytest -q`，
  Python 3.10/3.11/3.12。
- 构建 `examples/demo` 前需先有索引（见上节）；没有索引时改为直接传一份 `codeviz/v1` JSON 给 `build`。

## 测试

- 测试不依赖 `codegraph` 可执行文件：`tests/_codegraph_fixture.py` 用 sqlite3 现场生成与真实 CodeGraph 同结构的
  最小库。改动适配器对表/列结构的假设时，同步改这里的 DDL。
- 常用夹具：`project`（demo 的临时副本 + 假索引）、`demo_data`（构建好的 v1 数据）、`minimal_data`
  （`tests/fixtures/minimal_data.json`）。测试只写 `tmp_path`，不要写真实 `examples/demo`。
- 全套 52 个用例亚秒级跑完，改完直接全量跑。

## 输出与 web 资源

- `codeviz/web/` 是站点源码，`render_site` 会先 `rmtree(<out>/assets)` 再整目录拷贝；
  输出目录不允许落在 `codeviz/web` 内（`render._guard_output`）。
- `web/index.html` 里 `<script src="assets/...">` 的顺序固定（`data.js` → `views/*.js` → `app.js`）。
  `--format single-file` 靠正则替换这些标签内联资源，改标签写法会悄悄破坏单文件输出。
- 新增视图：在 `codeviz/web/views/` 注册 `window.CodeViz.registerView`，在 `index.html` 的 `app.js` 之前引入，
  并在 `app.js` 的 tab 表登记。`pyproject.toml` 的 package-data 只覆盖 `web/*` 与 `web/views/*`，
  新增子目录要补。
- 产物里 `assets/data.js` 是 `window.CODEVIZ_DATA = {...};`，`assets/viz-data.json` 是同一份纯 JSON。

## 适配器注意事项

- CodeGraph 库以只读 URI（`?mode=ro`）打开，只依赖 `files` / `nodes` / `edges` 三张表；缺表抛 `AdapterError`，
  CLI 退出码 2。
- 符号只取 `function` / `method` 节点，`symbols[].id` 原样保留 CodeGraph node id，`calls` 边靠它对齐。
  `entries` 只来自 `route` 节点及其 `references` / `calls` 边，没有路由概念的项目为空。
- 默认 `exclude` 包含 `.codeviz/**`，防止重复构建把自己的产物索引进去。
- 路径一律归一化为 `/`（`_posix`），跨平台比较前先处理 Windows 反斜杠。

## 约定

- 代码、文档多为中文，文件是 UTF-8；PowerShell 控制台读中文可能显示乱码，属显示问题，用 Read 工具看文件。
- `CONTRACT.md` §7 的并行开发归属表对单人已过时，但「不要破坏契约字段」仍然有效。
