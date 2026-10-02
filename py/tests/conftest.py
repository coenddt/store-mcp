"""anyio pytest 插件配置：asyncio 后端（mcp SDK 依赖 anyio，自带 pytest 插件）。"""

import pytest


@pytest.fixture
def anyio_backend():
    return 'asyncio'
