# 01 — 工具面生成：schema → MCP tools

生成源唯一：store 的纯 JSON schema（与 REST / GraphQL / gRPC 皮肤同源）。适配层零语义发明——工具面只是 store 既有 schema / GQL / RBAC 语义的 MCP 表达。

## 工具面表（每模型 X）

| 工具名 | inputSchema | 说明 |
|---|---|---|
| `get_X` | `{ id: string }`（required） | 按 idField 精确查单条 |
| `list_X` | `{ q?: string, params?: object }` | `q` 为自模型名始的 GQL 余部（与 REST `?q=`、gRPC `q` 完全同源）；`params` 为 GQL 参数对象（MCP 原生 object，无 `_json` 字符串编码——proto 的 string 编码系类型系统所限，MCP 不需要） |
| `create_X` | `{ body: object }`（required） | 插入文档 |
| `update_X` | `{ id: string, set: object }`（均 required） | 按 idField 定位后部分更新 |
| `delete_X` | `{ id: string }`（required） | 按 idField 定位删除 |
| `query`（全局一个，非 per-model） | `{ gql: string, params?: object }`（gql required） | AI 自由读出口；**强制 text2query 档**执行（见 02） |
| `describe_schemas`（全局一个，非 per-model） | `{}`（无 required） | 列出可用模型及其字段/关系/计算列（权限过滤后的紧凑 JSON 数组，透传宿主 `describe_for_ai`）。**ctx 由部署侧经 `opts.ctx` 提供（受信参数，不进 inputSchema）**；`opts.ctx` 缺省 ⇒ 宿主既有降级摘要（仅模型名 + 字段名，防探针）。AI 客户端翻译 GQL 前应优先调用本工具获取 schema |
| `ask`（仅 `opts.llm` 提供时注册） | `{ question: string }`（required） | 透传宿主 `ask(question, { llm, ctx: opts.ctx })`；护栏全在宿主（text2query 档、只读、回喂重试、轨迹），皮肤零新增语义 |

- 命名对齐 store-graphql 生成面（`get_X` / `list_X` / `create_X` / `update_X` / `delete_X`）。
- 每个工具的 `description`：模型工具取 defn 的 `description` 键（JSON Schema 惯例，与 GraphQL description 管道同源），无则给一句生成说明（如 `List User documents (GQL q suffix + params)`）。

## idField

`store.get(name)` 返回的 defn 中取 `idField`；缺省 `'_id'`（对齐 store-grpc GetUser 定位先例）。定位值原样透传，服务端不做类型改写。

## 归档表过滤

与 store-api / store-graphql / store-grpc 逐字同构：模型名以 `Deleted` 结尾**且**存在去掉该后缀的同名模型时才过滤（防御用户恰好有名为 `XxxDeleted` 的独立模型）。

```js
const ARCHIVE_SUFFIX = 'Deleted';
function filterArchived(names) {
  const set = new Set(names);
  return names.filter((n) => !(n.endsWith(ARCHIVE_SUFFIX) && set.has(n.slice(0, -ARCHIVE_SUFFIX.length))));
}
```

## 注记（x-mcp）

| 注记 | 位置 | 效果 |
|---|---|---|
| `x-mcp: { hidden: true }` | defn 模型级 | 整模型不出工具（先例：x-grpc.hidden / x-graphql.hidden） |

冲突检测：工具名直接取模型原名（`get_User`），无大小写改写 ⇒ 无 service 名冲突问题（对比 gRPC 的 Pascal service 名冲突检测——MCP 不需要）。

## schema 投影（proj）

`list_X` 的 `q` 缺省时服务端拼 `模型名 + proj`；`get_X` 恒用 proj。与 store-grpc spec/02 同款：

- proj = `' { ' + [...Object.keys(fields), ...Object.keys(computes)].join(', ') + ' }'`（fields + computes 均视为字段，与 store-graphql 对齐）。
- 取值：`store.get(name)`（node）→ py-store 的 `schema.get(name)`；两者皆不可得 / fields 为空 ⇒ 空串（无投影，data 仅 `_id`——上游 schema 定义不完整的显式后果，与 REST/gRPC 同语义）。
- `q` 存在时投影完全由 `q` 决定，适配层不追加。

## ask 工具启用条件（零意外工具）

1. `opts.llm` 缺省 ⇒ 不注册（其余工具照常）。
2. `opts.llm` 提供但 `opts.ctx` 缺失 ⇒ 装配期抛错（fail-secure，提前于宿主 ask 入口检查）。
3. `ctx` / `llm` 永不出现在 inputSchema（D5：受信参数客户端零可触）。
4. `ask` 的 `description` 固定声明：只读问数、结果含执行轨迹、失败结构化显式返回（不降级不返回空结果）。
