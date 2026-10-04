# 00 — store-mcp 总览：定位、范围与 server API

为 common-store 数据层家族（nodejs-store / py-store）按 schema 自动生成 **MCP（Model Context Protocol）** 工具面的第四层皮肤——同一份 JSON schema 事实源之上的第四层皮肤（第一层 REST：store-api，第二层 GraphQL：store-graphql，第三层 gRPC：store-grpc）。

- Node：`store-mcp-node`（npm）——`@modelcontextprotocol/sdk` 低层 Server + stdio 传输
- Python：`store-mcp-py`（PyPI）——`mcp` SDK 低层 Server + stdio 传输
- 共享：`spec/`（工具生成 / 执行映射 / 错误与上下文的唯一事实源）+ `conformance/`（跨运行时一致性用例，双端加载同一份 JSON 断言）

设计规则：**MCP 只是 GQL 的又一层 AI 客户端皮肤** —— 适配层零语义发明；一切映射到 store 既有的 schema / GQL / RBAC / 档位语义。core 与宿主零改动。

## v0 范围与明确不支持项

- 支持：stdio 传输；每模型 5 工具（`get_X` / `list_X` / `create_X` / `update_X` / `delete_X`）+ 全局 `query`（text2query 档）+ 可选 `ask`（`opts.llm` 提供时注册）；`x-mcp.hidden` 注记；归档表过滤
- 不支持（v1 收编）：streamable HTTP 传输与 store-gateway 第四开关（依赖 HTTP 传输先行）；MCP resources / prompts 原语；`x-mcp` 注记的更细粒度（工具级 override / extend）

## store 端口契约（与 store-grpc spec/00 同一集合）

皮肤只消费宿主以下公共 API，禁止触达其他内部面：

| 端 | API |
|---|---|
| node（nodejs-store） | `store.list()` / `store.get(name)` / `store.query(q, params, routeOverride)` / `store.queryOne(q, params, routeOverride)` / `store.insert(name, body)` / `store.update(name, locator, set)` / `store.remove(name, locator)` / `store.setContext(ctx)` / **`store.describeForAi(ctx)`** |
| py（py-store） | `schema.list()` / `schema.get(name)` + store 实例同形方法（py 宿主 store 与 schema 模块的分工对齐 store-grpc py 先例）；**`store.describe_for_ai(ctx)`**（`py_store/ask.py` 导出，`py_store/__init__.py` 静态暴露） |

`ask` 工具额外消费宿主 `ask(question, { llm, ctx })` 唯一入口（nodejs-store `src/ask.js` / py-store `py_store/ask.py`）。

## server API

- node：`exportTools(store, opts) -> { tools }`（纯构建，零 SDK 依赖，永远可用）；`createServer(store, opts) -> Promise<{ server, tools }>`（装配全部守卫，不绑传输——测试经 InMemoryTransport 直连，v1 HTTP 复用）；`createStdioServer(store, opts)`（= createServer + StdioServerTransport，stdio 阻塞运行）。
- py：`export_tools(store, opts) -> list`；`create_server(store, opts) -> {server, tools}`（同构装配）；`run_stdio(store, opts)`（create_server + stdio，anyio 阻塞运行）。
- `opts`（双端同形）：`name?`（server 名，缺省 `store-mcp`）、`version?`、`llm?`（注册名或 `async (messages) => str`）、`ctx?`（`ask` 的服务端用户上下文 `{userId, roles}`；**服务端受信上下文**：现同时服务 `ask`（注册前置）与 `describe_schemas`（摘要可见范围）；永不出现在任何工具 inputSchema）、`resources?`（自定义工具来源模型子集）、`contextProvider?`（每调用钩子，见 02）、`text2query?`（query 工具的档位上下文，**形态双端各随宿主**：node 为回调包裹 `fn(async fn) -> Promise`（nodejs-store 导出形态，皮肤 `t2q(run)`）；py 为 sync contextmanager 工厂（`@contextmanager def text2query(): yield`，py_store.schema 导出形态，皮肤 `with t2q(): await run()`）——缺省从宿主 require/import 取，两端皆不可得 ⇒ 装配期抛错带指引）、`hostAsk?` / `host_ask?`（宿主 ask 绑定；缺省从宿主 require/import 构造，测试注入 mock 用）、`schema_module?`（py 专用：元数据 provider，缺省 duck 探测 store.list/get → py_store.schema）。
- 承载依赖缺失（node 缺 `@modelcontextprotocol/sdk` / py 缺 `mcp`）⇒ `createStdioServer` / `run_stdio` 抛错并带安装指引；`exportTools` / `export_tools` 不依赖 SDK。

## 启用守卫（零意外工具，对齐 store-gateway「enabled 缺省 false」）

1. `opts.llm` 缺省 ⇒ 不注册 `ask` 工具（其余照常）。
2. `opts.llm` 提供但 `opts.ctx` 缺失 ⇒ 启动即抛错（fail-secure；宿主 `ask()` 对空 ctx 本就入口先拒，皮肤提前到装配期）。
3. `opts.ctx` / `opts.llm` 永不出现在任何工具的 inputSchema 中——ctx 属受信参数（D5），LLM/客户端零可触。

## schema 事实源与生成面

唯一生成源 = store 已注册的纯 JSON schema。工具面、投影、idField、归档过滤、注记规则见 [01-tools-generation.md](01-tools-generation.md)；工具 → store 调用映射见 [02-execution-mapping.md](02-execution-mapping.md)；错误与上下文见 [03-errors-context.md](03-errors-context.md)。
