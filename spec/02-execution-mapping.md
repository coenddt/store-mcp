# 02 — 执行映射：tool → store 调用

所有工具的 handler 遵循同一骨架：解析 tool 入参 JSON → 调 store 原生 API → 成功结果 `JSON.stringify` 进 `content[0].text`；任何错误经 spec/03 判定链映射后以 `isError: true` 返回。

## 映射表

以模型 `User`、idField `_id`、投影 `proj`（` { name, age }` 形状，spec/01）为例：

| 工具 | 入参 | store 调用 | 成功语义 |
|---|---|---|---|
| `get_User` | `id` | `store.queryOne('User($condition: @c0)'+proj, { c0: { _id: id } })` | 对象 JSON；`null` ⇒ notFound（isError，见 03） |
| `list_User` | `q`、`params` | `store.query(q ? 'User'+q : 'User'+proj, params)` | 数组 JSON |
| `create_User` | `body` | `store.insert('User', body)` | 插入文档 JSON |
| `update_User` | `id`、`set` | `store.update('User', { _id: id }, set)` | store.update 返回值原样 JSON（对齐 REST PATCH，不做二次回读） |
| `delete_User` | `id` | `store.remove('User', { _id: id })` | store.remove 返回值原样 JSON |
| `query` | `gql`、`params` | 见「query 工具档位契约」 | 数组 JSON |

## 入参解析规则

| 字段 | 规则 | 违例 |
|---|---|---|
| `params` | 缺省 ⇒ params 为 `undefined`（不传）；提供则必须是 JSON 对象 | ⇒ `invalidParam`（spec/03） |
| `body` | 必须是 JSON **对象**（数组 / 标量 / 缺失拒绝） | ⇒ `invalidBody` |
| `set` | 同 `body` | ⇒ `invalidBody` |
| `q` | 缺省/空串 ⇒ 服务端拼 `name + proj`；非空 ⇒ 拼接 `name + q`（模型名之后的 GQL 余部） | core 抛 `ERR_GQL_PARSE:` ⇒ spec/03 判定链 |
| `gql` | 必须为非空字符串，自模型名始的完整 GQL 查询串 | 缺失/空 ⇒ `invalidParam` |
| `id` | 原样透传为定位值，服务端不做类型改写 | — |

MCP inputSchema 已在协议层做类型预检（string/object required 由 SDK 校验），适配层只做「对象 vs 数组/标量」与空串两类语义校验——协议层拦截与语义拦截双层各司其职，越界入参必得显式错误（禁静默兜底）。

## query 工具档位契约

`query` 是本皮肤唯一的全局自由读出口，服务 AI 客户端的任意 GQL 读请求。**强制 text2query 档**执行：node 经 `profile.text2query(fn)` 上下文包裹（`nodejs-store\src\index.js` 已导出）；py 经 `with text2query():`（`py_store.schema`）。

- 依据：text2query 档是 core 为「不可信方产出 GQL」设计的沙箱（硬限 1000 行 / 深度 3 / 禁 route_override / 强制用户上下文——`AI能力接入设计-L1问数档.md` A1–A8）。MCP 的工具调用方正是不可信方（AI 客户端），档位对位是语义继承而非发明。
- 强制用户上下文 ⇒ `query` 工具要求 `opts.ctx`？**不**：`query` 沿用「当前进程上下文」语义——core 档位门禁无 ctx 即拒（fail-secure），皮肤不额外注入 `opts.ctx`；部署方要让 `query` 可用，经 `opts.contextProvider`（见下）或宿主 `setContext` 自行供 ctx。皮肤只负责档位包裹，不做 ctx 伪造。
- `routeOverride` 恒为 `null`（第三参数硬编码，对齐宿主 ask 先例 D5/CWE-639）。

## ask 工具透传契约

`ask` handler 仅做三件事：取 `question` 字符串 → 调宿主 `ask(question, { llm: opts.llm, ctx: opts.ctx })` → 结果映射。

- 成功：`AskResult.data` 进 text；`attempts`（执行轨迹）与 `events`（反馈事件）并入 JSON 一并返回（AI 客户端可自证查询过程）。
- `AskExhausted` ⇒ isError + `askExhausted` 码，message 内嵌最后一轮结构化错误（宿主异常消息已含，原样透传）。
- LLM 客户端异常（网络/HTTP/空 content）原样穿透为 isError（宿主已结构化，皮肤禁改写）。
- 护栏零新增：档位/只读/回喂/硬限全在宿主 `ask()` 与 core；皮肤禁止任何「失败重试」「空结果兜底」逻辑（no-error-masking）。

## 上下文注入（contextProvider）

- `opts.contextProvider`：每工具调用前的钩子（node 收 MCP 请求元信息对象；py 同形）。返回值经 `store.setContext(ctx)` 注入；返回 `null`/`undefined` 时同样**显式** `setContext(null)`（清除语义必须落地，防身份跨请求残留——对齐 store-grpc spec/02）。
- 钩子抛错 ⇒ spec/03 判定链（PermissionError ⇒ `permissionDenied`；其余 ⇒ `unauthenticated`，message 原样透传）。
- v0 stdio 单用户场景常无 per-request 身份：不配 contextProvider 时不触碰 setContext（进程级 ctx 由部署方在装配前自行 setContext，皮肤不代管）。
