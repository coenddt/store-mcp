# store-mcp

为 common-store 数据层家族（nodejs-store / py-store）按 schema 自动生成 **MCP（Model Context Protocol）** 工具面的第四层皮肤——同一份 JSON schema 事实源之上，REST（[store-api](https://github.com/coenddt/store-api)）、GraphQL（[store-graphql](https://github.com/coenddt/store-graphql)）、gRPC（[store-grpc](https://github.com/coenddt/store-grpc)）之后的第四层。

> 英文索引：[README.md](./README.md)

- Node：`store-mcp-node`（npm）——`@modelcontextprotocol/sdk` 低层 Server + stdio 传输
- Python：`store-mcp-py`（PyPI）——`mcp` SDK 低层 Server + stdio 传输
- 共享：`spec/`（工具生成 / 执行映射 / 错误与上下文的唯一事实源）+ `conformance/`（跨运行时一致性用例，双端加载同一份 JSON 断言）

设计规则：**MCP 只是 GQL 的又一层 AI 客户端皮肤** —— 适配层零语义发明；一切映射到 store 既有的 schema / GQL / RBAC / 档位语义。core 与宿主零改动。

## 快速上手

### Node（`store-mcp-node`）

```js
const { init, store } = require('nodejs-store');
const { createStdioServer } = require('store-mcp-node');

await init(db);
store.register(defn);            // 纯 JSON schema，注册即得

await createStdioServer(store, {
  name: 'my-store-mcp',
  // llm: 'gpt',                  // 可选：提供 ⇒ 注册 ask 工具（自然语言问数）
  // ctx: { userId: 'u1', roles: ['viewer'] },  // ask 的服务端用户上下文（受信参数，不进工具入参）
});
// Claude / TRAE / Cursor 等 MCP 客户端以 stdio 接入：
//   command: node ./server.js
```

### Python（`store-mcp-py`）

```python
from py_store import init, store
from store_mcp import run_stdio

await init({'default': 'mongodb://...'})
store.register(defn)

run_stdio(store, {
    'name': 'my-store-mcp',
    # 'llm': 'gpt',      # 可选 ⇒ 注册 ask 工具
    # 'ctx': {'userId': 'u1', 'roles': ['viewer']},
})
# MCP 客户端 stdio 接入：command: python ./server.py
```

只要工具清单、不跑 server：

```js
const { tools } = require('store-mcp-node').exportTools(store);  // 纯构建，零 SDK 依赖
```

```python
from store_mcp import export_tools
tools = export_tools(store)
```

## 自动生成的机制

1. **生成源唯一**：store 的纯 JSON schema（与 REST / GraphQL / gRPC 皮肤同源）
2. **生成面**：每模型 `get_X` / `list_X` / `create_X` / `update_X` / `delete_X` 五个工具 + 全局 `query`；`x-mcp: { hidden: true }` 整模型隐藏；归档表（`XxxDeleted`）过滤与三姊妹逐字同构
3. **零语义发明**：tool 入参映射到既有 GQL + params（`list_X.q` 与 REST `?q=` 完全同源），经 core 的语法 / 档位 / 权限 / 硬限四道判决，RBAC / 方言路由全量继承 core 链路
4. **`query` 工具强制 text2query 档**：AI 自由读出口只读沙箱（core 硬限 1000 行 / 深度 3 / 禁 route_override）
5. **`ask` 工具（可选）**：仅 `opts.llm` 提供时注册，透传宿主 `ask()` 唯一入口——LLM 翻译 → text2query 档校验执行 → 失败结构化回喂重试；护栏全在宿主，皮肤零新增语义
6. **错误即契约**：core/Host 稳定前缀（`ERR_TEXT2QUERY:` 等）原样透传禁改写；一切失败 `isError: true` + `{code, message}`，不降级、不返回空结果

## v0 范围与明确不支持项

- 支持：stdio 传输；CRUD 五件套 + `query` + 可选 `ask`；`x-mcp.hidden` 注记；归档过滤
- 不支持（v1 收编）：streamable HTTP 传输与 store-gateway 第四开关（依赖 HTTP 传输先行）；MCP resources / prompts 原语；工具级 override / extend 注记
- 双端 smoke 均跑在 mock store + SDK 内存传输上，零真实库、零宿主包依赖；语义一致性以 `spec/` 为准，`conformance/cases.json` 双端加载同一份断言

## 开发

```bash
node: cd node && npm i && npm test          # 24 用例（16 单元 + 8 conformance）
python: cd py && pip install -e ".[dev]" && pytest   # 24 用例（16 单元 + 8 conformance）
```

姊妹仓库：[store-api](https://github.com/coenddt/store-api) / [store-graphql](https://github.com/coenddt/store-graphql) / [store-grpc](https://github.com/coenddt/store-grpc) / [store-gateway](https://github.com/coenddt/store-gateway)
