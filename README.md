# store-mcp

> **MCP is the AI-client skin over GQL.** `store-mcp` auto-generates a **Model Context Protocol** tool surface from your existing common-store schemas — the fourth skin over the same single JSON-schema source of truth, after REST ([store-api](https://github.com/coenddt/store-api)), GraphQL ([store-graphql](https://github.com/coenddt/store-graphql)) and gRPC ([store-grpc](https://github.com/coenddt/store-grpc)). The adapter **invents zero semantics**: every tool maps straight onto the store's existing schema / GQL / RBAC / profile semantics, and **core and hosts stay untouched**.

> 中文索引：[README.zh-CN.md](./README.zh-CN.md)

## Runtime matrix

| Runtime | Package | Distribution | SDK / transport | Requires |
|---|---|---|---|---|
| Node | `store-mcp-node` | npm | `@modelcontextprotocol/sdk` low-level `Server` + **stdio** transport | Node **>= 18** |
| Python | `store-mcp-py` | PyPI | `mcp` SDK low-level `Server` + **stdio** transport | Python **>= 3.10**, `mcp>=2.2,<3` |

Both runtimes share the same ground truth:

- `spec/` — the **single source of truth** for tool generation (`01`), execution mapping (`02`) and errors & context (`03`).
- `conformance/` — `cases.json`, the **one** cross-runtime assertion file; both runtimes load and assert the same JSON byte-for-byte.

## Table of contents

1. [What it is](#what-it-is)
2. [How generation works](#how-generation-works)
3. [When to use it / When not to use it](#when-to-use-it--when-not-to-use-it)
4. [Installation](#installation)
5. [Quick start](#quick-start)
   - [Node](#node-store-mcp-node)
   - [Python](#python-store-mcp-py)
   - [The ready-made stdio example, four steps](#the-ready-made-stdio-example-step-by-step)
6. [Tool catalogue & inputs](#tool-catalogue--inputs)
7. [`exportTools` / `export_tools` — definitions only, zero SDK](#exporttools--export_tools--definitions-only-zero-sdk)
8. [The `ask` tool — natural-language querying](#the-ask-tool--natural-language-querying)
9. [Errors & context](#errors--context)
10. [Scenarios](#scenarios)
11. [v0 scope and explicit non-goals](#v0-scope-and-explicit-non-goals)
12. [FAQ](#faq)
13. [Development](#development)
14. [Related projects](#related-projects)
15. [License](#license)

## What it is

`store-mcp` is a thin **MCP adapter**. It reads the plain JSON schema you have already registered with a common-store host (`nodejs-store` or `py-store`) and exposes it to AI clients (Claude Desktop, TRAE, Cursor, or any MCP-capable agent runtime) as a set of **tools** over stdio.

Its defining rule is **zero invented semantics**:

- **Single generation source.** The store's registered JSON schema — the same source used by the REST / GraphQL / gRPC skins. `store-mcp` adds nothing to it.
- **Surface.** Per model: `get_X` / `list_X` / `create_X` / `update_X` / `delete_X`. Globally: `query` and `describe_schemas`. Optionally: `ask`.
- **No new semantics on the wire.** Tool inputs map to existing GQL + params. `list_X.q` is *exactly* the REST `?q=` surface. Every call passes through core's four judgments — **syntax / profile / permission / hard limits** — inheriting RBAC and dialect routing wholesale.
- **`query` runs in a read-only sandbox.** The AI's free-read outlet is forced into the host's **text2query profile** (core hard limits: **1000 rows / depth 3 / no `route_override`**).
- **`ask` is opt-in.** Registered **only when `opts.llm` is provided**; it passes through the host's single `ask()` entry point.
- **Errors are a contract.** Every failure returns `isError: true` with a stable `{code, message}` object — no degradation, no empty-result masking. Stable core prefixes (`ERR_TEXT2QUERY:` etc.) pass through verbatim.

Core and hosts are not modified: the adapter only *consumes* the host's public API (see the [store port contract](#store-port-contract) below).

## How generation works

1. **Single generation source.** The store's plain JSON schema (same source as the REST / GraphQL / gRPC skins).
2. **Surface.** Per model `get_X` / `list_X` / `create_X` / `update_X` / `delete_X`, plus two global tools — `query` and `describe_schemas` (a compact, permission-filtered JSON listing the available models with their fields / relations / computed columns, proxying the host's `describe_for_ai`). `x-mcp: { hidden: true }` hides a model entirely; archived-table (`XxxDeleted`) filtering is verbatim-identical to the sibling skins.
3. **Zero invented semantics.** Tool inputs map to existing GQL + params (`list_X.q` is exactly the REST `?q=` surface), passing through core's four judgments — syntax / profile / permission / hard limits — inheriting RBAC and dialect routing wholesale.
4. **`query` is forced into the text2query profile.** The AI free-read outlet runs in a read-only sandbox (core hard limits: 1000 rows / depth 3 / no `route_override`).
5. **`ask` (optional).** Registered only when `opts.llm` is provided; passes through the host's `ask()` single entry — LLM translation → text2query-profile validation & execution → structured error feedback retry. All guardrails live in the host; the skin adds none.
6. **Errors as contract.** Core/host stable prefixes (`ERR_TEXT2QUERY:` etc.) pass through verbatim; every failure returns `isError: true` + `{code, message}` — no degradation, no empty-result masking.

### Store port contract

The skin consumes only the host's public API surface (identical set to store-grpc `spec/00`):

| Runtime | Host API consumed |
|---|---|
| Node (`nodejs-store`) | `store.list()` / `store.get(name)` / `store.query(q, params, routeOverride)` / `store.queryOne(q, params, routeOverride)` / `store.insert(name, body)` / `store.update(name, locator, set)` / `store.remove(name, locator)` / `store.setContext(ctx)` / `store.describeForAi(ctx)` |
| Python (`py-store`) | `schema.list()` / `schema.get(name)` + store instance's same-shaped methods; `store.describe_for_ai(ctx)` |

The `ask` tool additionally consumes the host's `ask(question, { llm, ctx })` single entry point.

### `opts` (same shape on both runtimes)

| Option | Meaning |
|---|---|
| `name?` | Server name, default `store-mcp`. |
| `version?` | Server version (Node). |
| `llm?` | Register name or `async (messages) => str`. **Providing it registers `ask`.** |
| `ctx?` | Server-side trusted user context `{userId, roles}`. Serves both `ask` (registration precondition) and `describe_schemas` (digest visibility). **Never appears in any tool inputSchema.** |
| `resources?` | Explicit subset of models to build tools from (bypasses archive filtering / `list()`). |
| `contextProvider?` (Node) / `context_provider?` (Py) | Per-call hook; its return value is injected via `setContext`. See [Errors & context](#errors--context). |
| `text2query?` | Profile context for the `query` tool. Node: `fn(async fn) -> Promise`; Python: a sync `@contextmanager` factory. Defaults are resolved from the host; if neither is available, **assembly throws** with guidance. |
| `hostAsk?` / `host_ask?` | Host `ask` binding; defaults constructed from the host, overridable for tests. |
| `schema_module?` | Python only: metadata provider; defaults to duck-typing `store.list/get`, then `py_store.schema`. |

## When to use it / When not to use it

**Use it when**

- You already run a common-store host (`nodejs-store` / `py-store`) with registered schemas and want a **zero-extra-code** MCP surface for AI clients.
- You want an AI agent to do **read-only question answering** over your business data (through `query` / `ask`), with the same RBAC and profile guardrails as your other clients.
- You want to expose models as **CRUD tools** to an agent (through the generated quintet), inheriting every guardrail.
- You want **one schema** to feed REST, GraphQL, gRPC *and* MCP without re-declaring anything.

**Do not use it when**

- You need a **streamable HTTP** transport (v0 is stdio only — see [v0 scope](#v0-scope-and-explicit-non-goals)).
- You need MCP **resources** or **prompts** primitives (v0 exposes tools only).
- You need **tool-level** override/extend annotations (v0 supports only the model-level `x-mcp.hidden`).
- You want a completely custom tool surface that is *not* your registered schema. The skin always generates from the schema; anything else is out of scope.

## Installation

### Node

```bash
npm install store-mcp-node
# peer: install your host too
npm install nodejs-store
```

The MCP carrier dependency (`@modelcontextprotocol/sdk`) is a direct dependency; the host (`nodejs-store`) is an **optional peer dependency** — `exportTools` works without it.

### Python

```bash
pip install store-mcp-py
# peer: install your host too
pip install py-store
```

The carrier dependency (`mcp>=2.2,<3`) is a direct dependency; `py-store` is needed for the default `text2query` profile and metadata, but `export_tools` works without it.

### Wiring it into an MCP client (Claude / TRAE / Cursor)

MCP clients launch a stdio server via a small JSON block. Point `command` at your entry script and pass configuration through `env`:

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

For a Python entry point, swap the command:

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

`args` may reference `node` / `python` / `npx` / `uvx`; the client spawns the process and speaks MCP over its stdin/stdout.

## Quick start

### Node (`store-mcp-node`)

```js
const { init, store, schema } = require('nodejs-store');
const { createStdioServer } = require('store-mcp-node');

async function main() {
  await init(db);                 // your data source
  store.register(defn);           // plain JSON schema — register and go

  // text2query profile + trusted context (never visible to the client)
  store.setContext({ userId: 'u1', roles: ['viewer'] });

  await createStdioServer(store, {
    name: 'my-store-mcp',
    ctx: { userId: 'u1', roles: ['viewer'] },
    // llm: 'gpt',                 // optional: providing it registers the `ask` tool
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
// Connect from Claude / TRAE / Cursor via stdio:  command: node ./server.js
```

### Python (`store-mcp-py`)

```python
import anyio
from py_store import init, store
from store_mcp import run_stdio

async def bootstrap():
    await init({'default': 'mongodb://...'})
    store.register(defn)                                # plain JSON schema
    await store.set_context({'userId': 'u1', 'roles': ['viewer']})

anyio.run(bootstrap)   # one-time async setup

# run_stdio is a blocking stdio loop — call it at top level (not inside a running loop)
run_stdio(store, {
    'name': 'my-store-mcp',
    'ctx': {'userId': 'u1', 'roles': ['viewer']},
    # 'llm': 'gpt',            # optional ⇒ registers `ask`
})
# MCP client stdio: command: python ./server.py
```

### The ready-made stdio example, step by step

[`node/example/dsh-stdio-server.js`](./node/example/dsh-stdio-server.js) is a **working, copy-pasteable** stdio entry that a harness (e.g. dsh — DeepSeek Harness) can spawn directly. It demonstrates the canonical four steps:

1. **Initialize the data source.** If `STORE_LOCAL_DIR` is set, it uses the `nodejs-store` local-disk backend (no Mongo needed); otherwise it connects MongoDB with `MONGO_URI`.
2. **Register the schema.** It reads a JSON schema file (`STORE_SCHEMA`) and `schema.register(defn)` for each definition.
3. **`setContext`.** It builds a trusted server-side context `{ userId, roles }` and calls `store.setContext(ctx)` — the text2query profile requires a context.
4. **`createStdioServer`.** It calls `createStdioServer(store, { ctx })` and blocks on stdio. It does **not** pass `llm`, so `ask` is not registered (counting one model is enough; avoids a "double model translation").

Environment variables honoured by the example:

| Variable | Default | Purpose |
|---|---|---|
| `STORE_LOCAL_DIR` | *(unset)* | If set, use the `nodejs-store` local-disk backend (skips Mongo). |
| `MONGO_URI` | `mongodb://127.0.0.1:27017/dsh_store` | Mongo connection string (used only when `STORE_LOCAL_DIR` is unset). |
| `STORE_SCHEMA` | repo-local example schema | Path to the JSON schema file to register. |
| `STORE_USER` | `dsh-user` | `userId` for the trusted context. |
| `STORE_ROLES` | `admin` | Comma-separated `roles` for the trusted context. |

In production, replace steps ①–③ with your own application bootstrap (your schema source, your context source); **step ④ is unchanged**.

## Tool catalogue & inputs

For each model `X` the surface generates five tools; two more are always global (`query` and `describe_schemas`), plus an optional global `ask`.

| Tool | inputSchema | Notes |
|---|---|---|
| `get_X` | `{ id: string }` *(required)* | Exact single-row lookup by the model's `idField`. |
| `list_X` | `{ q?: string, params?: object }` | `q` is the GQL suffix starting at the model name — **identical in meaning to REST `?q=` and the gRPC `q`**. `params` is the GQL parameter object (a native MCP object; no `_json` string encoding as with proto — MCP does not need it). |
| `create_X` | `{ body: object }` *(required)* | Insert a document. |
| `update_X` | `{ id: string, set: object }` *(both required)* | Partial update located by `idField`. |
| `delete_X` | `{ id: string }` *(required)* | Delete located by `idField`. |
| `query` *(global)* | `{ gql: string, params?: object }` (`gql` required) | The AI's free-read outlet; **forced into the text2query profile**. |
| `describe_schemas` *(global)* | `{}` | Lists available models with fields/relations/computed columns (permission-filtered compact JSON, proxying the host's `describe_for_ai`). `ctx` comes from `opts.ctx` (trusted, not in the inputSchema); with no `ctx` the host returns its degraded digest (model names + field names only, anti-probe). Call this **before** translating GQL. |
| `ask` *(only when `opts.llm` is set)* | `{ question: string }` *(required)* | Passes through to the host `ask(question, { llm, ctx: opts.ctx })`. |

**Naming.** Tool names take the model name verbatim (`get_User`), with **no case rewriting** — so there is no service-name collision problem (unlike gRPC's Pascal service names; MCP does not need one).

**Descriptions.** A model tool's `description` uses the defn's `description` key (JSON-Schema convention, same pipeline as GraphQL descriptions); if absent, a generated sentence is used (e.g. `List User documents (GQL q suffix + params)`).

**`idField`.** Taken from the defn returned by `store.get(name)`; default `'_id'`. The locator value is passed through verbatim — the server performs no type rewriting.

**Projection (`proj`).** When `list_X.q` is empty the server appends `ModelName + proj`; `get_X` always uses `proj`. `proj` is ` { field1, field2, ... }` over `fields` **plus** `computes` (both treated as fields, aligned with store-graphql). When `q` is present, the projection is entirely determined by `q` — the adapter appends nothing.

**Archive filtering.** Verbatim-identical to store-api / store-graphql / store-grpc: a model ending in `Deleted` is filtered **only if** a same-named model without the suffix exists (defending against a user who genuinely has an independent `XxxDeleted` model).

```js
const ARCHIVE_SUFFIX = 'Deleted';
function filterArchived(names) {
  const set = new Set(names);
  return names.filter((n) => !(n.endsWith(ARCHIVE_SUFFIX) && set.has(n.slice(0, -ARCHIVE_SUFFIX.length))));
}
```

### Input parsing rules

| Field | Rule | Violation |
|---|---|---|
| `params` | Absent ⇒ `undefined` (not passed); if present, must be a JSON object. | ⇒ `invalidParam` |
| `body` | Must be a JSON **object** (arrays / scalars / missing are rejected). | ⇒ `invalidBody` |
| `set` | Same as `body`. | ⇒ `invalidBody` |
| `q` | Absent/empty ⇒ server appends `name + proj`; non-empty ⇒ concatenates `name + q`. | core throws `ERR_GQL_PARSE:` ⇒ judgment chain |
| `gql` | Must be a non-empty string: a full GQL query starting at the model name. | missing/empty ⇒ `invalidParam` |
| `id` | Passed through verbatim as the locator. | — |

The MCP `inputSchema` already performs protocol-level type pre-checks (string/object `required` are validated by the SDK); the adapter adds only the two semantic checks — "object vs array/scalar" and "empty string". The two layers each do their part, and out-of-range inputs always yield an explicit error (**no silent fallback**).

## `exportTools` / `export_tools` — definitions only, zero SDK

Both runtimes expose a **pure build** that returns the tool definitions and nothing else. It has **zero SDK dependency** and always works — useful for tests, tool catalogues, or building your own server on top.

```js
const { tools, } = require('store-mcp-node').exportTools(store, opts);
// tools: [{ name, description, inputSchema }, ...]
```

```python
from store_mcp import export_tools
tools = export_tools(store, opts)   # list[dict]
```

- Node: `exportTools(store, opts) -> { tools }`
- Python: `export_tools(store, opts) -> list[dict]`

Because it is the same `buildSurface` used by `createServer`, the definition list is guaranteed consistent with what a running server advertises. Use it when you only want the tool list — no transport, no SDK, no side effects.

Server assembly (both non-transport and stdio) is also exported:

- Node: `createServer(store, opts) -> Promise<{ server, tools }>` (assembles all guards, binds no transport — tests connect via `InMemoryTransport`; v1 HTTP will reuse it) and `createStdioServer(store, opts)` (= `createServer` + `StdioServerTransport`).
- Python: `create_server(store, opts) -> { server, tools }` and `run_stdio(store, opts)` (= `create_server` + stdio, blocking via anyio).

Missing carrier dependency (Node: no `@modelcontextprotocol/sdk`; Python: no `mcp`) ⇒ `createStdioServer` / `run_stdio` throws with install guidance; `exportTools` / `export_tools` never needs the SDK.

## The `ask` tool — natural-language querying

`ask` turns a natural-language question into a read-only data answer, reusing the host's entire `ask()` orchestration.

- **Registered only when `opts.llm` is provided.** With `opts.llm` absent, `ask` is not registered and everything else works normally.
- **Fail-secure context.** If `opts.llm` is provided but `opts.ctx` is missing, **assembly throws immediately** — earlier than the host's own `ask()` entry check.
- **Ctx is trusted and invisible.** `ctx` / `llm` never appear in any tool inputSchema. The client/LLM can neither read nor inject them (trusted-parameter rule).
- **Translation → validation → execution → retry.** The host performs: LLM translation of the question to GQL → **text2query-profile validation and execution** (read-only sandbox: 1000 rows / depth 3 / no `route_override`) → on failure, a **structured error feedback retry** loop.
- **Full result returned.** On success the tool returns `{ data, attempts, events }` — where `attempts` is the execution trace and `events` are feedback events, so the client can self-verify the query process.
- **Guardrails live in the host.** Profile, read-only, feedback retry and hard limits all reside in the host `ask()` and core. The skin adds **no** guardrails and — importantly — **no** "retry on failure" or "empty-result fallback" logic (`no-error-masking`).

The handler does exactly three things: read the `question` string → call host `ask(question, { llm, ctx })` → map the result.

## Errors & context

Every tool failure returns MCP `isError: true` explicitly. No silent loss, no empty-result fallback, no degrading retry. ("Not found" is a deterministic outcome, not a crash — see the chain.)

### Error judgment chain (fixed order, first match wins)

| # | Condition | Code | `message` |
|---|---|---|---|
| 1 | Host feedback event `profile_blocked` | `profileBlocked` | event message verbatim |
| 2 | Host `PermissionError` | `permissionDenied` | `str(e)` verbatim |
| 3 | Host `NoContextError` (requires context but missing; core machine code `no_context`) | `noContext` | `str(e)` verbatim |
| 4 | Host `ProfileViolation` | `profileBlocked` | `str(e)` verbatim |
| 5 | Input semantic violation (parsing rules above) | `invalidParam` / `invalidBody` | names the field and requirement |
| 6 | `get_X` returns `null` | `notFound` | `User <id> not found` |
| 7 | Host `AskExhausted` | `askExhausted` | exception message verbatim (already embeds the last structured error) |
| 8 | Everything else | `planError` | `str(e)` verbatim |

The chain mirrors the host `ask` `_error_from_exception` precedent; the only difference is that the skin adds two protocol-surface errors — "input violation" and "notFound" — which are MCP protocol semantics, not store semantics.

**Detection is by name/code, not `instanceof`** — so it is safe across package boundaries.

### Stable core prefixes pass through verbatim

Core/host stable prefixes (`ERR_GQL_PARSE:`, `ERR_TEXT2QUERY:`, `ERR_LIMIT:`, …) are **preserved verbatim inside `message`** — never rewritten, summarized, or stripped. Downstream agents that program against these prefixes depend on their stability.

### Response shapes

Error:

```json
{
  "isError": true,
  "content": [{ "type": "text", "text": "{\"code\":\"profileBlocked\",\"message\":\"...ERR_TEXT2QUERY:...\"}" }]
}
```

Success:

```json
{ "content": [{ "type": "text", "text": "<JSON.stringify(data)>" }] }
```

- The success response contains **no error key** (a positive assertion of `no-error-masking`).
- `get_X` "not found" is neither success nor crash: it is a `notFound` `isError` (same semantic slot as gRPC `NOT_FOUND`).
- A successful `ask` returns a three-key JSON `{data, attempts, events}`.

### Context (`ctx`) and `contextProvider`

- `opts.ctx` serves `ask` (and `describe_schemas` visibility). It flows into the execution surface through the host's scoped context; the skin neither persists nor mutates it.
- `opts.contextProvider` (Node) / `opts.context_provider` (Py) is a per-call hook. Its return value is injected via `setContext`; returning `null`/`undefined` **explicitly** calls `setContext(null)` (the clear semantics must land, preventing identity leakage across requests). If the hook throws, it enters the judgment chain (`PermissionError` ⇒ `permissionDenied`; otherwise ⇒ `unauthenticated` with the message verbatim).
- In v0 stdio single-user scenarios there is usually no per-request identity: without a `contextProvider`, the skin does not touch `setContext` (the process-level context is set by the deployer before assembly).
- **`query` does not get `opts.ctx` injected.** The `query` tool reuses the "current process context" semantics — the core profile gate rejects a missing context (fail-secure); the skin does not inject or forge a context. To make `query` usable you supply the context via `opts.contextProvider` or a host `setContext`.

## Scenarios

Each scenario follows **Business context → Configuration/call → Result → Where the advantage is**.

### 1. Let Claude / TRAE / Cursor query your business DB read-only

**Business context.** Your analytics team keeps a MongoDB behind a common-store host. Analysts want to ask Claude things like "how many orders last month" without giving the model write access or a raw DB connection.

**Configuration/call.** Point the MCP client at the stdio example, using a **read-only role**:

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

Then the model calls the `query` tool:

```json
{ "name": "query", "arguments": { "gql": "Order -> { total }", "params": {} } }
```

**Result.** The model receives a JSON array (or a structured `isError` with `{code, message}`). The call runs inside the host's **text2query** profile — read-only, 1000-row cap, depth 3, no `route_override` — with the roles from `STORE_ROLES`.

**Where the advantage is.** You get AI querying *without* a new data path: the same RBAC and profile guardrails that protect REST/gRPC protect MCP. The skin never widens access — the sandbox is the host's, inherited verbatim.

### 2. Expose models as CRUD tools to an agent

**Business context.** An internal agent (a support bot, an ops assistant) must create and update records — not just read them.

**Configuration/call.** No extra config: the generated surface already includes the quintet. The agent calls real tools:

```json
{ "name": "create_User", "arguments": { "body": { "name": "Bob" } } }
{ "name": "update_User", "arguments": { "id": "u1", "set": { "name": "A2" } } }
{ "name": "delete_User", "arguments": { "id": "u1" } }
{ "name": "get_User",    "arguments": { "id": "u1" } }
```

Under the hood these map straight onto the host: `create_User` → `store.insert('User', body)`; `update_User` → `store.update('User', { _id: id }, set)`; `delete_User` → `store.remove('User', { _id: id })`; `get_User` → `store.queryOne('User($condition: @c0) { name, full }', { c0: { _id: id } })`.

**Result.** Each call returns the host's native return value as JSON. A `null` from the single-row lookup becomes a `notFound` `isError` — never a silent empty object.

**Where the advantage is.** CRUD exposure is *free*: the tools were generated from the schema, and every write still passes core's syntax / profile / permission / hard-limit judgments. You did not write a single handler.

### 3. Let the model introspect available tables (permission-filtered)

**Business context.** Before writing GQL, the model needs to know which models and fields exist — but only those it is allowed to see.

**Configuration/call.** The model calls the zero-argument global tool:

```json
{ "name": "describe_schemas", "arguments": {} }
```

with the server configured with a trusted context:

```js
await createStdioServer(store, { ctx: { userId: 'u1', roles: ['viewer'] } });
```

**Result.** With a context, the host returns the full compact digest; without one, it returns its **degraded** digest (model names + field names only — an anti-probe measure).

**Where the advantage is.** The model can self-orient before querying, and the visible set is filtered by the same permission logic as everything else. The tool is a thin proxy of the host's `describe_for_ai` — there is no second schema definition to drift.

### 4. Natural-language question answering with `ask` (sandbox + retry feedback)

**Business context.** Non-technical users want to type a question, not GQL.

**Configuration/call.** Enable `ask` by providing an LLM and a trusted context:

```js
await createStdioServer(store, {
  llm: 'gpt',
  ctx: { userId: 'u1', roles: ['analyst'] },
  // hostAsk is auto-wired from nodejs-store; provide opts.hostAsk to override (e.g. tests)
});
```

The client then calls:

```json
{ "name": "ask", "arguments": { "question": "How many orders were created last month?" } }
```

**Result.** Success returns `{"data": [...], "attempts": [...], "events": [...]}`. If the LLM's GQL fails validation, the host feeds the structured error back and retries; if retries are exhausted, the tool returns an `askExhausted` `isError` whose message embeds the last structured error.

**Where the advantage is.** The skin adds **zero** guardrails and **zero** retry logic — the whole translation/validation/retry pipeline lives in one place: the host `ask()`. You never have two competing implementations of "how many retries" or "what counts as an error".

### 5. Hide a sensitive model

**Business context.** A `SecretConfig` model exists for internal use but must never appear in the AI tool surface.

**Configuration/call.** Annotate the defn:

```json
{ "name": "SecretConfig", "fields": { "token": {} }, "x-mcp": { "hidden": true } }
```

Then build the surface as usual: `exportTools(store)` / `createStdioServer(store)`.

**Result.** No `get_SecretConfig` / `list_SecretConfig` / … is generated at all; `describe_schemas` does not mention it either.

**Where the advantage is.** Hiding is a one-line schema annotation, consistent with the sibling skins' `x-grpc.hidden` / `x-graphql.hidden`. No code, no allowlist, no drift.

### 6. Keep archived tables out of the surface automatically

**Business context.** The store maintains `XxxDeleted` archive tables alongside live tables.

**Configuration/call.** Nothing to configure — filtering is built in. Given registered models `["User", "OrderDeleted", "Order", "StandaloneDeleted"]`, the generated surface excludes `OrderDeleted` (because `Order` exists) but keeps `StandaloneDeleted` (no `Standalone` exists).

**Result.** The model never sees `get_OrderDeleted`; a genuinely standalone `StandaloneDeleted` model is preserved.

**Where the advantage is.** The de-noise rule is byte-identical to the other three skins — same edge case, same answer, so an AI client and a REST client see a consistent world.

### 7. Tool-list tests with `exportTools` (no SDK, no DB)

**Business context.** In CI you want to assert "these models produce exactly these tools" without spinning up a server or a database.

**Configuration/call.**

```js
const { exportTools, filterArchived } = require('store-mcp-node');
const { tools } = exportTools(mockStore());
// tools: [{ name, description, inputSchema }, ...]
```

```python
from store_mcp import export_tools, filter_archived
tools = export_tools(mock_store())
```

**Result.** You get the definition list — no transport, no SDK, no side effects. The repo's own smoke suites run exactly this way (mock store + SDK in-memory transport, zero real DB, zero host package dependency).

**Where the advantage is.** `exportTools` is guaranteed to match what a running server advertises (same `buildSurface`), so a cheap CI assertion is also a trustworthy one.

### 8. One schema, four skins (REST / GraphQL / gRPC / MCP)

**Business context.** The same business models must be reachable over HTTP REST, GraphQL, gRPC **and** MCP, for different consumers.

**Configuration/call.** Keep a single JSON schema and register it once; each skin reads the same source:

```
schema.json  ──┬──►  store-api       (REST)
               ├──►  store-graphql   (GraphQL)
               ├──►  store-grpc      (gRPC)
               └──►  store-mcp       (MCP)
```

**Result.** All four surfaces expose `get_X` / `list_X` / `create_X` / `update_X` / `delete_X`-equivalent operations derived from the same defn — same projection, same `idField`, same archive filtering, same `x-*.hidden` annotation style.

**Where the advantage is.** Zero duplicate definition. Change the schema once and all skins follow; the model's tool names match the naming you already use elsewhere, so prompts and docs transfer.

## v0 scope and explicit non-goals

**Supported**

- **stdio** transport.
- CRUD quintets + `query` + `describe_schemas` + optional `ask`.
- `x-mcp.hidden` model-level annotation.
- Archive filtering (`XxxDeleted`).

**Not supported (slated for v1)**

- **streamable HTTP** transport and the **store-gateway fourth switch** (both await the HTTP transport first).
- MCP **resources / prompts** primitives.
- Tool-level override / extend annotations (finer-grained than the model-level `x-mcp.hidden`).

Both smoke suites run on a mock store + the SDK's in-memory transport — **no real database, no host package dependency**. Semantic truth lives in `spec/`; `conformance/cases.json` is asserted byte-identically by both runtimes.

## FAQ

**1. Does `store-mcp` require a database?**
Not for its own tests or for `exportTools` / `export_tools`. To serve real data you need a running common-store host (`nodejs-store` / `py-store`) with a data source, exactly as with any other skin.

**2. Do I need to modify core or the host?**
No. Core and hosts are untouched; the adapter only consumes the host's public API (see the store port contract). This is the whole point of "a skin over GQL".

**3. Why is `query` restricted to 1000 rows / depth 3 / no `route_override`?**
Because the tool caller is an untrusted party (the AI client). The host's **text2query profile** was designed precisely for "untrusted party produces GQL", so the skin routes `query` through it. The limits are the core's, not the skin's.

**4. Why does `ask` require `ctx` but `query` does not inject it?**
`ask` needs a service-side user context (`{userId, roles}`) to run the LLM translation and profile check; providing `llm` without `ctx` is a configuration bug, so assembly fails fast. `query` reuses the "current process context" — the core profile gate rejects a missing context (fail-secure); the skin does not forge one. Supply it via `contextProvider` or a host `setContext`.

**5. Can the client see or set the user context?**
No. `ctx` and `llm` never appear in any tool inputSchema. They are trusted server-side parameters (the trusted-parameter rule).

**6. What happens when a `get_X` finds nothing?**
It returns `isError: true` with `{"code":"notFound", ...}` — the same semantic slot as gRPC `NOT_FOUND`. It is **not** a success with an empty object, and it is not a crash.

**7. Are error messages stable for programmatic handling?**
Yes. `code` is a fixed enumeration from the judgment chain, and core prefixes like `ERR_TEXT2QUERY:` are preserved verbatim inside `message`. Both layers are stable so upstream agents can branch on them.

**8. How do I hide a model?**
Add `"x-mcp": { "hidden": true }` to its defn (model level). No tools and no `describe_schemas` entry are produced for it.

**9. Why do `XxxDeleted` tables disappear?**
Because that is the archive convention across all four skins. The rule is defensive: a `Deleted`-suffixed model is filtered only if a same-named model without the suffix also exists.

**10. Can I get just the tool definitions without starting a server?**
Yes — `exportTools(store)` (Node) / `export_tools(store)` (Python). It is a pure build with zero SDK dependency.

**11. What transport is supported?**
stdio only in v0. Streamable HTTP (and the store-gateway fourth switch) are v1.

**12. Does the model need to know the schema up front?**
No — it should call `describe_schemas` first to discover available models and fields (permission-filtered), then translate GQL.

## Development

```bash
# Node
cd node && npm i && npm test
# 27 tests: 16 unit + 8 conformance + 3 error-matrix

# Python
cd py && pip install -e ".[dev]" && pytest
# 29 tests: 18 unit + 8 conformance + 3 error-matrix
```

Both suites assert against the shared `conformance/cases.json`. To change an expectation, change the JSON first, then run both runtimes.

- `node/test/mcp.test.js` — 16 unit tests (surface, get/list/create/update/delete, `query` profile, `describe_schemas`, error pass-through, `contextProvider`, `exportTools`, `filterArchived`).
- `node/test/conformance.test.js` — 8 tests loading `conformance/cases.json`.
- `node/test/error-matrix.test.js` — 3 tests pinning error-semantics → protocol-code mapping.
- `py/tests/test_mcp.py` — 18 unit tests (symmetric to Node, including a host-profile regression test).
- `py/tests/test_conformance.py` — 8 tests loading `conformance/cases.json`.
- `py/tests/test_error_matrix.py` — 3 tests symmetric to the Node error matrix.

## Related projects

**Hosts (this skin generates from their schemas)**

- [nodejs-store](https://github.com/coenddt/nodejs-store) — Node (npm) host.
- py-store — Python (PyPI, `import py_store`) host.

**Sibling protocol skins (same schema source)**

- [store-api](https://github.com/coenddt/store-api) — REST.
- [store-graphql](https://github.com/coenddt/store-graphql) — GraphQL.
- [store-grpc](https://github.com/coenddt/store-grpc) — gRPC.
- [store-gateway](https://github.com/coenddt/store-gateway) — gateway / combiner.

**Engine & family**

- rust-store — the Rust core (GQL parsing / permissions / computed columns / command planning / SQL dialects; no IO).
- meta-store — control plane.
- create-store-app — scaffolding.
- store-rbac-bootstrap, store-resource-bootstrap — bootstrap plugins.

## License

MIT © 2026 丁滔. See [LICENSE](./LICENSE).
