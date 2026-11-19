# codeviz

把 CodeGraph 索引变成**可离线打开的**架构 / 调用链 / 复杂度可视化站点：

```bash
codeviz build <project> --out .codeviz --format site|single-file
```

一个命令读取 `<project>/.codegraph/codegraph.db`（或一份 `codeviz/v1` JSON），聚合模块依赖、文件调用关系、入口路由和函数复杂度（分支 / `except` / 行数），生成带语义缩放、URL 深链和源码预览的单页应用。产物无 CDN、无后端、无需联网，默认写到 `<project>/.codeviz/index.html`，双击即开；`--format single-file` 则打成单个 HTML，方便通过 IM / 邮件分发。界面使用浅色护眼主题（暖白背景、低饱和配色、≥12px 字号），并支持键盘操作与窄屏底部面板。

- 输入：任意 CodeGraph 已索引项目（`.codegraph/codegraph.db`），或一份 `codeviz/v1` JSON。
- 输出：默认 `<project>/.codeviz/index.html`，无 CDN、无后端、双击即开。
- 语言指标：目前只做 Python（AST 统计分支 / `except` / 行数）；其他语言走通用 JSON 适配器。
- 原则：只读目标项目，不改目标项目运行时代码。

> 版本 0.1.0（P0 范围）。实现契约见 [`CONTRACT.md`](./CONTRACT.md)；本 README 面向使用者与二次开发者；契约是并行开发的接口基线。

---

## 1. 安装

要求 Python 3.10+。

```bash
# 作为独立命令行工具（推荐）
pipx install .

# 或在仓库内可编辑安装（开发用）
pip install -e .

# 需要 YAML 配置（codeviz.yml）时
pip install -e ".[yaml]"

# 开发/测试
pip install -e ".[dev]"
pytest
```

安装后入口为 `codeviz`（等价 `python -m codeviz.cli`）。不安装也可以从仓库根直接运行：

```powershell
# 先让 Python 找到 codeviz 包（仓库根即包所在目录）
$env:PYTHONPATH = "F:\path\to\codeviz"
python -m codeviz.cli build ./examples/demo --config ./examples/demo/codeviz.json
```

也可以直接渲染一份已有的 `codeviz/v1` JSON（不需要 CodeGraph 索引）：

```bash
codeviz build ./data.json --out ./.codeviz
# 或在 codeviz.json 里写 "data": "viz-data.json"，build 时会优先读这份数据
```

## 2. 快速开始

```bash
# 1) 先在目标项目里建索引（一次性，CodeGraph 自己维护增量）
cd path/to/project
codegraph init -y

# 2) 生成可视化（默认写到 ./.codeviz/index.html）
codeviz build .

# 3) 常用参数
codeviz build . --out ./docs/arch --format single-file   # 单 HTML，方便发同事
codeviz build . --config ./codeviz.json                 # 显式指定配置
codeviz build . --open                                  # 生成后打开浏览器
codeviz build . --no-data-json                          # 不写 assets/viz-data.json，减小产物体积
codeviz build . --no-root                               # project.root 留空，避免产物泄漏本机路径
codeviz validate ./data.json                            # 校验一份 codeviz/v1 数据（也支持 data.js）
```

代码改动后索引不会自动刷新，需要时先跑 `codegraph sync`（增量）或 `codegraph index`（全量重建）。

想看效果但手头没有 CodeGraph 索引？用示例项目：

```bash
cd examples/demo
codegraph init -y          # 生成 .codegraph/codegraph.db
codeviz build . --config codeviz.json --out ./.codeviz --open
```

示例项目是一个 12 个文件的迷你任务 / 日报服务，刻意做成 `router → service → store` 三层，
带类、互相调用、`if` / `for` / `try` 分支，可用来验证模块映射与指标是否正常。

## 3. 配置 `codeviz.json`

放在目标项目根目录，默认按 `codeviz.json` → `codeviz.yml` → `codeviz.yaml` 顺序自动查找。
配置文件不存在时使用内置默认值（所有文件按父目录归组）。

```jsonc
{
  "schema": "codeviz/v1",
  "project": {
    "name": "my-project",
    "description": "示例项目"
  },
  "index": { "database": ".codegraph/codegraph.db" },
  "groups": {
    "router": { "label": "路由", "color": "#818cf8" },
    "service": { "label": "业务服务", "color": "#34d399" }
  },
  "defaults": { "group": "other", "id": "{dir}" },
  "modules": [
    { "glob": "server/routers/*_router.py", "id": "router:{stem}", "label": "{stem}", "group": "router" },
    { "glob": "client/views/manager/*.py", "id": "page:{stem}", "label": "{stem}", "group": "client" }
  ],
  "metrics": { "language": "python", "source_lines": 60 },
  "overlays": []
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `schema` | 否 | 固定 `codeviz/v1`；缺省按 v1 处理 |
| `project.name` | 否 | 站点标题；缺省取目录名 |
| `project.description` | 否 | 首页副标题 |
| `project.hide_root` | 否 | 为 `true` 时产物里的 `project.root` 留空（等价 CLI `--no-root`），避免分享时泄漏本机路径 |
| `index.database` | 否 | CodeGraph 库路径，相对项目根，默认 `.codegraph/codegraph.db` |
| `groups` | 否 | 分组元数据：`label`（中文名）、`color`（`#RRGGBB`） |
| `defaults.id` / `defaults.group` / `defaults.label` / `defaults.desc` | 否 | 未命中任何 `modules` 规则时的兜底，默认 `{dir}` / `other` |
| `modules[]` | 否 | 模块映射规则，按顺序匹配，**第一条命中生效** |
| `modules[].glob` | 是 | 相对项目根的 glob，如 `server/services/*.py`、`mobile/**/*` |
| `modules[].id` | 否 | 模块 id 模板，同模块的文件会聚合为一个节点 |
| `modules[].label` | 否 | 模块显示名模板 |
| `modules[].group` | 否 | 所属分组，对应 `groups` 的 key |
| `metrics.language` | 否 | 目前只支持 `python`；其他语言只做结构不做指标 |
| `metrics.source_lines` | 否 | 符号源码片段最大行数，默认 60（同时受 4000 字符上限约束） |
| `metrics.source_chars` | 否 | 源码片段最大字符数，默认 4000 |
| `metrics.include_source` | 否 | 是否附带 `source`，默认 `true`；代码敏感或产物过大时设为 `false` |
| `exclude` | 否 | **额外**排除的 glob 列表，会与默认的 `.codeviz/**` 合并；CodeGraph 本身不会索引 `.git/` `.venv/` `node_modules/` 等 |
| `data` | 否 | 直接指定一份 `codeviz/v1` JSON（跳过 CodeGraph 适配器） |
| `overlays[]` | 否 | 覆盖层，见第 5 节 |

> `exclude` / `data` / `source_chars` / `include_source` 是 P0 实现里补充的可选字段，不影响 `CONTRACT.md` 已有语义。

### 模板变量

| 变量 | 含义 | 示例（`server/routers/log_router.py`） |
|---|---|---|
| `{stem}` | 文件名去扩展名 | `log_router` |
| `{name}` | 完整文件名 | `log_router.py` |
| `{dir}` | 父目录（相对根，`/` 分隔） | `server/routers` |
| `{rel}` | 相对路径去扩展名 | `server/routers/log_router` |

路径统一用 `/`；Windows 的 `\` 会被归一化，所以配置可以跨平台复用。

## 4. 数据契约摘要

渲染器只认 `codeviz/v1`。`data.js` 与 `viz-data.json` 的内容一致：

```jsonc
{
  "schema": "codeviz/v1",
  "project": { "name": "...", "root": "...", "description": "...", "generated_at": "..." },
  "index":   { "database": "...", "files": 204, "nodes": 8523, "edges": 28222, "routes": 97 },
  "groups":  { "router": { "label": "路由", "color": "#818cf8" } },
  "modules": [{ "id": "router:log", "label": "日报", "group": "router",
                "fileCount": 1, "symbols": 120, "files": ["..."], "desc": "可选" }],
  "moduleEdges": [{ "source": "router:log", "target": "service:task",
                    "weight": 23, "kinds": { "calls": 20, "imports": 3 } }],
  "files":   [{ "path": "...", "module": "router:log", "group": "router",
                "lines": 1783, "symbols": 45, "branches": 199,
                "excepts": 16, "functions": 45 }],
  "fileEdges": [{ "source": "...", "target": "...", "weight": 12 }],
  "symbols": [{ "id": "function:...", "name": "submit_report", "qualified": "submit_report",
                "file": "...", "line": 595, "end": 924, "kind": "function",
                "module": "router:log", "group": "router", "signature": "(...) -> dict",
                "doc": "...", "lines": 330, "branches": 40, "excepts": 4,
                "source": "def submit_report(...):\n    ..." }],
  "calls":   [{ "source": "function:...", "target": "function:..." }],
  "entries": [{ "label": "POST /api/submit", "id": "function:..." }],
  "overlays": [{ "id": "business", "title": "业务架构", "type": "layers", "layers": [] }]
}
```

约定（前端与适配器都必须遵守）：

- `modules` / `files` / `symbols` / `calls` / `entries` 可以是空数组，视图必须容错。
- `symbols[].source` 可截断：默认 60 行 / 4000 字符；缺失时源码侧栏显示空状态。
- `calls[].source/target` 必须是 `symbols[].id`；`entries[].id` 指向可打开的符号（通常是路由处理函数）。
- `moduleEdges[].kinds` 只用于 tooltip，可缺省。
- `overlays[].type` 只支持 `layers` 与 `image`；`image` 是输出目录内的相对路径。
- 颜色统一 `#RRGGBB`，缺省由前端兜底。

## 5. 输出格式

### `--format site`（默认）

```
.codeviz/
  index.html
  .codeviz-output      # 构建标记：再次构建时据此安全清理 assets/
  assets/
    data.js            # window.CODEVIZ_DATA = { ...codeviz/v1... }
    viz-data.json      # 同一份数据的纯 JSON（--no-data-json 可关闭）
    app.js             # SPA 外壳：tab / hash 路由 / 源码侧栏 / toast
    styles.css         # 浅色主题样式与设计 token
    views/
      common.js        # 共享工具函数、主题 token、视图注册队列
      source.js
      deps.js
      calls.js
      complexity.js
      overlay.js
    assets/            # 覆盖层图片（从项目内拷贝，路径见 overlays[].image）
```

`index.html` 按固定顺序加载脚本（`data.js` → `views/common.js` → 各视图 → `app.js`），全部是相对路径，可直接拷走 / 内网静态托管 / `file://` 打开。

构建会先清空 `<out>/assets/` 再写入。为防止误删，只有当该目录为空、带有 `.codeviz-output` 标记、或其中的 `data.js` 是 codeviz 产物时才会清理；`--out` 不允许等于项目根目录，也不能是项目根的上级目录。

### 主题与样式

界面固定为浅色护眼主题：暖白背景（`#f7f8f4`）、低饱和分组色、柔和阴影、正文不小于 12px。设计 token 定义在 `styles.css` 的 `:root`，并同步到 `views/common.js` 的 `CVTheme`（Canvas 绘制使用后者）；改主题时两处一起改。窄屏（≤900px）下面板变为底部抽屉，工具栏自动换行，图表支持点按/滚轮/双指缩放。

### `--format single-file`

把 CSS、JS、数据和覆盖层图片全部内联进一个 HTML（默认 `index.html`），适合 IM / 邮件分发。

### 覆盖层

```jsonc
"overlays": [
  { "id": "business", "title": "业务架构", "type": "layers", "subtitle": "角色 → 流程",
    "layers": [
      { "title": "服务角色", "columns": 5,
        "items": [{ "title": "员工", "desc": "填报 / 撤回 / 历史" }] }
    ] },
  { "id": "technical", "title": "技术架构", "type": "image", "image": "assets/technical.png" }
]
```

> `image` 路径相对目标项目根；构建时拷贝到 `<out>/assets/`。`layers` 适合从结构化配置生成，`image` 适合展示已有的架构图 / 拓扑图。

## 6. 当前 P0 范围

已包含：

- 标准化内核：配置化模块映射、CodeGraph SQLite 适配、通用 JSON 适配、Python 指标、site / single-file 输出。
- 统一 SPA（无 iframe）：依赖 / 调用 / 复杂度 / 覆盖层四个视图。
- **语义缩放**：依赖视图支持「模块 / 文件」两级，点模块看文件。
- **URL 深链**：`#deps?level=file`、`#calls?root=<symbolId>&depth=2`、`#complexity?file=...`、`#overlay/business`。
- **源码预览**：调用 / 复杂度里点函数，右侧展示源码片段与 `file:line`。
- **覆盖层**：配置化 `layers` 或 `image`。

当前不做：

- 路径查询、循环 / 分层违规检测、风险分、diff、未解析边展示；
- VS Code 插件；
- 非 Python 语言的 AST 指标（结构与调用关系仍可通过 CodeGraph 或通用 JSON 提供）。

## 7. 二次开发：新增一个视图

视图是独立的 ES 脚本，只操作自己的 `container`，不改 `index.html` 结构。视图脚本在 `common.js` 之后、`app.js` 之前加载，因此 `window.CodeViz.registerView` 和 `window.CV` 一定可用。

1. 在 `codeviz/web/views/` 新建 `myview.js`，注册：

   ```js
   window.CodeViz.registerView("myview", function (ctx) {
     // ctx = { container, data, app, source, router }
     const { container, data } = ctx;

     function render(params) {
       container.innerHTML = "";
       // 用 data.modules / data.files / data.symbols 画你的图
       container.append(/* ... */);
     }

     return {
       activate(params) {
         // params 是 URLSearchParams，可读深链参数
         render(params);
       },
       deactivate() {
         container.innerHTML = "";
       },
     };
   });
   ```

2. 在 `codeviz/web/index.html` 里按顺序加 `<script src="assets/views/myview.js"></script>`（放在 `views/common.js` 之后、`app.js` 之前）。
3. 在 `app.js` 的 tab 表里登记 `myview`（名称 / 标题）。
4. 复用 `window.CV` 的 `esc / clamp / rgba / roundRect / ellipsize` 与 `window.CVTheme` 的浅色 token，不要各写一套。
5. 在 `pyproject.toml` 的 `package-data` 里确认 `web/views/*` 会被打进包（已包含）。
6. 加测试：`tests/test_render.py` 断言 `assets/views/myview.js` 存在，并补一个深链用例。

外壳提供的能力：

| API | 作用 |
|---|---|
| `window.CodeViz.data` | 当前 `codeviz/v1` 数据 |
| `window.CodeViz.registerView(name, factory)` | 注册视图 |
| `window.CodeViz.router.go(name, qs)` | 切换视图，如 `router.go("calls", "root=" + id + "&depth=2")` |
| `window.CodeViz.toast(text)` | 轻提示 |
| `window.CodeVizSource.show(symbolId)` | 打开函数源码侧栏 |
| `window.CodeVizSource.showFile(path, line)` | 打开文件源码并定位行 |
| `window.CodeVizSource.hide()` | 关闭侧栏 |

数据侧扩展：优先在适配器里补字段（追加、不破坏既有字段），或在 `tests/fixtures/minimal_data.json` 里加样例后用
`codeviz validate` + `render_site` 快速验证前端。

## 8. 测试

```bash
# 仓库根执行（conftest.py 已把仓库根加入 sys.path，无需 pip install -e）
python -m pytest -q

# 只跑某类用例
python -m pytest tests/test_render.py -q
```

当前 79 个用例，约 1 秒跑完；不需要安装或运行 `codegraph`（测试用 `tests/_codegraph_fixture.py` 现场生成索引库）。
CI（`.github/workflows/tests.yml`）在 Ubuntu 的 Python 3.10 / 3.11 / 3.12 和 Windows 3.12 上执行同一命令，
并额外用 `node --check` 检查所有 `codeviz/web/**/*.js`。

测试分类：

| 文件 | 覆盖 |
|---|---|
| `test_config.py` | JSON / YAML 加载、glob 规则、`{stem}`/`{dir}`/`{rel}` 模板、默认规则与 `defaults.label/desc`、`exclude` 合并、Windows 路径 |
| `test_metrics.py` | 分支数、`except` 数、行数、源码截断、`scan_symbol` |
| `test_model.py` | `codeviz/v1` 结构校验、calls/entries 引用完整性、分组颜色格式 |
| `test_codegraph_adapter.py` | 临时目录最小 `codegraph.db` → modules/files/symbols/calls/entries/moduleEdges |
| `test_generic_adapter.py` | 通用 `codeviz/v1` JSON |
| `test_render.py` | site / single-file 输出、`window.CODEVIZ_DATA`、输出目录防误删、`--no-data-json` / `--no-root`、空数据容错 |
| `test_cli.py` | `codeviz build` / `--format` / 默认输出目录 / `validate` / 新开关 |
| `test_demo_project.py` | 示例项目可运行、配置覆盖全部文件 |

测试用的索引库由 `tests/_codegraph_fixture.py` 用 `sqlite3` 现场生成（字段与真实 CodeGraph 库一致），
不读取仓库里的 `.codegraph/`，因此可以在任何机器上跑。

## 9. 已知限制

- CodeGraph 的 Python 抽取只覆盖常见结构；`getattr` / 动态导入 / FastAPI 依赖注入可能形成未解析边，目前不展示。
- 指标只对磁盘上能读到的 Python 源码生效；文件被删除时对应符号没有 `source`。
- 入口（`entries`）依赖 CodeGraph 的 `route` 节点及其 `references` 边；没有路由概念的项目会得到空 `entries`。
- 分支数按 AST 结构统计（`if` / `for` / `while` / `try` 等），跨实现对比时以同一版本为准。
- 每个符号默认内嵌最多 60 行 / 4000 字符源码，大仓库的 `data.js` 可能达到几十 MB；可用 `metrics.include_source=false` 或 `metrics.source_lines` 控制，并用 `--no-data-json` 避免重复写一份 JSON。
- 前端目前只有 `node --check` 语法检查与人工冒烟，Canvas 交互没有自动化测试。

## 10. 目录结构

```
codeviz/
  AGENTS.md            # 面向 AI / 新贡献者的仓库约定与坑
  CONTRACT.md          # 接口基线
  pyproject.toml
  README.md
  .gitattributes       # 统一 LF，避免 Windows CRLF 抖动
  .editorconfig
  codeviz/
    cli.py             # argparse 入口
    config.py          # 配置加载 / 模块映射
    model.py           # 数据契约辅助与校验
    adapters/
      codegraph.py     # SQLite -> codeviz/v1
      generic.py       # codeviz/v1 JSON 直读
    metrics/
      python_ast.py    # 分支 / except / 行数 / 源码片段
    graph.py           # 模块 / 文件聚合、调用链、entries
    overlays.py        # 覆盖层校验 / 图片拷贝
    render.py          # site / single-file 输出、输出目录保护
    web/               # SPA 外壳与视图
      styles.css       # 浅色主题 token 与全局样式
      views/
        common.js      # CV 工具函数 / CVTheme / 视图注册队列
  tests/               # pytest
    _codegraph_fixture.py  # 现场生成最小 CodeGraph 索引库
  examples/demo/       # 12 文件示例项目 + codeviz.json
```

改动代码或打包 web 资源前，先看 [`AGENTS.md`](./AGENTS.md)：里面记录了数据流、测试夹具、`single-file` 内联与 package-data 等容易踩的坑。
