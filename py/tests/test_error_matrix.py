"""映射矩阵：每档错误语义 → MCP 协议面 code（A3「可程序化区分」验收）。

直接调纯函数 error_of（无需真实库/SDK），用例与 node/test/error-matrix.test.js 同构。
规范依据：spec/03-errors-context.md（Permission ⇒ permissionDenied；NoContext ⇒ noContext）。
"""

from store_mcp import error_of


def _named(name: str, message: str) -> Exception:
    """显式 name 的异常（跨包安全：判定按 name/code，不依赖 isinstance）。"""
    e = Exception(message)
    e.name = name
    return e


def test_matrix_permission_to_permission_denied():
    assert error_of(_named("PermissionError", "无访问权限"))["code"] == "permissionDenied"


def test_matrix_no_context_to_no_context():
    assert error_of(_named("NoContextError", "上下文缺失"))["code"] == "noContext"
    by_code = Exception("上下文缺失")
    by_code.code = "no_context"
    assert error_of(by_code)["code"] == "noContext"


def test_matrix_other_to_plan_error():
    r = error_of(Exception("boom"))
    assert r["code"] == "planError"
    assert r["message"] == "boom"