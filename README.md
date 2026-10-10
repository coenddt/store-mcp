# store-mcp

Auto-generates a **MCP (Model Context Protocol)** tool surface from common-store schemas (nodejs-store / py-store) — the fourth skin over the same single JSON-schema source of truth, after REST ([store-api](https://github.com/coenddt/store-api)), GraphQL ([store-graphql](https://github.com/coenddt/store-graphql)) and gRPC ([store-grpc](https://github.com/coenddt/store-grpc)).

> 中文索引：[README.zh-CN.md](./README.zh-CN.md)

- Node: `store-mcp-node` (npm) — `@modelcontextprotocol/sdk` low-level Server + stdio transport
- Python: `store-mcp-py` (PyPI) — `mcp` SDK low-level Server + stdio transport
- Shared: `spec/` (single source of truth for tool generation / execution mapping / errors & context) + `conformance/` (cross-runtime cases: both runtimes load and assert the same JSON)

Design rule: **MCP is just another AI-client skin over GQL** — the adapter invents zero semantics; everything maps onto the store's existing schema / GQL / RBAC / profile semantics. Zero changes to core and hosts.

## Quick start

### Node (`store-mcp-node`)

```js
const { init, store } = require('nodejs-store');
const { createStdioServer } = require('store-mcp-node');

await init(db);
store.register(defn);            // plain JSON schema — register and go

await createStdioServer(store, {
  name: 'my-store-mcp',
  // llm: 'gpt',                 // optional: registers the `ask` tool (natural-language querying)
  // ctx: { userId: 'u1', roles: ['viewer'] },  // server-side user context for ask (trusted, never in tool inputs)
});
// Connect from Claude / TRAE / Cursor via stdio:
//   command: node ./server.js
```

Ready-made example: [`node/example/dsh-stdio-server.js`](./node/example/dsh-stdio-server.js) — a dsh (DeepSeek Harness) spawnable stdio entry (four steps: init data source → register schema → `setContext` → `createStdioServer`; env vars `MONGO_URI` / `STORE_SCHEMA` / `STORE_USER` / `STORE_ROLES`).

### Python (`store-mcp-py`)

```python
from py_store import init, store
from store_mcp import run_stdio

await init({'default': 'mongodb://...'})
store.register(defn)

run_stdio(store, {
    'name': 'my-store-mcp',
    # 'llm': 'gpt',      # optional ⇒ registers `ask`
    # 'ctx': {'userId': 'u1', 'roles': ['viewer']},
})
# MCP client stdio: command: python ./server.py
```

Tool list only, no server:

```js
const { tools } = require('store-mcp-node').exportTools(store);  // pure build, zero SDK dependency
```

```python
from store_mcp import export_tools
tools = export_tools(store)
```

## How generation works

1. **Single generation source**: the store's plain JSON schema (same source as the REST / GraphQL / gRPC skins)
2. **Surface**: per model `get_X` / `list_X` / `create_X` / `update_X` / `delete_X`, plus two global tools — `query` and `describe_schemas` (lists the available schemas / defs: models and their fields / relations / computed columns, a compact permission-filtered JSON that proxies the host's `describe_for_ai`); `x-mcp: { hidden: true }` hides a model; archived-table (`XxxDeleted`) filtering is verbatim-identical to the sibling skins
3. **Zero invented semantics**: tool inputs map to existing GQL + params (`list_X.q` is exactly the REST `?q=` surface), passing through core's four judgments — syntax / profile / permission / hard limits — inheriting RBAC and dialect routing wholesale
4. **`query` is forced into the text2query profile**: the AI free-read outlet runs in a read-only sandbox (core hard limits: 1000 rows / depth 3 / no route_override)
5. **`ask` (optional)**: registered only when `opts.llm` is provided; passes through the host's `ask()` single entry — LLM translation → text2query-profile validation & execution → structured error feedback retry; all guardrails live in the host, the skin adds none
6. **Errors as contract**: core/host stable prefixes (`ERR_TEXT2QUERY:` etc.) pass through verbatim; every failure returns `isError: true` + `{code, message}` — no degradation, no empty-result masking

## v0 scope and explicit non-goals

- Supported: stdio transport; CRUD quintets + `query` + `describe_schemas` + optional `ask`; `x-mcp.hidden` annotation; archive filtering
- Not supported (v1): streamable HTTP transport and the store-gateway fourth switch (awaiting the HTTP transport first); MCP resources / prompts primitives; tool-level override / extend annotations
- Both smoke suites run on a mock store + SDK in-memory transport — no real database, no host package dependency; semantic truth lives in `spec/`, and `conformance/cases.json` is asserted byte-identically by both runtimes

## Development

```bash
node: cd node && npm i && npm test          # 27 tests (16 unit + 8 conformance + 3 error matrix)
python: cd py && pip install -e ".[dev]" && pytest   # 29 tests (18 unit + 8 conformance + 3 error matrix)
```

Sibling repos: [store-api](https://github.com/coenddt/store-api) / [store-graphql](https://github.com/coenddt/store-graphql) / [store-grpc](https://github.com/coenddt/store-grpc) / [store-gateway](https://github.com/coenddt/store-gateway)
