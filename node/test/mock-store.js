'use strict';

/**
 * 测试共享 mock store —— spec/00 端口契约的最小实现（conformance/cases.json 的
 * schema 假设与此处逐条对应；py 侧 tests/mock_store.py 同形）。
 */

function mockStore() {
  const docs = new Map([
    ['u1', { _id: 'u1', name: 'Alice' }],
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
    schemas,
    list: () => Object.keys(schemas),
    get: (n) => schemas[n] || null,
    query: async (q, params) => { calls.push(['query', q, params]); return [{ _id: 'u1' }]; },
    queryOne: async (q, params) => {
      calls.push(['queryOne', q, params]);
      return docs.get(params.c0._id) || null;
    },
    insert: async (name, body) => { calls.push(['insert', name, body]); return { _id: 'n1', ...body }; },
    update: async (name, loc, set) => { calls.push(['update', name, loc, set]); return 1; },
    remove: async (name, loc) => { calls.push(['remove', name, loc]); return 1; },
    setContext: async (c) => { calls.push(['setContext', c]); },
  };
}

module.exports = { mockStore };
