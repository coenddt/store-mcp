'use strict';

/**
 * streamable HTTP 传输（A5）：真起 node:http 监听 + 官方 SDK 客户端走 HTTP。
 * 覆盖：tools/list 工具面、tools/call 进 store、ctxFromRequest 每请求身份、
 * 装配互斥守卫、端口占用原样抛出、非 endpoint 路径显式 404。
 * 契约：doc/topic/store家族扩展/执行-处理中-05-store-mcp-http传输.md 4.1/4.3。
 */

const test = require('node:test');
const assert = require('node:assert');

const index = require('../src/index.js');
const { mockStore } = require('./mock-store.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

// ── 起真实 HTTP 监听（port: 0 随机）并接上官方客户端 ──

async function startHttp(store, opts = {}) {
  const h = await index.createHttpServer(store, { text2query: async (fn) => fn(), ...opts, port: 0 });
  const { port } = h.server.address();
  const url = `http://127.0.0.1:${port}${h.endpoint}`;
  const client = new Client({ name: 'http-test', version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return { h, client, url };
}

async function stop({ h, client }) {
  await client.close();
  await h.close();
}

test('HTTP tools/list: 含 query / describe_schemas / ask（同一 buildSurface）', async () => {
  const s = mockStore();
  const hdl = await startHttp(s, {
    llm: 'gpt',
    ctx: { userId: 'u1', roles: ['admin'] },
    hostAsk: async () => ({ data: [1], attempts: [{ rows: 1 }], events: [] }),
  });
  try {
    const { tools } = await hdl.client.listTools();
    const names = tools.map((t) => t.name);
    for (const expected of ['query', 'describe_schemas', 'ask']) {
      assert.ok(names.includes(expected), `tools/list 应含 ${expected}`);
    }
    assert.strictEqual(tools.length, 13); // 2 模型 × 5 + query + describe_schemas + ask
  } finally {
    await stop(hdl);
  }
});

test('HTTP tools/call query: 成功负载为 store 数据，调用落到 store.query', async () => {
  const s = mockStore();
  const hdl = await startHttp(s);
  try {
    const r = await hdl.client.callTool({ name: 'query', arguments: { gql: 'User { name }' } });
    assert.strictEqual(r.isError, undefined);
    assert.deepStrictEqual(JSON.parse(r.content[0].text), [{ _id: 'u1' }]);
    assert.deepStrictEqual(s.calls[0], ['query', 'User { name }', undefined]);
  } finally {
    await stop(hdl);
  }
});

test('HTTP ctxFromRequest: 每请求钩子的返回值到达工具上下文', async () => {
  const s = mockStore();
  let seen = null;
  const orig = s.describeForAi;
  s.describeForAi = (ctx) => { seen = ctx; return orig(ctx); };
  const hdl = await startHttp(s, {
    ctxFromRequest: async () => ({ user: 'alice', roles: ['admin'] }),
  });
  try {
    const r = await hdl.client.callTool({ name: 'describe_schemas', arguments: {} });
    assert.strictEqual(r.isError, undefined);
    assert.deepStrictEqual(seen, { user: 'alice', roles: ['admin'] });
    // ctx 非空 ⇒ mock 返回完整摘要（而非降级裸摘要）
    assert.deepStrictEqual(JSON.parse(r.content[0].text),
      [{ name: 'User', fields: { name: 'string', age: 'int' } }]);
  } finally {
    await stop(hdl);
  }
});

test('装配守卫: ctx 与 ctxFromRequest 同给 ⇒ 抛错（禁静默择一）', async () => {
  await assert.rejects(
    () => index.createHttpServer(mockStore(), {
      text2query: async (fn) => fn(),
      ctx: { userId: 'u1' },
      ctxFromRequest: async () => ({ userId: 'u2' }),
      port: 0,
    }),
    /互斥/);
});

test('端口占用: 第二个监听原样抛 EADDRINUSE（不静默换端口）', async () => {
  const first = await startHttp(mockStore());
  try {
    const port = first.h.server.address().port;
    await assert.rejects(
      () => index.createHttpServer(mockStore(), { text2query: async (fn) => fn(), port }),
      (e) => e.code === 'EADDRINUSE');
  } finally {
    await stop(first);
  }
});

test('非 endpoint 路径 ⇒ 404 + 结构化错误（禁静默空响应）', async () => {
  const hdl = await startHttp(mockStore());
  try {
    const wrong = new URL(hdl.url);
    wrong.pathname = '/nope';
    const res = await fetch(wrong, { method: 'POST' });
    assert.strictEqual(res.status, 404);
    const body = await res.json();
    assert.strictEqual(body.error, 'notFound');
  } finally {
    await stop(hdl);
  }
});
