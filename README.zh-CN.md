# store-mcp

> **MCP 是 GQL 之上的一层 AI 客户端皮。** `store-mcp` 按你已有的 common-store schema 自动生成 **Model Context Protocol** 工具面——同一份 JSON schema 事实源之上的第四层皮肤，前有 REST（[store-api](https://github.com/coenddt/store-api)）、GraphQL（[store-graphql](https://github.com/coenddt/store-graphql)）、gRPC（[store-grpc](https://github.com/coenddt/store-grpc)）。适配层**零语义发明**：每个工具都直接映射到 store 既有的 schema / GQL / RBAC / 档位语义，**core 与宿主零改动**。

> 英文索引：[README.md](./README.md)

## 运行时矩阵

| 运行时 | 包 | 分发 | SDK / 传输 | 要求 |
|---|---|---|---|---|
| Node | `store-mcp-node` | npm | `@modelcontextprotocol/sdk` 低层 `Server` + **stdio** 与 **streamable HTTP** 传输 | Node **>= 18** |
| Python | `store-mcp-py` | PyPI | `mcp` SDK 低层 `Server` + **stdio** 与 **streamable HTTP** 传输 | Python **>= 3.10**，`mcp>=2.2,<3` |

两个运行时共享同一份事实源：

- `spec/`——工具生成（`01`）、执行映射（`02`）、错误与上下文（`03`）的**唯一事实源**。
- `conformance/`——`cases.json`，**唯一一份**跨运行时断言文件；双端各自加载并逐字断言同一份 JSON。

## 目录

1. [它是什么](#它是什么)
2. [自动生成的机制](#自动生成的机制)
3. [何时使用 / 何时不要使用](#何时使用--何时不要使用)
4. [安装](#安装)
5. [快速上手](#快速上手)
   - [Node](#node-store-mcp-node)
   - [Python](#python-store-mcp-py)
   - [现成 stdio 示例，逐步骤说明](#现成-stdio-示例逐步骤说明)
6. [工具清单与入参](#工具清单与入参)
7. [`exportTools` / `export_tools`——只取工具定义，零 SDK 依赖](#exporttools--export_tools只取工具定义零-sdk-依赖)
8. [`ask` 工具——自然语言问数](#ask-工具自然语言问数)
9. [错误与上下文](#错误与上下文)
10. [场景事例](#场景事例)
11. [v0 范围与明确不支持项](#v0-范围与明确不支持项)
12. [FAQ](#faq)
13. [开发](#开发)
14. [相关项目](#相关项目)
15. [许可证](#许可证)

## 它是什么

`store-mcp` 是一层轻薄的 **MCP 适配器**。它读取你已经注册到 common-store 宿主（`nodejs-store` 或 `py-store`）的纯 JSON schema，并把它作为一组 **工具**，经 **stdio 或 streamable HTTP** 暴露给 AI 客户端（Claude Desktop、TRAE、Cursor，或任何支持 MCP 的 Agent 运行时）。

它的定海准绳是**零语义发明**：

- **生成源唯一。** store 已注册的 JSON schema——与 REST / GraphQL / gRPC 皮肤同源。`store-mcp` 不向其中追加任何东西。
- **生成面。** 每模型：`get_X` / `list_X` / `create_X` / `update_X` / `delete_X`。全局：`query` 与 `describe_schemas`。可选：`ask`。
- **线上零新增语义。** tool 入参映射到既有 GQL + params。`list_X.q` 与 REST `?q=` **完全同源**。每次调用都经 core 的四道判决——**语法 / 档位 / 权限 / 硬限**——RBAC 与方言路由全量继承。
- **`query` 跑在只读沙箱里。** AI 的自由读出口被强制进入宿主的 **text2query 档**（core 硬限：**1000 行 / 深度 3 / 禁 `route_override`**）。
- **`ask` 可选。** 仅在提供 `opts.llm` 时注册；透传宿主唯一入口 `ask()`。
- **错误即契约。** 一切失败返回 `isError: true` + 稳定的 `{code, message}` 对象——不降级、不返回空结果。core 稳定前缀（`ERR_TEXT2QUERY:` 等）原样透传。

core 与宿主均不被修改：适配器只**消费**宿主的公共 API（见下方[端口契约](#store-端口契约)）。

## 自动生成的机制

1. **生成源唯一。** store 的纯 JSON schema（与 REST / GraphQL / gRPC 皮肤同源）。
2. **生成面。** 每模型 `get_X` / `list_X` / `create_X` / `update_X` / `delete_X`，加两个全局工具——`query` 与 `describe_schemas`（权限过滤后的紧凑 JSON，列出可用模型及其字段 / 关系 / 计算列，透传宿主 `describe_for_ai`）。`x-mcp: { hidden: true }` 整模型隐藏；归档表（`XxxDeleted`）过滤与三姊妹皮肤逐字同构。
3. **零语义发明。** tool 入参映射到既有 GQL + params（`list_X.q` 与 REST `?q=` 完全同源），经 core 的语法 / 档位 / 权限 / 硬限四道判决，RBAC / 方言路由全量继承 core 链路。
4. **`query` 强制 text2query 档。** AI 自由读出口运行在只读沙箱内（core 硬限 1000 行 / 深度 3 / 禁 `route_override`）。
5. **`ask`（可选）。** 仅 `opts.llm` 提供时注册；透传宿主 `ask()` 唯一入口——LLM 翻译 → text2query 档校验执行 → 失败结构化回喂重试。护栏全在宿主，皮肤零新增语义。
6. **错误即契约。** core / 宿主稳定前缀（`ERR_TEXT2QUERY:` 等）原样透传禁改写；一切失败 `isError: true` + `{code, message}`，不降级、不返回空结果。

### store 端口契约

皮肤只消费宿主以下公共 API（与 store-grpc `spec/00` 同一集合）：

| 运行时 | 消费的宿主 API |
|---|---|
| Node（`nodejs-store`） | `store.list()` / `store.get(name)` / `store.query(q, params, routeOverride)` / `store.queryOne(q, params, routeOverride)` / `store.insert(name, body)` / `store.update(name, locator, set)` / `store.remove(name, locator)` / `store.setContext(ctx)` / `store.describeForAi(ctx)` |
| Python（`py-store`） | `schema.list()` / `schema.get(name)` + store 实例同形方法；`store.describe_for_ai(ctx)` |

`ask` 工具额外消费宿主 `ask(question, { llm, ctx })` 唯一入口。

### `opts`（双端同形）

| 选项 | 含义 |
|---|---|
| `name?` | server 名，缺省 `store-mcp`。 |
| `version?` | server 版本（Node）。 |
| `llm?` | 注册名或 `async (messages) => str`。**提供 ⇒ 注册 `ask`。** |
| `ctx?` | 服务端受信用户上下文 `{userId, roles}`。同时服务 `ask`（注册前置）与 `describe_schemas`（摘要可见范围）。**永不出现在任何工具 inputSchema。** |
| `resources?` | 显式指定从哪些模型建工具（绕过归档过滤 / `list()`）。 |
| `contextProvider?`（Node）/ `context_provider?`（Py） | 每调用钩子；返回值经 `setContext` 注入。见[错误与上下文](#错误与上下文)。 |
| `ctxFromRequest?`（Node）/ `ctx_from_request?`（Py） | 仅 HTTP：`async (req) => ctx`（Node，原生 `http.IncomingMessage`）/ `async (request) => ctx`（Py，`starlette.Request`）。每请求解析受信上下文，结果到达工具 handler 的方式与 `opts.ctx` 完全等价。与 `ctx` 互斥——同给则装配期抛错。 |
| `port?` / `host?` / `endpoint?` | 仅 HTTP：监听端口（缺省 `8635`）、绑定地址（缺省 `127.0.0.1`）、MCP 路径（缺省 `/mcp`）。 |
| `text2query?` | `query` 工具的档位上下文。node：`fn(async fn) -> Promise`；py：sync `@contextmanager` 工厂。缺省从宿主取；两端皆不可得 ⇒ **装配期抛错**带指引。 |
| `hostAsk?` / `host_ask?` | 宿主 `ask` 绑定；缺省从宿主构造，测试可注入覆盖。 |
| `schema_module?` | py 专用：元数据 provider；缺省 duck 探测 `store.list/get`，再 `py_store.schema`。 |

## 何时使用 / 何时不要使用

**在这些情况下使用**

- 你已经在跑 common-store 宿主（`nodejs-store` / `py-store`）且已注册 schema，想要一个**零额外代码**、供 AI 客户端用的 MCP 工具面。
- 你想让 AI Agent 对业务数据做**只读问数**（经 `query` / `ask`），且带与其它客户端相同的 RBAC 与档位护栏。
- 你想把模型作为 **CRUD 工具**暴露给 Agent（经生成的五件套），继承全部护栏。
- 你想让**同一份 schema** 同时供 REST、GraphQL、gRPC *与* MCP，无需重复声明。

**在这些情况下不要使用**

- 你需要 MCP 的 **resources** 或 **prompts** 原语（v0 只暴露 tools）。
- 你需要**工具级** override / extend 注记（v0 只支持模型级 `x-mcp.hidden`）。
- 你想要一个**并非**来自你已注册 schema 的完全自定义工具面。皮肤永远从 schema 生成；其它一律超出范围。

## 安装

### Node

```bash
npm install store-mcp-node
# 宿主为 peer，也请装上
npm install nodejs-store
```

MCP 承载依赖（`@modelcontextprotocol/sdk`）是直接依赖；宿主（`nodejs-store`）是**可选 peer 依赖**——不装它 `exportTools` 仍可用。

### Python

```bash
pip install store-mcp-py
# 宿主为 peer，也请装上
pip install py-store
```

承载依赖（`mcp>=2.2,<3`）是直接依赖；缺省 `text2query` 档位与元数据需要 `py-store`，但不装它 `export_tools` 仍可用。

### 接入 MCP 客户端（Claude / TRAE / Cursor）

MCP 客户端通过一小段 JSON 启动 stdio 服务。把 `command` 指向你的入口脚本，用 `env` 传配置：

```json
{
  "mcpServers": {
    "store-mcp": {
      "command": "node",
      "args": ["/abs/path/to/store-mcp/node/example/dsh-stdio-server.js"],
      "env": {
        "STORE_LOCAL_DIR": "/abs/path/to/store-data",
        "STORE_SCHEMA": "/abs/path/to/schema.json",
        "STORE_USER": "ai-reader",
        "STORE_ROLES": "viewer,analyst"
      }
    }
  }
}
```

Python 入口只需换命令：

```json
{
  "mcpServers": {
    "store-mcp": {
      "command": "python",
      "args": ["/abs/path/to/server.py"]
    }
  }
}
```

`args` 可引用 `node` / `python` / `npx` / `uvx`；客户端 spawn 进程并通过其 stdin/stdout 讲 MCP。

## 快速上手

### Node（`store-mcp-node`）

```js
const { init, store, schema } = require('nodejs-store');
const { createStdioServer } = require('store-mcp-node');

async function main() {
  await init(db);                 // 你的数据源
  store.register(defn);           // 纯 JSON schema，注册即得

  // text2query 档位 + 受信上下文（客户端永不可见）
  store.setContext({ userId: 'u1', roles: ['viewer'] });

  await createStdioServer(store, {
    name: 'my-store-mcp',
    ctx: { userId: 'u1', roles: ['viewer'] },
    // llm: 'gpt',                 // 可选：提供 ⇒ 注册 ask 工具
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
// Claude / TRAE / Cursor 以 stdio 接入：command: node ./server.js
```

### Python（`store-mcp-py`）

```python
import anyio
from py_store import init, store
from store_mcp import run_stdio

async def bootstrap():
    await init({'default': 'mongodb://...'})
    store.register(defn)                                # 纯 JSON schema
    await store.set_context({'userId': 'u1', 'roles': ['viewer']})

anyio.run(bootstrap)   # 一次性异步装配

# run_stdio 是阻塞的 stdio 循环——在顶层调用（不要放进已运行的事件循环里）
run_stdio(store, {
    'name': 'my-store-mcp',
    'ctx': {'userId': 'u1', 'roles': ['viewer']},
    # 'llm': 'gpt',            # 可选 ⇒ 注册 ask
})
# MCP 客户端 stdio 接入：command: python ./server.py
```

### 现成 stdio 示例，逐步骤说明

[`node/example/dsh-stdio-server.js`](./node/example/dsh-stdio-server.js) 是一个**可直接复制运行**的 stdio 入口，可被 harness（如 dsh——DeepSeek Harness）直接 spawn。它演示了标准的四步装配：

1. **init 数据源。** 若设置了 `STORE_LOCAL_DIR`，使用 `nodejs-store` 本地磁盘后端（免 Mongo）；否则用 `MONGO_URI` 连接 MongoDB。
2. **注册 schema。** 读取 JSON schema 文件（`STORE_SCHEMA`），逐个 `schema.register(defn)`。
3. **`setContext`。** 构造服务端受信上下文 `{ userId, roles }` 并调用 `store.setContext(ctx)`——text2query 档强制要求上下文。
4. **`createStdioServer`。** 调用 `createStdioServer(store, { ctx })` 并阻塞在 stdio 上。它**不**传 `llm`，故不注册 `ask`（数一个模型足矣；避免「双模型翻译」）。

示例支持的环境变量：

| 变量 | 默认值 | 用途 |
|---|---|---|
| `STORE_LOCAL_DIR` | *（未设）* | 设置后使用 `nodejs-store` 本地磁盘后端（跳过 Mongo）。 |
| `MONGO_URI` | `mongodb://127.0.0.1:27017/dsh_store` | Mongo 连接串（仅在 `STORE_LOCAL_DIR` 未设时使用）。 |
| `STORE_SCHEMA` | 仓库内示例 schema 路径 | 要注册的 JSON schema 文件路径。 |
| `STORE_USER` | `dsh-user` | 受信上下文里的 `userId`。 |
| `STORE_ROLES` | `admin` | 受信上下文里的 `roles`（逗号分隔）。 |

生产接入：把 ①~③ 换成你自己的应用引导（你的 schema 来源、你的上下文来源）；**第 ④ 步不变**。

### streamable HTTP 入口

双端暴露同一个 store、同一套生成面、同一套守卫——只有承载方式变化。endpoint 缺省 `/mcp`，服务绑定 `127.0.0.1:8635`。

Node：

```js
const { init, store } = require('nodejs-store');
const { createHttpServer } = require('store-mcp-node');

await init(db);
store.register(defn);

const httpServer = await createHttpServer(store, {
  port: 8635,
  host: '127.0.0.1',
  endpoint: '/mcp',
  // 静态受信上下文 …
  ctx: { userId: 'u1', roles: ['viewer'] },
  // … 或改为每请求解析（与 `ctx` 互斥）：
  // ctxFromRequest: async (req) => ({ userId: req.headers['x-user-id'], roles: ['viewer'] }),
});
// MCP 客户端：POST http://127.0.0.1:8635/mcp
// await httpServer.close();   // 停止监听并关闭活动 MCP 传输
```

Python：

```python
import anyio
from py_store import init, store
from store_mcp import run_http

async def bootstrap():
    await init({'default': 'mongodb://...'})
    store.register(defn)

anyio.run(bootstrap)

run_http(store, {                      # 阻塞运行直到取消
    'port': 8635,
    'host': '127.0.0.1',
    'endpoint': '/mcp',
    'ctx': {'userId': 'u1', 'roles': ['viewer']},
    # 'ctx_from_request': lambda request: {'userId': request.headers.get('x-user-id'), 'roles': ['viewer']},
})
```

- **Node 侧不引入 Web 框架。** `createHttpServer` 只用 `node:http` + SDK 的 `StreamableHTTPServerTransport`；除 `@modelcontextprotocol/sdk` 外无需安装任何东西。
- **每请求身份。** `ctxFromRequest` / `ctx_from_request` 在请求交给 MCP 传输之前执行，解析出的上下文就是 `ask` 与 `describe_schemas` 看到的上下文。静态 `ctx` 与该钩子不可同给——装配期抛错，不静默择一。
- **端口冲突显式失败。** 绑定已占用端口原样抛原生 `EADDRINUSE`；服务绝不静默换端口。
- **传输生命周期随 SDK 而异，语义不变。** Node SDK 禁止无状态 transport 跨请求复用，故 `createHttpServer` 每请求新建 transport + server；Python SDK 把 initialize 状态挂在连接上，故 `run_http` 复用单 transport + server 并逐请求切换上下文。两端暴露完全相同的工具面。
- **会话交给 SDK。** GET/DELETE 透传给 SDK；适配层不新增会话管理、不内置鉴权（需要时在反向代理或 `ctxFromRequest` 里做）。

## 工具清单与入参

对每个模型 `X`，生成五件套；另有两个恒在的全局工具（`query` 与 `describe_schemas`），外加一个可选的全局 `ask`。

| 工具 | inputSchema | 说明 |
|---|---|---|
| `get_X` | `{ id: string }` *（required）* | 按模型 `idField` 精确查单条。 |
| `list_X` | `{ q?: string, params?: object }` | `q` 为自模型名始的 GQL 余部——**与 REST `?q=`、gRPC `q` 完全同源**。`params` 为 GQL 参数对象（MCP 原生 object；proto 的 `_json` 字符串编码系类型系统所限，MCP 不需要）。 |
| `create_X` | `{ body: object }` *（required）* | 插入文档。 |
| `update_X` | `{ id: string, set: object }` *（均 required）* | 按 `idField` 定位后部分更新。 |
| `delete_X` | `{ id: string }` *（required）* | 按 `idField` 定位删除。 |
| `query` *（全局）* | `{ gql: string, params?: object }`（`gql` required） | AI 自由读出口；**强制 text2query 档**。 |
| `describe_schemas` *（全局）* | `{}` | 列出可用模型及其字段/关系/计算列（权限过滤后的紧凑 JSON，透传宿主 `describe_for_ai`）。`ctx` 由部署侧经 `opts.ctx` 提供（受信参数，不进 inputSchema）；无 `ctx` 时宿主返回其降级摘要（仅模型名 + 字段名，防探针）。翻译 GQL 前应**优先**调用本工具。 |
| `ask` *（仅当 `opts.llm` 提供时）* | `{ question: string }` *（required）* | 透传宿主 `ask(question, { llm, ctx: opts.ctx })`。 |

**命名。** 工具名直接取模型原名（`get_User`），**无大小写改写**——故无 service 名冲突问题（对比 gRPC 的 Pascal service 名冲突检测；MCP 不需要）。

**描述。** 模型工具的 `description` 取 defn 的 `description` 键（JSON-Schema 惯例，与 GraphQL description 管道同源）；无则给一句生成说明（如 `List User documents (GQL q suffix + params)`）。

**`idField`。** 取 `store.get(name)` 返回的 defn 中的 `idField`；缺省 `'_id'`。定位值原样透传——服务端不做类型改写。

**投影（`proj`）。** `list_X.q` 缺省时服务端拼 `模型名 + proj`；`get_X` 恒用 `proj`。`proj` 为 ` { field1, field2, ... }`，取 `fields` **加** `computes`（两者均视为字段，与 store-graphql 对齐）。`q` 存在时，投影完全由 `q` 决定——适配层不追加。

**归档过滤。** 与 store-api / store-graphql / store-grpc 逐字同构：模型名以 `Deleted` 结尾**且**存在去掉该后缀的同名模型时才过滤（防御用户恰好有名为 `XxxDeleted` 的独立模型）。

```js
const ARCHIVE_SUFFIX = 'Deleted';
function filterArchived(names) {
  const set = new Set(names);
  return names.filter((n) => !(n.endsWith(ARCHIVE_SUFFIX) && set.has(n.slice(0, -ARCHIVE_SUFFIX.length))));
}
```

### 入参解析规则

| 字段 | 规则 | 违例 |
|---|---|---|
| `params` | 缺省 ⇒ `undefined`（不传）；提供则必须是 JSON 对象。 | ⇒ `invalidParam` |
| `body` | 必须是 JSON **对象**（数组 / 标量 / 缺失拒绝）。 | ⇒ `invalidBody` |
| `set` | 同 `body`。 | ⇒ `invalidBody` |
| `q` | 缺省/空串 ⇒ 服务端拼 `name + proj`；非空 ⇒ 拼接 `name + q`。 | core 抛 `ERR_GQL_PARSE:` ⇒ 判定链 |
| `gql` | 必须为非空字符串：自模型名始的完整 GQL 查询串。 | 缺失/空 ⇒ `invalidParam` |
| `id` | 原样透传为定位值。 | — |

MCP `inputSchema` 已在协议层做类型预检（string/object required 由 SDK 校验）；适配层只做两类语义校验——「对象 vs 数组/标量」与「空串」。两层各司其职，越界入参必得显式错误（**禁静默兜底**）。

## `exportTools` / `export_tools`——只取工具定义，零 SDK 依赖

双端各导出一个**纯构建**函数，只返回工具定义、别无其它，**零 SDK 依赖**、永远可用——适合测试、工具清单或在其上自建 server。

```js
const { tools, } = require('store-mcp-node').exportTools(store, opts);
// tools: [{ name, description, inputSchema }, ...]
```

```python
from store_mcp import export_tools
tools = export_tools(store, opts)   # list[dict]
```

- Node：`exportTools(store, opts) -> { tools }`
- Python：`export_tools(store, opts) -> list[dict]`

因为它与 `createServer` 用的是同一个 `buildSurface`，定义清单与运行中 server 所广告的清单**保证一致**。只要工具清单、不要传输、不要 SDK、不要副作用时用它。

server 装配（非传输态、stdio 与 HTTP）均已导出：

- Node：`createServer(store, opts) -> Promise<{ server, tools }>`（装配全部守卫，不绑传输——测试经 `InMemoryTransport` 直连）、`createStdioServer(store, opts)`（= `createServer` + `StdioServerTransport`）、`createHttpServer(store, opts) -> Promise<{ server, transport, endpoint, close() }>`（`node:http` 上的 streamable HTTP；`transport` 为 `{ create }` 工厂，因为 SDK 要求每请求新建无状态 transport）。
- Python：`create_server(store, opts) -> { server, tools }`、`run_stdio(store, opts)`（= `create_server` + stdio，anyio 阻塞运行）、`run_http(store, opts)`（经 SDK 的 ASGI 传输提供 streamable HTTP，由 uvicorn 承载）。

缺承载依赖（Node 缺 `@modelcontextprotocol/sdk`；Python 缺 `mcp`）⇒ 各传输入口抛错并带安装指引；`exportTools` / `export_tools` 永不需要 SDK。

## `ask` 工具——自然语言问数

`ask` 把自然语言问题变成只读数据答案，复用宿主 `ask()` 的全部编排。

- **仅 `opts.llm` 提供时注册。** 缺 `opts.llm` 则不注册 `ask`，其余一切照常。
- **fail-secure 上下文。** 配 `opts.llm` 却缺 `opts.ctx` ⇒ **装配期立即抛错**——早于宿主 `ask()` 自身的入口检查。
- **ctx 受信且不可见。** `ctx` / `llm` 永不出现在任何工具 inputSchema。客户端 / LLM 既不能读也不能注入它们（受信参数铁律）。
- **翻译 → 校验 → 执行 → 重试。** 宿主执行：LLM 把问题翻译成 GQL → **text2query 档校验与执行**（只读沙箱：1000 行 / 深度 3 / 禁 `route_override`）→ 失败则**结构化错误回喂重试**循环。
- **结果全量返回。** 成功时工具返回 `{ data, attempts, events }`——其中 `attempts` 为执行轨迹、`events` 为反馈事件，客户端可自证查询过程。
- **护栏全在宿主。** 档位、只读、回喂重试、硬限全在宿主 `ask()` 与 core。皮肤**不新增**任何护栏，尤其**不新增**「失败重试」或「空结果兜底」逻辑（`no-error-masking`）。

handler 只做三件事：取 `question` 字符串 → 调宿主 `ask(question, { llm, ctx })` → 映射结果。

## 错误与上下文

一切工具失败都以 MCP `isError: true` 显式返回。禁静默失守、禁空结果兜底、禁降级重试。（「查无」是确定性结果，不是崩溃——见判定链。）

### 错误判定链（顺序固定，命中即止）

| 序 | 条件 | 码 | `message` |
|---|---|---|---|
| 1 | 宿主反馈事件 `profile_blocked` | `profileBlocked` | 事件 message 原样 |
| 2 | 宿主 `PermissionError` | `permissionDenied` | `str(e)` 原样 |
| 3 | 宿主 `NoContextError`（需上下文而缺失；core machine code `no_context`） | `noContext` | `str(e)` 原样 |
| 4 | 宿主 `ProfileViolation` | `profileBlocked` | `str(e)` 原样 |
| 5 | 入参语义违例（上方解析规则） | `invalidParam` / `invalidBody` | 指明字段与要求 |
| 6 | `get_X` 返回 `null` | `notFound` | `User <id> not found` |
| 7 | 宿主 `AskExhausted` | `askExhausted` | 异常消息原样（已内嵌最后一轮结构化错误） |
| 8 | 其余一切异常 | `planError` | `str(e)` 原样 |

判定链对齐宿主 `ask` 的 `_error_from_exception` 先例；差异仅在于皮肤多「入参违例」与「notFound」两类协议面错误——它们是 MCP 协议语义，不是 store 语义。

**判定按 name/code，不依赖 `instanceof`**——故跨包边界安全。

### core 稳定前缀：原样透传

core / 宿主稳定前缀（`ERR_GQL_PARSE:`、`ERR_TEXT2QUERY:`、`ERR_LIMIT:` 等）**原样保留在 `message` 内**——禁改写、禁摘要、禁剥前缀。按前缀编程的（上游 Agent）链路依赖它们的稳定性。

### 响应形状

错误：

```json
{
  "isError": true,
  "content": [{ "type": "text", "text": "{\"code\":\"profileBlocked\",\"message\":\"...ERR_TEXT2QUERY:...\"}" }]
}
```

成功：

```json
{ "content": [{ "type": "text", "text": "<JSON.stringify(data)>" }] }
```

- 成功响应**不含任何 error 键**（`no-error-masking` 的正向断言）。
- `get_X` 查无既不是成功也不是崩溃：它是 `notFound` `isError`（与 gRPC `NOT_FOUND` 同语义位）。
- `ask` 成功的 text 为三键 JSON `{data, attempts, events}`。

### 上下文（`ctx`）与 `contextProvider`

- `opts.ctx` 服务 `ask`（及 `describe_schemas` 可见范围）。它经宿主的作用域上下文进入执行面；皮肤既不持久化也不改写它。
- `opts.contextProvider`（Node）/ `opts.context_provider`（Py）是每调用钩子。返回值经 `setContext` 注入；返回 `null`/`undefined` 时**显式**调用 `setContext(null)`（清除语义必须落地，防身份跨请求残留）。钩子抛错则进入判定链（`PermissionError` ⇒ `permissionDenied`；其余 ⇒ `unauthenticated`，message 原样）。
- v0 stdio 单用户场景常无 per-request 身份：不配 `contextProvider` 时皮肤不触碰 `setContext`（进程级上下文由部署方在装配前自行设置）。
- **HTTP 传输**以 `ctxFromRequest` / `ctx_from_request` 取代静态 `ctx`：钩子逐请求解析受信上下文，结果到达工具 handler 的方式与 `opts.ctx` 完全等价。两者互斥——同给则装配期抛错。
- **`query` 不会被注入 `opts.ctx`。** `query` 工具沿用「当前进程上下文」语义——core 档位门禁无 ctx 即拒（fail-secure）；皮肤不注入也不伪造上下文。要让 `query` 可用，经 `opts.contextProvider` 或宿主 `setContext` 自行供 ctx。

## 场景事例

每个场景遵循 **业务背景 → 配置/调用 → 结果 → 优势所在**。

### 1. 让 Claude / TRAE / Cursor 只读直连业务库问数

**业务背景。** 分析团队的数据在 common-store 宿主后的 MongoDB 里。分析师想让 Claude 回答「上个月有多少订单」，但不想给模型写权限，也不想给裸库连接。

**配置/调用。** 让 MCP 客户端指向 stdio 示例，使用**只读角色**：

```json
{
  "mcpServers": {
    "store-mcp": {
      "command": "node",
      "args": ["/abs/path/to/store-mcp/node/example/dsh-stdio-server.js"],
      "env": {
        "MONGO_URI": "mongodb://127.0.0.1:27017/prod",
        "STORE_SCHEMA": "/abs/path/to/prod-schema.json",
        "STORE_USER": "claude-reader",
        "STORE_ROLES": "viewer"
      }
    }
  }
}
```

随后模型调用 `query` 工具：

```json
{ "name": "query", "arguments": { "gql": "Order -> { total }", "params": {} } }
```

**结果。** 模型收到 JSON 数组（或结构化 `isError` + `{code, message}`）。该调用运行在宿主的 **text2query** 档内——只读、1000 行上限、深度 3、禁 `route_override`——并使用 `STORE_ROLES` 中的角色。

**优势所在。** 你得到了 AI 问数，*却*没有新增数据通路：保护 REST/gRPC 的同一套 RBAC 与档位护栏同样保护 MCP。皮肤从不放宽访问——沙箱是宿主的，逐字继承。

### 2. 把模型作为 CRUD 工具暴露给 Agent

**业务背景。** 一个内部 Agent（客服机器人、运维助手）需要新建和更新记录，而不只是读。

**配置/调用。** 无需额外配置：生成面已含五件套。Agent 调用真实工具：

```json
{ "name": "create_User", "arguments": { "body": { "name": "Bob" } } }
{ "name": "update_User", "arguments": { "id": "u1", "set": { "name": "A2" } } }
{ "name": "delete_User", "arguments": { "id": "u1" } }
{ "name": "get_User",    "arguments": { "id": "u1" } }
```

底层映射到宿主：`create_User` → `store.insert('User', body)`；`update_User` → `store.update('User', { _id: id }, set)`；`delete_User` → `store.remove('User', { _id: id })`；`get_User` → `store.queryOne('User($condition: @c0) { name, full }', { c0: { _id: id } })`。

**结果。** 每次调用返回宿主原生返回值（JSON）。单条查询返回 `null` 时变成 `notFound` `isError`——绝不是静默的空对象。

**优势所在。** CRUD 暴露是*免费*的：工具由 schema 生成，且每次写仍经 core 的语法 / 档位 / 权限 / 硬限判决。你一个 handler 都没写。

### 3. 让模型自省有哪些表（权限过滤后）

**业务背景。** 在写 GQL 之前，模型需要知道有哪些模型和字段——但只能看到它被允许看到的。

**配置/调用。** 模型调用零入参的全局工具：

```json
{ "name": "describe_schemas", "arguments": {} }
```

并把服务端配置为带受信上下文：

```js
await createStdioServer(store, { ctx: { userId: 'u1', roles: ['viewer'] } });
```

**结果。** 带上下文时，宿主返回完整紧凑摘要；不带上下文时，返回其**降级**摘要（仅模型名 + 字段名——防探针）。

**优势所在。** 模型可在查询前自我定位，且可见范围由与其它一切相同的权限逻辑过滤。本工具只是宿主 `describe_for_ai` 的薄透传——不存在第二份会漂移的 schema 定义。

### 4. 用 `ask` 做自然语言问数（沙箱 + 重试反馈）

**业务背景。** 非技术用户想打一句问题，而不是写 GQL。

**配置/调用。** 提供 LLM 与受信上下文即启用 `ask`：

```js
await createStdioServer(store, {
  llm: 'gpt',
  ctx: { userId: 'u1', roles: ['analyst'] },
  // hostAsk 自动从 nodejs-store 接线；传 opts.hostAsk 可覆盖（如测试）
});
```

客户端随后调用：

```json
{ "name": "ask", "arguments": { "question": "上个月创建了多少订单？" } }
```

**结果。** 成功返回 `{"data": [...], "attempts": [...], "events": [...]}`。若 LLM 产出的 GQL 校验失败，宿主把结构化错误回喂并重试；若重试耗尽，工具返回 `askExhausted` `isError`，其 message 内嵌最后一轮结构化错误。

**优势所在。** 皮肤新增**零**护栏、**零**重试逻辑——整条翻译/校验/重试流水线只存在于一处：宿主 `ask()`。你永远不会有两套互相打架的「重试几次」「什么算错误」。

### 5. 隐藏敏感模型

**业务背景。** 有一个内部使用的 `SecretConfig` 模型，绝不能出现在 AI 工具面里。

**配置/调用。** 给 defn 加注记：

```json
{ "name": "SecretConfig", "fields": { "token": {} }, "x-mcp": { "hidden": true } }
```

然后照常构建工具面：`exportTools(store)` / `createStdioServer(store)`。

**结果。** 根本不会生成 `get_SecretConfig` / `list_SecretConfig` / …；`describe_schemas` 也不会提到它。

**优势所在。** 隐藏是一行 schema 注记，与姊妹皮肤的 `x-grpc.hidden` / `x-graphql.hidden` 一致。无代码、无白名单、无漂移。

### 6. 归档表自动不出现在工具面

**业务背景。** store 在活动表旁维护 `XxxDeleted` 归档表。

**配置/调用。** 无需配置——过滤内置。给定已注册模型 `["User", "OrderDeleted", "Order", "StandaloneDeleted"]`，生成的工具面排除 `OrderDeleted`（因存在 `Order`），但保留 `StandaloneDeleted`（无 `Standalone`）。

**结果。** 模型永远看不到 `get_OrderDeleted`；真正独立的 `StandaloneDeleted` 模型被保留。

**优势所在。** 去噪规则与另三层皮肤逐字同构——同样的边界、同样的答案，故 AI 客户端与 REST 客户端看到一致的世界。

### 7. 只用 `exportTools` 做工具清单测试（无 SDK、无库）

**业务背景。** 在 CI 里你想断言「这些模型恰好产出这些工具」，又不想起 server 或库。

**配置/调用。**

```js
const { exportTools, filterArchived } = require('store-mcp-node');
const { tools } = exportTools(mockStore());
// tools: [{ name, description, inputSchema }, ...]
```

```python
from store_mcp import export_tools, filter_archived
tools = export_tools(mock_store())
```

**结果。** 你拿到定义清单——无传输、无 SDK、无副作用。本仓自身的 smoke 套件正是这样跑的（mock store + SDK 内存传输，零真实库、零宿主包依赖）。

**优势所在。** `exportTools` 与运行中 server 所广告的清单保证一致（同一 `buildSurface`），故廉价的 CI 断言同时也是可信的断言。

### 8. 同一份 schema，四层皮（REST / GraphQL / gRPC / MCP）

**业务背景。** 同一批业务模型要同时经 HTTP REST、GraphQL、gRPC **与** MCP 可达，供不同消费方使用。

**配置/调用。** 维护一份 JSON schema，注册一次；每层皮读同一源：

```
schema.json  ──┬──►  store-api       (REST)
               ├──►  store-graphql   (GraphQL)
               ├──►  store-grpc      (gRPC)
               └──►  store-mcp       (MCP)
```

**结果。** 四层皮都暴露由同一 defn 派生的 `get_X` / `list_X` / `create_X` / `update_X` / `delete_X` 类操作——同投影、同 `idField`、同归档过滤、同 `x-*.hidden` 注记风格。

**优势所在。** 零重复定义。改一次 schema，四层皮同步跟进；模型的工具名与你别处已在用的命名一致，故 prompt 与文档可直接迁移。

## v0 范围与明确不支持项

**支持**

- **stdio** 与 **streamable HTTP** 传输。
- CRUD 五件套 + `query` + `describe_schemas` + 可选 `ask`。
- `x-mcp.hidden` 模型级注记。
- 归档过滤（`XxxDeleted`）。

**不支持（v1 收编）**

- **store-gateway 第四开关**。
- MCP **resources / prompts** 原语。
- 工具级 override / extend 注记（比模型级 `x-mcp.hidden` 更细粒度）。

双端套件均跑在 mock store 上——stdio 用 SDK 内存传输，HTTP 用真实环回监听——**零真实库、零宿主包依赖**。语义一致性以 `spec/` 为准，`conformance/cases.json` 双端加载同一份断言逐字一致。

## FAQ

**1. `store-mcp` 需要数据库吗？**
它自身的测试与 `exportTools` / `export_tools` 不需要。要服务真实数据，你需要一个运行中的 common-store 宿主（`nodejs-store` / `py-store`）加数据源，与任何其它皮肤一样。

**2. 我需要改 core 或宿主吗？**
不需要。core 与宿主零改动；适配器只消费宿主的公共 API（见端口契约）。这正是「GQL 之上的一层皮」的全部要义。

**3. 为什么 `query` 限制 1000 行 / 深度 3 / 禁 `route_override`？**
因为工具调用方是不可信方（AI 客户端）。宿主的 **text2query 档**正是为「不可信方产出 GQL」而设计，故皮肤把 `query` 路由经它。这些限制是 core 的，不是皮肤的。

**4. 为什么 `ask` 要求 `ctx`，而 `query` 不注入它？**
`ask` 需要服务端用户上下文（`{userId, roles}`）来运行 LLM 翻译与档位检查；配 `llm` 缺 `ctx` 属配置错误，故装配期快速失败。`query` 沿用「当前进程上下文」——core 档位门禁无 ctx 即拒（fail-secure）；皮肤不伪造。请经 `contextProvider` 或宿主 `setContext` 供 ctx。

**5. 客户端能看到或设置用户上下文吗？**
不能。`ctx` 与 `llm` 永不出现在任何工具 inputSchema。它们是服务端受信参数（受信参数铁律）。

**6. `get_X` 查无时会发生什么？**
返回 `isError: true` + `{"code":"notFound", ...}`——与 gRPC `NOT_FOUND` 同语义位。它**不是**返回空对象的成功，也不是崩溃。

**7. 错误消息对程序化处理稳定吗？**
稳定。`code` 是判定链的固定枚举，且 `ERR_TEXT2QUERY:` 等 core 前缀在 `message` 内原样保留。两层都稳定，上游 Agent 可据此分支。

**8. 怎么隐藏一个模型？**
给它的 defn 加 `"x-mcp": { "hidden": true }`（模型级）。它不会产出任何工具，也不会出现在 `describe_schemas` 中。

**9. 为什么 `XxxDeleted` 表会消失？**
因为这是四层皮共用的归档约定。规则是防御性的：仅当存在去掉后缀的同名模型时，`Deleted` 结尾的模型才被过滤。

**10. 我能只拿工具定义、不启 server 吗？**
可以——`exportTools(store)`（Node）/ `export_tools(store)`（Python）。它是零 SDK 依赖的纯构建。

**11. 支持什么传输？**
**stdio** 与 **streamable HTTP**。store-gateway 第四开关为 v1。

**12. 模型需要事先知道 schema 吗？**
不需要——它应先调 `describe_schemas` 发现可用模型与字段（权限过滤后），再翻译 GQL。

## 开发

```bash
# Node
cd node && npm i && npm test
# 33 用例：16 单元 + 8 conformance + 3 错误矩阵 + 6 HTTP

# Python
cd py && pip install -e ".[dev]" && pytest
# 33 用例：18 单元 + 8 conformance + 3 错误矩阵 + 4 HTTP
```

两套均对共享的 `conformance/cases.json` 断言。要改断言，先改 JSON，再跑双端。

- `node/test/mcp.test.js`——16 个单元用例（工具面、get/list/create/update/delete、`query` 档位、`describe_schemas`、错误透传、`contextProvider`、`exportTools`、`filterArchived`）。
- `node/test/conformance.test.js`——8 个用例加载 `conformance/cases.json`。
- `node/test/error-matrix.test.js`——3 个用例钉住错误语义 → 协议码映射。
- `node/test/http-server.test.js`——6 个 HTTP 用例（真实环回监听 + 官方 SDK 客户端：`tools/list`、`tools/call`、每请求 `ctxFromRequest`、ctx/ctxFromRequest 互斥、`EADDRINUSE`、未知路径 404）。
- `py/tests/test_mcp.py`——18 个单元用例（与 Node 对称，含一个宿主档位回归用例）。
- `py/tests/test_conformance.py`——8 个用例加载 `conformance/cases.json`。
- `py/tests/test_error_matrix.py`——3 个用例，与 Node 错误矩阵对称。
- `py/tests/test_http_server.py`——4 个 HTTP 用例（真实 `run_http` 监听 + 官方 SDK 客户端，覆盖面与 Node HTTP 套件一致）。

## 相关项目

**宿主（本皮肤从其 schema 生成）**

- [nodejs-store](https://github.com/coenddt/nodejs-store)——Node（npm）宿主。
- py-store——Python（PyPI，`import py_store`）宿主。

**姊妹协议皮（同一 schema 源）**

- [store-api](https://github.com/coenddt/store-api)——REST。
- [store-graphql](https://github.com/coenddt/store-graphql)——GraphQL。
- [store-grpc](https://github.com/coenddt/store-grpc)——gRPC。
- [store-gateway](https://github.com/coenddt/store-gateway)——网关 / 组合器。

**引擎与家族**

- rust-store——Rust core（GQL 解析 / 权限 / 计算列 / 命令规划 / SQL 方言；无 IO）。
- meta-store——控制面。
- create-store-app——脚手架。
- store-rbac-bootstrap、store-resource-bootstrap——引导插件。

## 许可证

MIT © 2026 丁滔. 见 [LICENSE](./LICENSE)。
