# Changelog — store-mcp

本文件记录 store-mcp（node / py 双实现共用 spec）的契约变更。
格式遵循 Keep a Changelog；版本号由发布流程统一 bump。

## [Unreleased]

### Fixed

- **py HTTP 模式每请求 ctx 隔离**：`run_http` 不再覆写共享 `opts['ctx']`，改为每请求写入
  `ContextVar`（`_request_ctx`），handler 经 `_current_ctx()` 读取；并发请求 A/B 各持独立副本，
  不再出现「A 的 ask 读到 B 的身份」。与 node「每请求新 Server + 新 opts」等价。
- **`contextProvider` 抛错 → `unauthenticated`**：node / py 同步。非 `PermissionError` 的钩子异常
  不再回落 `planError`，message 原样透传；`PermissionError` 仍为 `permissionDenied`（spec/02）。
- **`profile_blocked` 反馈事件落地**：错误判定链第 1 层消费异常对象上的
  `type` / `event_type = "profile_blocked"`，映射 `profileBlocked`；
  `conformance/cases.json` 的 `profile_blocked_event_type` 由双端 conformance 测试消费。
