'use strict';

/**
 * 映射矩阵：每档错误语义 → MCP 协议面 code（A3「可程序化区分」验收）。
 * 直接调纯函数 errorOf（无需真实库/SDK），用例与 py/tests/test_error_matrix.py 同构。
 * 规范依据：spec/03-errors-context.md（Permission ⇒ permissionDenied；NoContext ⇒ noContext）。
 */

const { test } = require('node:test');
const assert = require('node:assert');

const { errorOf } = require('../src/index');

/** 显式 name 的 Error（跨包安全：判定按 name/code，不依赖 instanceof） */
function named(name, message) {
  const e = new Error(message);
  e.name = name;
  return e;
}

test('映射矩阵：Permission 档 → permissionDenied', () => {
  assert.equal(errorOf(named('PermissionError', '无访问权限')).code, 'permissionDenied');
});

test('映射矩阵：NoContext 档（name / code 两通道）→ noContext', () => {
  assert.equal(errorOf(named('NoContextError', '上下文缺失')).code, 'noContext');
  const byCode = new Error('上下文缺失');
  byCode.code = 'no_context';
  assert.equal(errorOf(byCode).code, 'noContext');
});

test('映射矩阵：core 字符串前缀通道 → 主码 planError + detailCode 承载具体语义', () => {
  let r = errorOf(new Error('ERR_PERMISSION:RBAC:无权写入'));
  assert.equal(r.code, 'planError');
  assert.equal(r.detailCode, 'permissionDenied');
  r = errorOf(new Error('ERR_NO_CONTEXT:上下文缺失'));
  assert.equal(r.code, 'planError');
  assert.equal(r.detailCode, 'noContext');

  const nf = errorOf(new Error('ERR_NOT_FOUND:行不存在'));
  assert.equal(nf.code, 'planError');
  assert.equal(nf.detailCode, 'not_found');
  assert.equal(nf.message, 'ERR_NOT_FOUND:行不存在');

  const rnf = errorOf(new Error('ERR_RESOURCE_NOT_FOUND:资源无任何可读副本'));
  assert.equal(rnf.code, 'planError');
  assert.equal(rnf.detailCode, 'not_found');

  const byCode = new Error('行不存在');
  byCode.code = 'ERR_NOT_FOUND';
  assert.equal(errorOf(byCode).code, 'planError');
  assert.equal(errorOf(byCode).detailCode, 'not_found');
});

test('映射矩阵：Other 档 → planError 透传原文（禁静默）', () => {
  const r = errorOf(new Error('boom'));
  assert.equal(r.code, 'planError');
  assert.equal(r.message, 'boom');
});