# 03 — 错误映射与上下文

一切工具失败都以 MCP `isError: true` 显式返回，禁静默失守、禁空结果兜底、禁降级重试（no-error-masking；「查无」也是确定性结果，不是错误，见下）。

## 错误判定链（顺序固定）

tool 执行异常按序判定，命中即止：

| 序 | 条件 | 码 | message |
|---|---|---|---|
| 1 | 宿主反馈事件 `profile_blocked`（core 未拦住本身就是告警信号） | `profileBlocked` | 事件 message 原样 |
| 2 | 宿主 `PermissionError` | `permissionDenied` | str(e) 原样 |
| 3 | 宿主 `ProfileViolation` | `profileBlocked` | str(e) 原样 |
| 4 | 入参语义违例（spec/02 解析规则） | `invalidParam` / `invalidBody` | 指明字段与要求 |
| 5 | `get_X` 返回 `null` | `notFound` | `User <id> not found` |
| 6 | 宿主 `AskExhausted` | `askExhausted` | 异常消息原样（已内嵌最后一轮结构化错误与轨迹指引） |
| 7 | 其余一切异常 | `planError` | str(e) 原样 |

判定链对齐宿主 ask 的 `_error_from_exception` 先例（py:229–239 / js:240–251），差异仅两点：皮肤多「入参违例」与「notFound」两类协议面错误——它们是 MCP 协议语义，不是 store 语义。

## core 稳定错误前缀：原样透传

core / Host 的稳定前缀（`ERR_GQL_PARSE:`、`ERR_TEXT2QUERY:`、`ERR_LIMIT:` 等）**原样保留在 message 内**，禁改写、禁摘要、禁剥前缀。AI 客户端（及上游 Agent）按前缀编程的链路依赖这些前缀的稳定性（`AI能力接入设计-L1问数档.md` A6：Host 按**前缀**映射，不对文案做脆弱匹配——皮肤必须维护同一契约）。

## 错误响应形状

```json
{
  "isError": true,
  "content": [{ "type": "text", "text": "{\"code\":\"profileBlocked\",\"message\":\"...ERR_TEXT2QUERY:...\"}" }]
}
```

- text 恒为 JSON 对象编码（`{"code", "message"}`），客户端可稳定解析；
- `code` 恒为判定链表中的稳定枚举，禁自由发挥；
- 前缀信息在 message 里，双层都稳定。

## 成功响应形状

```json
{ "content": [{ "type": "text", "text": "<JSON.stringify(data)>" }] }
```

- 成功响应**不含任何 error 键**（成功态无错误文案——no-error-masking 正向断言，对齐宿主 AskResult 轨迹契约）；
- `get_X` 查无不是成功也不是崩溃：走 `notFound` isError（gRPC NOT_FOUND 同语义位）；
- `ask` 成功的 text 为 `{data, attempts, events}` 三键 JSON（attempts 末轮无 error 键，宿主已保证）。

## 上下文（ctx）

- `opts.ctx`（`{userId, roles}`）只服务 `ask` 工具；经宿主 `ask()` 的 `scoped_context` / `scopedContext` 进入执行面，皮肤零经手、零持久化；
- `opts.contextProvider` 钩子语义见 spec/02（含显式 `setContext(null)` 清除义务）；
- fail-secure 继承：`ask` 配 llm 缺 ctx ⇒ 装配期抛错；core 档位门禁无 ctx 即拒——两层各就其位，皮肤不做第三层重复拦截（宿主/ core 已兜住，皮肤加了反而制造语义分叉）。

## 反馈事件（feedback）

宿主 `feedback.set_sink` 为进程级全局：皮肤**只在 ask 工具执行期间**接管 sink 并恢复（对齐宿主 ask 内部做法），禁止装配期永久接管（会吞掉部署方自己的反馈监听）。`query` / CRUD 工具执行期的反馈事件走进程缺省 sink（stderr），皮肤不拦截不转发——拦截属于 v1 的 per-call 事件面。
