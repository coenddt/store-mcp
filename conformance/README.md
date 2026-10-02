# conformance — 跨运行时一致性用例

`cases.json` 是双端（`store-mcp-node` / `store-mcp-py`）共享的**唯一**断言事实源：工具清单、GQL 拼串、params 形状、错误码映射、归档过滤——同一份 JSON，双端测试各自加载执行，断言值逐字一致。

- Node：`cd node && npm test`（`test/conformance.test.js` 加载本目录 cases.json）
- Python：`cd py && pytest`（`tests/test_conformance.py` 加载本目录 cases.json）

约定：

1. 断言期望值**只写在这里**，双端测试文件不得内联副本（改断言先改本 JSON，再跑双端）。
2. 双端 API 名差异（如 `queryOne` vs `query_one`）用 `{"node", "py"}` 对象表达，语义同一。
3. v1 收编：三姊妹的 conformance runner 统一跑法（对齐 store-grpc「双端 runner 断言同一份 JSON」）。
