# codeviz 实现契约（v1）

本文件是并行开发的接口基线。实现方不要修改本文件的语义；如需扩展字段，先追加、不破坏既有字段。

## 1. 目标

把「CodeGraph 索引 → 架构 / 调用 / 复杂度 / 覆盖层」做成可复用 CLI：

```bash
codeviz build <project> --out .codeviz --format site|single-file
```

- 输入：任意 CodeGraph 已索引项目（`.codegraph/codegraph.db`），或一份 `codeviz/v1` JSON。
- 输出：可离线打开的静态站点，默认 `<project>/.codeviz/index.html`。
- 本轮语言指标：Python（AST）；其他语言可走通用 JSON 适配器。
- 不改目标项目运行时代码。

## 2. 数据契约 `codeviz/v1`

`data.js` / `viz-data.json` 顶层：

```jsonc
{
  "schema": "codeviz/v1",
  "project": {
    "name": "example",
    "root": "/path/to/project",
    "description": "可选",
    "generated_at": "2026-11-18T12:00:00+08:00"
  },
  "index": {
    "database": ".codegraph/codegraph.db",
    "files": 204,
    "nodes": 8523,
    "edges": 28222,
    "routes": 97
  },
  "groups": {
    "router": { "label": "路由", "color": "#818cf8" }
  },
  "modules": [
    {
      "id": "router:log",
      "label": "日报/日志",
      "group": "router",
      "fileCount": 1,
      "symbols": 120,
      "files": ["server/routers/log_router.py"],
      "desc": "可选"
    }
  ],
  "moduleEdges": [
    {
      "source": "router:log",
      "target": "service:task_scope_service",
      "weight": 23,
      "kinds": { "calls": 20, "imports": 3 }
    }
  ],
  "files": [
    {
      "path": "server/routers/log_router.py",
      "module": "router:log",
      "group": "router",
      "lines": 1783,
      "symbols": 45,
      "branches": 199,
      "excepts": 16,
      "functions": 45
    }
  ],
  "fileEdges": [
    {
      "source": "server/routers/log_router.py",
      "target": "server/services/task_scope_service.py",
      "weight": 12
    }
  ],
  "symbols": [
    {
      "id": "function:4a901e14e122dea4b3f91ca077212b06",
      "name": "submit_report",
      "qualified": "submit_report",
      "file": "server/routers/log_router.py",
      "line": 595,
      "end": 924,
      "kind": "function",
      "module": "router:log",
      "group": "router",
      "signature": "(tasks, current_user) -> dict",
      "doc": "提交日报……",
      "lines": 330,
      "branches": 40,
      "excepts": 4,
      "source": "def submit_report(...):\n    ..."
    }
  ],
  "calls": [
    { "source": "function:...", "target": "function:..." }
  ],
  "entries": [
    { "label": "POST /api/submit", "id": "function:..." }
  ],
  "overlays": [
    {
      "id": "business",
      "title": "业务架构",
      "type": "layers",
      "subtitle": "可选",
      "layers": [
        {
          "title": "服务角色",
          "columns": 5,
          "items": [
            { "title": "员工", "desc": "填报 / 撤回 / 历史" }
          ]
        }
      ]
    },
    {
      "id": "technical",
      "title": "技术架构",
      "type": "image",
      "image": "assets/technical.png"
    }
  ]
}
```

约定：

- `modules` / `files` / `symbols` / `calls` / `entries` 均可为空数组，前端必须容错。
- `symbols[].source` 可截断（默认 60 行 / 4000 字符），缺失时不显示源码。
- `moduleEdges[].kinds` 仅用于 tooltip，前端可忽略。
- `overlays[].type` 只支持 `layers` 与 `image`。
- `overlays[].image` 是输出目录内的相对路径（渲染器负责拷贝）。
- 颜色统一 `#RRGGBB`；缺省颜色由前端提供。

## 3. 配置 `codeviz.json` / `codeviz.yml`

配置文件放在目标项目根目录，默认自动查找 `codeviz.json`、`codeviz.yml`、`codeviz.yaml`。

```jsonc
{
  "schema": "codeviz/v1",
  "project": {
    "name": "example",
    "description": "示例项目"
  },
  "index": {
    "database": ".codegraph/codegraph.db"
  },
  "groups": {
    "router": { "label": "路由", "color": "#818cf8" },
    "service": { "label": "业务服务", "color": "#34d399" }
  },
  "defaults": {
    "group": "other",
    "id": "{dir}"
  },
  "modules": [
    {
      "glob": "server/routers/*_router.py",
      "id": "router:{stem}",
      "label": "{stem}",
      "group": "router"
    },
    {
      "glob": "client/views/manager/*.py",
      "id": "page:{stem}",
      "label": "{stem}",
      "group": "client"
    }
  ],
  "metrics": {
    "language": "python",
    "source_lines": 60
  },
  "overlays": []
}
```

模板变量：

- `{stem}`：文件名去掉 `.py` / `.js` 等扩展名
- `{name}`：完整文件名
- `{dir}`：父目录（相对项目根，`/` 分隔）
- `{rel}`：相对路径去掉扩展名

规则按顺序匹配，第一条命中生效；未命中用 `defaults.id` / `defaults.group`。

## 4. Python 包结构

```
codeviz/
  pyproject.toml
  codeviz/
    cli.py            # argparse 入口
    config.py         # 配置加载 / 模块映射
    model.py          # 数据契约构造辅助（可选）
    adapters/
      codegraph.py    # SQLite -> codeviz/v1
      generic.py      # codeviz/v1 JSON 直读
    metrics/
      python_ast.py   # 分支/行数/源码片段
    graph.py          # 模块/文件聚合、调用链、entries
    overlays.py       # 覆盖层校验 / 图片拷贝
    render.py         # site / single-file 输出
    web/
      index.html
      styles.css
      app.js
      views/
        source.js
        deps.js
        calls.js
        complexity.js
        overlay.js
  tests/
  examples/
```

## 5. Web 视图接口

`index.html` 按固定顺序加载：

```
assets/data.js
assets/views/source.js
assets/views/deps.js
assets/views/calls.js
assets/views/complexity.js
assets/views/overlay.js
assets/app.js
```

每个视图通过全局注册：

```js
window.CodeViz.registerView("deps", function (ctx) {
  // ctx = { container, data, app, source, router }
  return {
    activate(params) {},   // params: URLSearchParams
    deactivate() {}
  };
});
```

外壳提供：

```js
window.CodeViz.data                 // codeviz/v1 数据
window.CodeViz.router.go(name, qs)  // 切换视图，qs 形如 "root=xxx&depth=2"
window.CodeViz.toast(text)          // 轻提示
window.CodeVizSource.show(symbolId) // 打开源码侧栏
window.CodeVizSource.showFile(path, line)
window.CodeVizSource.hide()
```

`app.js` 负责：

- 顶部 tab（依赖 / 调用 / 复杂度 / 覆盖层）
- hash 路由：`#deps`、`#deps?level=file`、`#calls?root=...&depth=2`、`#complexity?file=...`、`#overlay/business`
- 视图懒加载（首次激活时调用工厂）
- 源码侧栏、toast、空状态

视图不得修改 `index.html` 的全局结构；只操作自己的 `container`。

## 6. 本轮范围（只做这些）

- 标准化内核：配置化模块映射、CodeGraph 适配、通用 JSON 适配、Python 指标、site/single-file 输出。
- 统一 SPA：去掉 iframe；依赖 / 调用 / 复杂度 / 覆盖层四个视图。
- P0：
  - 语义缩放：依赖视图支持「模块 / 文件」两级；点击模块可查看其文件。
  - URL 状态：视图、根函数、深度、文件、覆盖层可深链。
  - 源码预览：调用/复杂度点开函数显示源码片段与 file:line。
  - 覆盖层：配置化 `layers` 或 `image`。
- 不做：路径查询、循环/分层违规、风险分、diff、未解析边、VS Code 插件、非 Python 指标。

## 7. 文件归属（并行开发）

| 负责人 | 文件 |
|---|---|
| Lead | `CONTRACT.md`、`web/index.html`、`web/styles.css`、`web/app.js`、`web/views/source.js`、集成与测试 |
| A | `codeviz/*.py`（除 web）、`pyproject.toml` |
| B | `codeviz/web/views/deps.js` |
| C | `codeviz/web/views/calls.js`、`complexity.js`、`overlay.js` |
| D | `codeviz/tests/**`、`codeviz/examples/**`、`codeviz/README.md` |

不要跨文件改动；需要新增文件先在本文件登记。不要执行 `git add/commit`。
