# demo 项目

一个 12 个文件的迷你任务 / 日报服务，用来验证 codeviz 的模块映射、调用链与复杂度指标。

```bash
cd examples/demo
codegraph init -y                     # 生成 .codegraph/codegraph.db
codeviz build . --config codeviz.json --out .codeviz --open
```

也可以从仓库根运行：

```bash
python -m codeviz.cli build examples/demo --config examples/demo/codeviz.json
```

`codeviz.json` 定义了 `router` / `service` / `app` 三组模块规则，并包含一套 `layers` 覆盖层示例。
