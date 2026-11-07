# Changelog — store-mcp（v0.4.x 维护线）

本文件只记录 v0.4.x 维护分支的补丁级变更；主干（含破坏性契约变更）见 `main` 的 CHANGELOG.md。

## [Unreleased] — 0.4.4

### Fixed

- **py HTTP 出口并发挂起**：旧实现全进程共享单个 `StreamableHTTPServerTransport`，两个客户端并发
  `initialize` 会互相阻塞（实测 >120s 无响应），串行正常。改用 SDK 官方
  `StreamableHTTPSessionManager(app, stateless=True)`，每请求新建 transport + 连接。
  串行调用的请求/响应逐字节不变，仅并发行为由「挂起」变为「正常」。
- **py 每请求 ctx 隔离**：旧实现把每请求 ctx 写回共享 `wire['ctx']`，并发下后到请求覆盖先到请求
  （实测两个并发请求都读到 `bob` 的身份）。改用 `contextvars.ContextVar`：asgi 每请求 `set`
  本请求 ctx，handler 经 `_current_ctx()` 读取，退出 `reset`。与 node「每请求新 Server + 新 opts」
  等价。单请求与串行场景行为不变。

### Tests

- 新增 `test_http_concurrent_ctx_isolation`：两个并发客户端分别以 `alice` / `bob` 身份调用
  `describe_schemas`，断言各归各（旧实现会串成同一身份）。

> 不在本维护线的改动（破坏性，随主干大版本）：`error_of` 的 core 前缀映射（`not_found` /
> `legacyCode` 命名）、`contextProvider` 抛错映射 `unauthenticated`、`profile_blocked` 事件码。
