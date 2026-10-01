'use strict';

/**
 * store-mcp-node 测试 — 全部跑在 mock store + SDK InMemoryTransport 上，
 * 零真实库、零宿主包依赖（语义一致性以 ../spec 为准；conformance/cases.json 见步骤 8）。
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const index = require('../src/index.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');

// ── mock store（spec/00 端口契约的最小实现）──

function mockStore() {
  const docs = new Map([
    ['u1', { _id: 'u1', name: 'Alice' }],
    ['o1', { _id: 'o1', total: 9 }],
  ]);
  const calls = [];
  const schemas = {
    User: { fields: { name: {} }, computes: { full: {} }, idField: '_id', description: '用户' },
    Order: { fields: { total: {} }, computes: {}, idField: '_id' },
    OrderDeleted: { fields: { total: {} }, computes: {}, idField: '_id' },
    SecretHidden: { fields: { s: {} }, computes: {}, 'x-mcp': { hidden: true } },
  };
  return {
    calls,
    docs,
    list: () => Object.keys(schemas),
    get: (n) => schemas[n] || null,
    query: async (q, params) => { calls.push(['query', q, params]); return [{ _id: 'u1' }]; },
    queryOne: async (q, params) => {
      calls.push(['queryOne', q, params]);
      return docs.get(params.c0[idFieldOf(q)]) || null;
    },
    insert: async (name, body) => { calls.push(['insert', name, body]); return { _id: 'n1', ...body }; },
    update: async (name, loc, set) => { calls.push(['update', name, loc, set]); return 1; },
    remove: async (name, loc) => { calls.push(['remove', name, loc]); return 1; },
    setContext: async (c) => { calls.push(['setContext', c]); },
  };
}

// 从 queryOne 的 GQL 里解析不出 idField，mock 直接按 _id 取（get_User 场景 idField 恒 _id）
function idFieldOf() { return '_id'; }

// ── 测试专用装配：低层 Server + InMemoryTransport（不占 stdio）──

async function start(store, opts = {}) {
  // 缺省注入 mock 档位上下文（不测装配守卫的用例不该被它干扰；守卫用例直接调 createServer）
  if (opts.text2query === undefined) opts.text2query = async (fn) => fn();
  const { server } = await index.createServer(store, opts);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { client, store };
}

const USER_PROJ = ' { name, full }';

// ── 1. 工具清单：归档过滤 + x-mcp hidden + query ──

test('tools/list: 2 模型 × 5 + query，归档表与 hidden 模型不出', async () => {
  const { client } = await start(mockStore());
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepStrictEqual(names, [
    'create_Order', 'create_User', 'delete_Order', 'delete_User',
    'get_Order', 'get_User', 'list_Order', 'list_User',
    'query', 'update_Order', 'update_User',
  ]);
  assert.strictEqual(tools.length, 11);
});

test('ask 工具：配 llm + ctx 才注册', async () => {
  const s = mockStore();
  const { client } = await start(s, {
    llm: 'gpt', ctx: { userId: 'u1', roles: ['admin'] },
    hostAsk: async () => ({ data: [1], attempts: [{ rows: 1 }], events: [] }),
  });
  const { tools } = await client.listTools();
  assert.ok(tools.some((t) => t.name === 'ask'), '配 llm 应注册 ask');
});

test('ask 装配守卫：配 llm 缺 ctx ⇒ 装配期抛错（fail-secure）', async () => {
  await assert.rejects(
    () => index.createServer(mockStore(), { llm: 'gpt', text2query: async (fn) => fn() }),
    /缺 opts\.ctx/);
});

// ── 2. get_X ──

test('get_User: 拼串 $condition: @c0 + proj（fields+computes）+ 命中', async () => {
  const s = mockStore();
  const { client } = await start(s);
  const r = await client.callTool({ name: 'get_User', arguments: { id: 'u1' } });
  assert.strictEqual(r.isError, undefined);
  assert.deepStrictEqual(JSON.parse(r.content[0].text), { _id: 'u1', name: 'Alice' });
  const [op, q, params] = s.calls[0];
  assert.strictEqual(op, 'queryOne');
  assert.strictEqual(q, `User($condition: @c0)${USER_PROJ}`);
  assert.deepStrictEqual(params, { c0: { _id: 'u1' } });
});

test('get_User: 查无 ⇒ isError + notFound（gRPC NOT_FOUND 同语义位）', async () => {
  const { client } = await start(mockStore());
  const r = await client.callTool({ name: 'get_User', arguments: { id: 'nope' } });
  assert.strictEqual(r.isError, true);
  const err = JSON.parse(r.content[0].text);
  assert.strictEqual(err.code, 'notFound');
});

// ── 3. list_X ──

test('list_User: q 空 ⇒ 服务端拼 schema 投影；q 非空 ⇒ name+q 且不追加投影', async () => {
  const s = mockStore();
  const { client } = await start(s);
  await client.callTool({ name: 'list_User', arguments: {} });
  await client.callTool({ name: 'list_User', arguments: { q: '($condition: @c1) -> { name }', params: { c1: { name: 'A' } } } });
  assert.strictEqual(s.calls[0][1], `User${USER_PROJ}`);
  assert.strictEqual(s.calls[1][1], 'User($condition: @c1) -> { name }');
  assert.deepStrictEqual(s.calls[1][2], { c1: { name: 'A' } });
});

// ── 4. create / update / delete ──

test('create_User: body 对象校验 + insert 透传', async () => {
  const s = mockStore();
  const { client } = await start(s);
  const r = await client.callTool({ name: 'create_User', arguments: { body: { name: 'Bob' } } });
  assert.strictEqual(JSON.parse(r.content[0].text)._id, 'n1');
  assert.deepStrictEqual(s.calls[0], ['insert', 'User', { name: 'Bob' }]);

  const bad = await client.callTool({ name: 'create_User', arguments: { body: [1, 2] } });
  assert.strictEqual(bad.isError, true);
  assert.strictEqual(JSON.parse(bad.content[0].text).code, 'invalidBody');
});

test('update_User / delete_User: idField 定位键', async () => {
  const s = mockStore();
  const { client } = await start(s);
  await client.callTool({ name: 'update_User', arguments: { id: 'u1', set: { name: 'A2' } } });
  await client.callTool({ name: 'delete_User', arguments: { id: 'u1' } });
  assert.deepStrictEqual(s.calls[0], ['update', 'User', { _id: 'u1' }, { name: 'A2' }]);
  assert.deepStrictEqual(s.calls[1], ['remove', 'User', { _id: 'u1' }]);
});

// ── 5. query 工具：强制 text2query 档 ──

test('query: 经 opts.text2query 档位上下文执行（沙箱强制）', async () => {
  const s = mockStore();
  let inProfile = false;
  const { client } = await start(s, {
    text2query: async (fn) => { inProfile = true; return fn(); },
  });
  const r = await client.callTool({ name: 'query', arguments: { gql: 'User -> { name }', params: {} } });
  assert.strictEqual(r.isError, undefined);
  assert.strictEqual(inProfile, true, 'query 必须在 text2query 档内执行');
  assert.deepStrictEqual(s.calls[0], ['query', 'User -> { name }', {}]);
});

test('text2query 缺失（注入与宿主皆无）⇒ 装配期抛错带指引', async () => {
  await assert.rejects(() => index.createServer(mockStore()), /text2query 档/);
});

// ── 6. 错误透传 ──

test('ERR_ 稳定前缀原样透传（禁改写禁摘要，spec/03）', async () => {
  const s = mockStore();
  s.query = async () => { throw new Error('ERR_TEXT2QUERY:深度超限'); };
  const { client } = await start(s, { text2query: async (fn) => fn() });
  const r = await client.callTool({ name: 'query', arguments: { gql: 'User' } });
  assert.strictEqual(r.isError, true);
  const err = JSON.parse(r.content[0].text);
  assert.strictEqual(err.code, 'planError');
  assert.ok(err.message.includes('ERR_TEXT2QUERY:'), '前缀必须原样保留');
});

test('宿主 ProfileViolation / PermissionError 按名判定映射（跨包安全）', async () => {
  const s = mockStore();
  s.queryOne = async () => { const e = new Error('denied'); e.name = 'PermissionError'; throw e; };
  const { client } = await start(s, { text2query: async (fn) => fn() });
  const r = await client.callTool({ name: 'get_User', arguments: { id: 'u1' } });
  assert.strictEqual(JSON.parse(r.content[0].text).code, 'permissionDenied');
});

// ── 7. contextProvider ──

test('contextProvider: 返回值 setContext 注入，undefined ⇒ 显式 setContext(null)', async () => {
  const s = mockStore();
  const { client } = await start(s, { text2query: async (fn) => fn(), contextProvider: async () => undefined });
  await client.callTool({ name: 'get_User', arguments: { id: 'u1' } });
  assert.deepStrictEqual(s.calls[0], ['setContext', null]);
  assert.strictEqual(s.calls[1][0], 'queryOne');
});

// ── 8. exportTools：纯构建零 SDK 侧效应 ──

test('exportTools: 与 createServer 的 tools 清单一致（同一 buildSurface）', async () => {
  const s = mockStore();
  const { tools } = index.exportTools(s, {
    llm: 'gpt', ctx: { userId: 'u1', roles: [] }, hostAsk: async () => ({}),
  });
  assert.strictEqual(tools.filter((t) => t.name === 'ask').length, 1);
  assert.strictEqual(tools.length, 12); // 2 模型 × 5 + query + ask
});

// ── 9. 纯函数：filterArchived（conformance 前置）──

test('filterArchived: 仅当存在去掉 Deleted 后缀的同名模型才过滤', () => {
  assert.deepStrictEqual(
    index.filterArchived(['User', 'OrderDeleted', 'Order', 'StandaloneDeleted']),
    ['User', 'Order', 'StandaloneDeleted']);
});
