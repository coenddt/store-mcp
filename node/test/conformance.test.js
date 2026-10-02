'use strict';

/**
 * conformance 一致性测试 —— 加载 ../../conformance/cases.json（双端唯一断言事实源），
 * 断言值逐字取自 JSON，本文件零内联期望（改断言先改 cases.json）。
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const index = require('../src/index.js');
const { mockStore } = require('./mock-store.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');

const cases = require(path.join(__dirname, '..', '..', 'conformance', 'cases.json'));

async function start(store, opts = {}) {
  if (opts.text2query === undefined) opts.text2query = async (fn) => fn();
  const { server } = await index.createServer(store, opts);
  const client = new Client({ name: 'conformance', version: '0.0.0' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { client, store };
}

const parse = (r) => JSON.parse(r.content[0].text);

test('conformance/surface: 工具清单与投影逐字一致', async () => {
  const { client } = await start(mockStore());
  const { tools } = await client.listTools();
  assert.deepStrictEqual(tools.map((t) => t.name).sort(), cases.surface.expected_tool_names);
  assert.strictEqual(tools.length, cases.surface.expected_count);
  const listUser = tools.find((t) => t.name === 'list_User');
  assert.ok(listUser);
});

test('conformance/get: 拼串 + params + 命中 + notFound', async () => {
  const s = mockStore();
  const { client } = await start(s);
  const r = await client.callTool({ name: cases.get.tool, arguments: cases.get.args });
  assert.strictEqual(r.isError, undefined);
  assert.deepStrictEqual(parse(r), cases.get.hit_data);
  const [op, q, params] = s.calls[0];
  assert.strictEqual(op, cases.get.expected_op.node);
  assert.strictEqual(q, cases.get.expected_q);
  assert.deepStrictEqual(params, cases.get.expected_params);

  const miss = await client.callTool({ name: cases.get.tool, arguments: cases.get.miss_args });
  assert.strictEqual(miss.isError, true);
  assert.strictEqual(parse(miss).code, cases.get.miss_code);
});

test('conformance/list: 空 q 走投影、非空 q 原样拼接', async () => {
  const s = mockStore();
  const { client } = await start(s);
  await client.callTool({ name: cases.list.tool, arguments: {} });
  await client.callTool({ name: cases.list.tool, arguments: cases.list.with_q_args });
  assert.strictEqual(s.calls[0][0], cases.list.empty_q_op.node);
  assert.strictEqual(s.calls[0][1], cases.list.empty_q_expected);
  assert.strictEqual(s.calls[1][1], cases.list.with_q_expected_q);
  assert.deepStrictEqual(s.calls[1][2], cases.list.with_q_expected_params);
});

test('conformance/create: insert 透传 + body 对象校验', async () => {
  const s = mockStore();
  const { client } = await start(s);
  await client.callTool({ name: cases.create.tool, arguments: cases.create.args });
  const [op, name, body] = s.calls[0];
  assert.strictEqual(op, cases.create.expected_op.node);
  assert.strictEqual(name, cases.create.expected_q);
  assert.deepStrictEqual(body, cases.create.expected_params);
  const bad = await client.callTool({ name: cases.create.tool, arguments: cases.create.bad_args });
  assert.strictEqual(parse(bad).code, cases.create.bad_code);
});

test('conformance/update+remove: idField 定位键', async () => {
  const s = mockStore();
  const { client } = await start(s);
  await client.callTool({ name: cases.update.tool, arguments: cases.update.args });
  await client.callTool({ name: cases.remove.tool, arguments: cases.remove.args });
  assert.strictEqual(s.calls[0][0], cases.update.expected_op.node);
  assert.strictEqual(s.calls[0][1], cases.update.expected_q);
  assert.deepStrictEqual(s.calls[0][2], cases.update.expected_params);
  assert.deepStrictEqual(s.calls[0][3], cases.update.expected_set);
  assert.strictEqual(s.calls[1][0], cases.remove.expected_op.node);
  assert.deepStrictEqual(s.calls[1][2], cases.remove.expected_params);
});

test('conformance/query: 强制 text2query 档 + 透传', async () => {
  const s = mockStore();
  let inProfile = false;
  const { client } = await start(s, {
    text2query: async (fn) => { inProfile = true; return fn(); },
  });
  const r = await client.callTool({ name: cases.query.tool, arguments: cases.query.args });
  assert.strictEqual(r.isError, undefined);
  assert.strictEqual(inProfile, true);
  const [op, q, params] = s.calls[0];
  assert.strictEqual(op, cases.query.expected_op.node);
  assert.strictEqual(q, cases.query.expected_q);
  assert.deepStrictEqual(params, cases.query.expected_params);
});

test('conformance/errors: 稳定前缀原样透传 + 同名异常映射', async () => {
  const s = mockStore();
  s.query = async () => { throw new Error(cases.errors.stable_prefix + '深度超限'); };
  const { client } = await start(s);
  const r = await client.callTool({ name: cases.query.tool, arguments: cases.query.args });
  assert.strictEqual(r.isError, true);
  const err = parse(r);
  assert.strictEqual(err.code, cases.errors.plan_error_code);
  assert.ok(err.message.includes(cases.errors.stable_prefix));

  const s2 = mockStore();
  s2.queryOne = async () => {
    const e = new Error('denied');
    e.name = cases.errors.permission_exception;
    throw e;
  };
  const { client: c2 } = await start(s2);
  const r2 = await c2.callTool({ name: cases.get.tool, arguments: cases.get.args });
  assert.strictEqual(parse(r2).code, cases.errors.permission_code);

  const s3 = mockStore();
  s3.queryOne = async () => {
    const e = new Error('blocked');
    e.name = cases.errors.profile_exception;
    throw e;
  };
  const { client: c3 } = await start(s3);
  const r3 = await c3.callTool({ name: cases.get.tool, arguments: cases.get.args });
  assert.strictEqual(parse(r3).code, cases.errors.profile_code);
});

test('conformance/archive_filter: 纯函数逐字一致', () => {
  assert.deepStrictEqual(
    index.filterArchived(cases.archive_filter.input),
    cases.archive_filter.expected);
});
