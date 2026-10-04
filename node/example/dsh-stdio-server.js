'use strict';

/**
 * dsh（DeepSeek Harness）可 spawn 的 store-mcp stdio 入口（示例/工具，非库语义，不发布）。
 *
 * 装配四步：① init 数据源 → ② 注册 schema → ③ setContext（text2query 档强制 ctx）→ ④ createStdioServer。
 * 生产接入：把 ①~③ 换成你的应用引导（schema 来源 / ctx 来源），④ 不变。
 *
 * 环境变量：
 *   MONGO_URI    默认 mongodb://127.0.0.1:27017/dsh_store
 *   STORE_SCHEMA 默认 ../../../nodejs-store/example/manager-transaction/schema.json
 *   STORE_USER   默认 dsh-user
 *   STORE_ROLES  默认 admin（逗号分隔）
 */

const fs = require('node:fs');
const path = require('node:path');

const { init, store, schema } = require('../../../nodejs-store'); // 仓内相邻；部署时改 require('nodejs-store')
const { createStdioServer } = require('../src');

async function main() {
  // ① 数据源（MongoDB 为语义基准；换后端只改这段）
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/dsh_store');
  await client.connect();
  await init(client.db());

  // ② 注册 schema（纯 JSON）
  const schemaPath = process.env.STORE_SCHEMA
    || path.resolve(__dirname, '../../../nodejs-store/example/manager-transaction/schema.json');
  for (const defn of JSON.parse(fs.readFileSync(schemaPath, 'utf8'))) schema.register(defn);

  // ③ 服务端受信上下文（text2query 档强制 ctx；LLM / 客户端零可触）
  const ctx = {
    userId: process.env.STORE_USER || 'dsh-user',
    roles: (process.env.STORE_ROLES || 'admin').split(','),
  };
  store.setContext(ctx);

  // ④ stdio 阻塞运行；不传 llm ⇒ 不注册 ask（避免「双模型翻译」）
  await createStdioServer(store, { ctx });
}

main().catch((e) => { console.error(String((e && e.stack) || e)); process.exit(1); });
