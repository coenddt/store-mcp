'use strict';

/**
 * store-mcp-node — 为 nodejs-store 已注册 schema 自动生成 MCP 工具面。
 *
 * 语义依据：../spec/*.md（双端 parity，改动先改 spec）。
 * 设计哲学：MCP 只是 GQL 的又一层 AI 客户端皮肤 —— 适配层零语义发明。
 * 双出口：
 *   exportTools(store, opts)        → { tools }（纯构建，零 SDK 依赖，永远可用）
 *   createStdioServer(store, opts)  → stdio 阻塞运行（同一份工具清单做 tools/list，
 *                                     call 经 spec/02 映射表进 store 原生 API）
 *
 * store 端口契约见 spec/00：list/get/query/queryOne/insert/update/remove/setContext；
 * 档位上下文 text2query（query 工具强制沙箱）取用顺序：opts.text2query → require('nodejs-store')。
 */

const ARCHIVE_SUFFIX = 'Deleted';

// ── spec/01：归档表过滤（与 store-api / store-graphql / store-grpc 逐字一致）──
function filterArchived(names) {
  const set = new Set(names);
  return names.filter((n) => !(n.endsWith(ARCHIVE_SUFFIX) && set.has(n.slice(0, -ARCHIVE_SUFFIX.length))));
}

// ── spec/01：schema 投影（fields + computes 均视为字段，与 store-graphql 对齐）──
function schemaProjection(defn) {
  const fields = defn ? { ...(defn.fields || {}), ...(defn.computes || {}) } : null;
  const keys = fields ? Object.keys(fields) : [];
  return keys.length ? ` { ${keys.join(', ')} }` : '';
}

// ── spec/01：idField（缺省 _id，定位值原样透传）──
function idFieldOf(defn) {
  return (defn && defn.idField) || '_id';
}

// ── 协议面错误（spec/03 判定链的皮肤侧子集）──
class SkinError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SkinError';
    this.code = code;
  }
}

function assertObject(value, field) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new SkinError('invalidBody', `${field} 必须为 JSON 对象（数组/标量拒绝，spec/02）`);
  }
}

// ── spec/03：错误判定链（name 判定跨包安全，不依赖宿主 instanceof）──
function errorOf(e) {
  if (e && e.name === 'SkinError') return { code: e.code, message: e.message };
  if (e && e.name === 'AskExhausted') return { code: 'askExhausted', message: String(e.message) };
  if (e && e.name === 'PermissionError') return { code: 'permissionDenied', message: String(e.message) };
  if (e && e.name === 'ProfileViolation') return { code: 'profileBlocked', message: String(e.message) };
  return { code: 'planError', message: String((e && e.message) || e) };
}

// ── spec/01：工具清单构建（工具对象 + 入参 JSON Schema 直出，无需 zod）──
function obj(properties, required) {
  return { type: 'object', properties, required };
}

function modelTools(name, defn, description) {
  const desc = description || `${name}（MCP 工具面，由 schema 自动生成）`;
  const d = (s) => `${desc} — ${s}`;
  return [
    { name: `get_${name}`, description: d('按 id 查单条'), inputSchema: obj({ id: { type: 'string', description: '文档 id（原样透传）' } }, ['id']) },
    { name: `list_${name}`, description: d('列表查询：q 为自模型名始的 GQL 余部（与 REST ?q= 同源），空则按 schema 投影'), inputSchema: obj({ q: { type: 'string', description: 'GQL 余部，如 "($condition: @c0) -> { name }"' }, params: { type: 'object', description: 'GQL params（键 = 去掉 @ 的引用名）' } }, []) },
    { name: `create_${name}`, description: d('插入文档'), inputSchema: obj({ body: { type: 'object', description: '文档对象' } }, ['body']) },
    { name: `update_${name}`, description: d('按 id 定位后部分更新'), inputSchema: obj({ id: { type: 'string' }, set: { type: 'object', description: '待更新字段集' } }, ['id', 'set']) },
    { name: `delete_${name}`, description: d('按 id 定位删除'), inputSchema: obj({ id: { type: 'string' } }, ['id']) },
  ];
}

const QUERY_TOOL = {
  name: 'query',
  description: '全局 GQL 直查（只读沙箱：强制 text2query 档，core 硬限 1000 行 / 深度 3，禁 route_override）。gql 为自模型名始的完整 GQL 查询串，条件值一律参数化（@key 引用，值放 params）',
  inputSchema: obj({ gql: { type: 'string' }, params: { type: 'object' } }, ['gql']),
};

const ASK_TOOL = {
  name: 'ask',
  description: 'AI 问数（只读）：自然语言 → 宿主 ask() 编排（LLM 翻译 → text2query 档校验执行 → 失败结构化回喂重试）。成功返回 {data, attempts, events}；失败显式报错（不降级、不返回空结果）',
  inputSchema: obj({ question: { type: 'string', description: '自然语言问题' } }, ['question']),
};

/**
 * 收集工具面（归档过滤 + x-mcp 注记 + ask 启用守卫）。
 * @returns {{tools: object[], handlers: Map<string, Function>}}
 */
function buildSurface(store, opts = {}) {
  const names = opts.resources || filterArchived(store.list());
  const tools = [];
  const handlers = new Map();

  for (const name of names) {
    const defn = typeof store.get === 'function' ? store.get(name) : null;
    const xm = (defn && defn['x-mcp']) || {};
    if (xm.hidden) continue; // spec/01 注记：模型级 hidden
    const proj = schemaProjection(defn);
    const idField = idFieldOf(defn);
    const description = defn && defn.description;
    for (const t of modelTools(name, defn, description)) {
      if (tools.some((x) => x.name === t.name)) {
        throw new Error(`ERR_NAME_CONFLICT:工具名 "${t.name}" 冲突（spec/01）`);
      }
      tools.push(t);
      handlers.set(t.name, modelHandler(store, t.name, name, proj, idField));
    }
  }

  // spec/02：query 工具强制 text2query 档 —— 档位上下文取用顺序见文件头
  tools.push(QUERY_TOOL);
  handlers.set('query', queryHandler(store, opts));

  // spec/01：ask 仅 opts.llm 提供时注册；配 llm 缺 ctx 装配期抛错（fail-secure）
  if (opts.llm !== undefined && opts.llm !== null) {
    if (opts.ctx === undefined || opts.ctx === null) {
      throw new Error(
        'store-mcp: opts.llm 已提供但缺 opts.ctx —— ask 工具需要服务端用户上下文（如 {userId, roles}）；'
        + 'ctx 属受信参数，不进任何工具入参（D5）');
    }
    tools.push(ASK_TOOL);
    handlers.set('ask', askHandler(opts));
  }

  return { tools, handlers };
}

// ── spec/02：映射表 handler ──

function modelHandler(store, toolName, name, proj, idField) {
  const verb = toolName.slice(0, toolName.indexOf('_'));
  return async (args) => {
    switch (verb) {
      case 'get': {
        const row = await store.queryOne(`${name}($condition: @c0)${proj}`, { c0: { [idField]: args.id } }, null);
        if (row === null || row === undefined) {
          throw new SkinError('notFound', `${name} ${args.id} not found`);
        }
        return row;
      }
      case 'list':
        return store.query(args.q ? `${name}${args.q}` : `${name}${proj}`, args.params, null);
      case 'create':
        assertObject(args.body, 'body');
        return store.insert(name, args.body);
      case 'update':
        assertObject(args.set, 'set');
        return store.update(name, { [idField]: args.id }, args.set);
      case 'delete':
        return store.remove(name, { [idField]: args.id });
      default:
        throw new SkinError('planError', `未知工具动词: ${verb}`);
    }
  };
}

function queryHandler(store, opts) {
  return async (args) => {
    if (typeof args.gql !== 'string' || !args.gql.trim()) {
      throw new SkinError('invalidParam', 'gql 必须为非空字符串（自模型名始，spec/02）');
    }
    const t2q = opts.text2query; // createStdioServer 装配期已解析；exportTools 不执行无此键
    const run = () => store.query(args.gql, args.params, null); // routeOverride 恒 null（D5/CWE-639）
    if (typeof t2q === 'function') return t2q(run);
    return run(); // 测试注入路径之外不可达：装配期已守卫
  };
}

function askHandler(opts) {
  return async (args) => {
    if (typeof args.question !== 'string' || !args.question.trim()) {
      throw new SkinError('invalidParam', 'question 必须为非空自然语言字符串');
    }
    // 护栏零新增：档位/只读/回喂/硬限全在宿主 ask()；AskResult(data, attempts, events) 全量返回
    const r = await opts.hostAsk(args.question);
    return { data: r.data, attempts: r.attempts, events: r.events };
  };
}

// ── 双出口 ──

/**
 * 纯构建工具清单（零 SDK 依赖，永远可用；对齐 store-grpc buildProto 先例）。
 */
function exportTools(store, opts = {}) {
  return { tools: buildSurface(store, opts).tools };
}

/**
 * 装配 MCP Server（全部守卫在此，不绑传输——测试经 InMemoryTransport、v1 HTTP 经此复用）。
 */
async function createServer(store, opts = {}) {
  let sdk;
  try {
    sdk = {
      Server: require('@modelcontextprotocol/sdk/server/index.js').Server,
      Schemas: require('@modelcontextprotocol/sdk/types.js'),
    };
  } catch (e) {
    throw new Error(
      `store-mcp-node 缺承载依赖 @modelcontextprotocol/sdk（${e.message}）。`
      + '安装：npm i @modelcontextprotocol/sdk');
  }

  // spec/02：query 工具强制 text2query 档 —— opts.text2query 优先，缺省从宿主取，两者皆无 ⇒ 拒绝装配
  if (typeof opts.text2query !== 'function') {
    try {
      opts.text2query = require('nodejs-store').text2query;
    } catch (_) { /* 宿主未装：下方守卫统一裁决 */ }
    if (typeof opts.text2query !== 'function') {
      throw new Error(
        'store-mcp: query 工具强制 text2query 档（spec/02），但未取得档位上下文。'
        + '安装 nodejs-store 或传 opts.text2query（签名 fn(async fn) -> Promise）');
    }
  }
  if (opts.llm != null) {
    if (opts.ctx == null) throw new Error('store-mcp: opts.llm 已提供但缺 opts.ctx（fail-secure，spec/01）');
    if (typeof opts.hostAsk !== 'function') {
      try {
        const host = require('nodejs-store');
        opts.hostAsk = (q) => host.ask(q, { llm: opts.llm, ctx: opts.ctx });
      } catch (e) {
        throw new Error(`store-mcp: ask 工具需要宿主 nodejs-store（${e.message}）。安装：npm i nodejs-store`);
      }
    }
  }

  const { tools, handlers } = buildSurface(store, opts);
  const server = new sdk.Server(
    { name: opts.name || 'store-mcp', version: opts.version || '0.1.0' },
    { capabilities: { tools: {} } });

  server.setRequestHandler(sdk.Schemas.ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(sdk.Schemas.CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = req.params.arguments || {};
    const handler = handlers.get(name);
    try {
      if (!handler) throw new SkinError('invalidParam', `未知工具: ${name}`);
      if (opts.contextProvider) {
        const ctx = await opts.contextProvider(req.params._meta);
        await store.setContext(ctx === undefined ? null : ctx); // 显式清除语义，spec/02
      }
      const data = await handler(args);
      // 成功响应不含任何 error 键（spec/03 正向断言）
      return { content: [{ type: 'text', text: JSON.stringify(data === undefined ? null : data) }] };
    } catch (e) {
      const err = errorOf(e);
      return { isError: true, content: [{ type: 'text', text: JSON.stringify(err) }] };
    }
  });

  return { server, tools };
}

/**
 * stdio 阻塞运行：装配 + StdioServerTransport。
 */
async function createStdioServer(store, opts = {}) {
  const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
  const r = await createServer(store, opts);
  await r.server.connect(new StdioServerTransport());
  return r;
}

module.exports = { exportTools, createServer, createStdioServer, filterArchived, schemaProjection, buildSurface, errorOf };
