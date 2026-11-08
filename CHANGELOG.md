# Changelog — store-mcp

本文件记录 store-mcp（node / py 双实现共用 spec）的契约变更。
格式遵循 Keep a Changelog；版本号由发布流程统一 bump。

## [Unreleased]

> 目标版本 **0.4.4**（未发布；版本号由发布流程统一 bump）。**单线发布**：`release/0.4.x` 维护分支已合回
> 主干并删除，不再双线——本轮没有破坏性变更，不需要维护线。

### Breaking

无。错误判定链的主码全部保持旧值（`planError` / `permissionDenied` / `profileBlocked`），
新语义放在新增字段 `detailCode` 上，按旧码分支的客户端不受影响。

### Added

- **`detailCode`（非破坏）**：错误对象新增具体语义字段，主码保持不变。取值：

  | `detailCode` | 何时出现 | 主码 |
  |---|---|---|
  | `unauthenticated` | `contextProvider` 抛非 `PermissionError` 异常 | `planError` |
  | `profileBlocked` | 异常对象带 `type` / `event_type = "profile_blocked"`（画像反馈拦截） | `planError` |
  | `permissionDenied` | core 前缀 `ERR_PERMISSION:` | `planError` |
  | `noContext` | core 前缀 `ERR_NO_CONTEXT:` | `planError` |
  | `not_found` | `ERR_NOT_FOUND:` / `ERR_RESOURCE_NOT_FOUND:` / `NOT_FOUND` 前缀 | `planError` |

  node / py 双端一致；`conformance/cases.json` 新增 `profile_blocked_detail_code` 由双端 conformance 消费。

### Fixed

- **py HTTP 模式每请求 ctx 隔离**：`run_http` 不再覆写共享 `opts['ctx']`，改为每请求写入
  `ContextVar`（`_request_ctx`），handler 经 `_current_ctx()` 读取；并发请求 A/B 各持独立副本，
  不再出现「A 的 ask 读到 B 的身份」。与 node「每请求新 Server + 新 opts」等价。
- **`contextProvider` 抛错：主码保持 `planError` + 新增 `detailCode`**：非 `PermissionError` 的钩子异常
  仍回 `planError`（不惊动按 `planError` 分支的下游），具体语义放 `detailCode: "unauthenticated"`，
  message 原样透传；`PermissionError` 仍为 `permissionDenied`（spec/02）。
- **`profile_blocked` 反馈事件落地**：错误判定链第 1 层消费异常对象上的
  `type` / `event_type = "profile_blocked"`；主码保持 `planError`（旧值），`detailCode: "profileBlocked"`。
- **core 前缀通道：主码 `planError` + `detailCode`**：`ERR_PERMISSION:` / `ERR_NO_CONTEXT:` /
  `ERR_NOT_FOUND:` / `ERR_RESOURCE_NOT_FOUND:` / `NOT_FOUND` 到达时，`code` 保持旧值 `planError`，
  具体语义放 `detailCode`（`permissionDenied` / `noContext` / `not_found`）；message 保留原前缀。
- **py HTTP 出口并发安全**：`StreamableHTTPSessionManager(stateless=True)` 取代共享单个
  `StreamableHTTPServerTransport` + 单次 `app.run`；两个客户端并发 `initialize` 不再挂起。
