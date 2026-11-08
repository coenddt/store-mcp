# 03 — 错误映射与上下文

一切工具失败都以 MCP `isError: true` 显式返回，禁静默失守、禁空结果兜底、禁降级重试（no-error-masking；「查无」也是确定性结果，不是错误，见下）。

## 错误判定链（顺序固定）

tool 执行异常按序判定，命中即止：

| 序 | 条件 | 码 | message |
|---|---|---|---|
| 1 | 宿主反馈事件 `profile_blocked`（异常对象携带 `type` / `event_type = "profile_blocked"`；core 未拦住本身就是告警信号） | `planError` + `detailCode: "profileBlocked"` | 事件 message 原样 |
| 2 | 宿主 `PermissionError` | `permissionDenied` | str(e) 原样 |
| 3 | 宿主 `NoContextError`（`requireContext` 开启且 ctx 缺失；core machine code `no_context`，与权限类同档 ⇒ 403） | `noContext` | str(e) 原样 |
| 4 | 宿主 `ProfileViolation` | `profileBlocked` | str(e) 原样 |
| 5 | 宿主/ core 以稳定前缀到达：`ERR_PERMISSION:` | `planError` + `detailCode: "permissionDenied"` | str(e) 原样（保留前缀） |
| 6 | 稳定前缀 `ERR_NO_CONTEXT:`（与 machine code `no_context` 同语义） | `planError` + `detailCode: "noContext"` | str(e) 原样 |
| 7 | 未找到：machine code `NOT_FOUND` / `ERR_NOT_FOUND`，或前缀 `ERR_NOT_FOUND:` / `ERR_RESOURCE_NOT_FOUND:` | `planError` + `detailCode: "not_found"` | str(e) 原样（保留前缀） |
| 8 | 入参语义违例（spec/02 解析规则） | `invalidParam` / `invalidBody` | 指明字段与要求 |
| 9 | `get_X` 返回 `null` | `not_found` | `User <id> not found` |
| 10 | 宿主 `AskExhausted` | `askExhausted` | 异常消息原样（已内嵌最后一轮结构化错误与轨迹指引） |
| 11 | 其余一切异常 | `planError` | str(e) 原样 |

> 第 5~7 层是本轮补齐的：宿主 `PermissionError` / `NoContextError` 类型判定（第 2/3 层）之外，core 还可能以**字符串前缀**（跨包 / 字符串通道宿主）到达；缺此层会让权限拒绝与「查无」被兜成 `planError`，与「前缀映射契约」及 no-error-masking 的跨语义兜底禁令冲突。`invalidParam` / `invalidBody` 是皮肤侧 `SkinError`，在 SkinError 分支内处理，不受本层影响。
>
> **兼容化口径（本轮）**：第 1 / 5 / 6 / 7 层在上一个发布版本统一落到 `planError`。为不惊动按 `planError` 分支的下游，**主码保持 `planError`**，具体语义放新增字段 `detailCode`（`profileBlocked` / `permissionDenied` / `noContext` / `not_found`）。`code` 仍是既有枚举；`detailCode` 为新增可选字段，缺失即旧行为。第 2/3/4/9 层的既有主码不变。

判定链对齐宿主 ask 的 `_error_from_exception` 先例（py:229–239 / js:240–251），差异仅两点：皮肤多「入参违例」与「`not_found`」两类协议面错误——它们是 MCP 协议语义，不是 store 语义。

> 命名对齐 A1 错误族：machine code 用 snake_case（`not_found`），与 REST `error.code`、gRPC trailer `store-error-code` 同码表。为不破坏既有调用方，`not_found` 响应额外带 `legacyCode: "notFound"`（过渡字段，下游完成迁移后可移除）；HTTP 未知路径 404 同理带 `legacyError: "notFound"`。

## core 稳定错误前缀：原样透传

core / Host 的稳定前缀（`ERR_GQL_PARSE:`、`ERR_TEXT2QUERY:`、`ERR_LIMIT:` 等）**原样保留在 message 内**，禁改写、禁摘要、禁剥前缀。AI 客户端（及上游 Agent）按前缀编程的链路依赖这些前缀的稳定性（`AI能力接入设计-L1问数档.md` A6：Host 按**前缀**映射，不对文案做脆弱匹配——皮肤必须维护同一契约）。

## 错误响应形状

```json
{
  "isError": true,
  "content": [{ "type": "text", "text": "{\"code\":\"planError\",\"detailCode\":\"profileBlocked\",\"message\":\"...ERR_TEXT2QUERY:...\"}" }]
}
```

- text 恒为 JSON 对象编码（`{"code", "message", "detailCode"?}`），客户端可稳定解析；
- `code` 恒为判定链表中的稳定枚举，禁自由发挥；
- `detailCode` 仅在「主码需保持旧值」的兼容场景出现（第 1/5/6/7 层），承载具体语义；不出现即旧行为；
- 前缀信息在 message 里，双层都稳定。

## 成功响应形状

```json
{ "content": [{ "type": "text", "text": "<JSON.stringify(data)>" }] }
```

- 成功响应**不含任何 error 键**（成功态无错误文案——no-error-masking 正向断言，对齐宿主 AskResult 轨迹契约）；
- `get_X` 查无不是成功也不是崩溃：走 `not_found` isError（gRPC NOT_FOUND 同语义位）；
- `ask` 成功的 text 为 `{data, attempts, events}` 三键 JSON（attempts 末轮无 error 键，宿主已保证）。

## 上下文（ctx）

- `opts.ctx`（`{userId, roles}`）只服务 `ask` 工具；经宿主 `ask()` 的 `scoped_context` / `scopedContext` 进入执行面，皮肤零经手、零持久化；
- `opts.contextProvider` 钩子语义见 spec/02（含显式 `setContext(null)` 清除义务）；
- fail-secure 继承：`ask` 配 llm 缺 ctx ⇒ 装配期抛错；core 档位门禁无 ctx 即拒——两层各就其位，皮肤不做第三层重复拦截（宿主/ core 已兜住，皮肤加了反而制造语义分叉）。

## 反馈事件（feedback）

宿主 `feedback.set_sink` 为进程级全局：皮肤**只在 ask 工具执行期间**接管 sink 并恢复（对齐宿主 ask 内部做法），禁止装配期永久接管（会吞掉部署方自己的反馈监听）。`query` / CRUD 工具执行期的反馈事件走进程缺省 sink（stderr），皮肤不拦截不转发——拦截属于 v1 的 per-call 事件面。
