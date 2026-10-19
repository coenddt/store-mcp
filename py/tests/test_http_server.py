"""streamable HTTP 传输（A5）：真起 run_http（uvicorn 监听）+ 官方 SDK 客户端走 HTTP。

覆盖：tools/list 工具面、tools/call 进 store、ctx_from_request 每请求身份、
装配互斥守卫、非 endpoint 路径显式 404。
契约：doc/topic/store家族扩展/执行-处理中-05-store-mcp-http传输.md 4.2/4.3。
"""

import json
import socket
from contextlib import contextmanager

import anyio
import pytest
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from mock_store import mock_store, MOCK_DIGEST_FULL
from store_mcp import run_http


@contextmanager
def _passthrough_profile():
    """mock 档位上下文 —— 与 py_store.schema.text2query 逐字同形（@contextmanager 工厂）。"""
    yield


async def _stub_ask(question):
    from types import SimpleNamespace
    return SimpleNamespace(data=[], attempts=[], events=[])


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


async def _wait_ready(port: int, timeout: float = 10.0) -> None:
    deadline = anyio.current_time() + timeout
    while anyio.current_time() < deadline:
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=0.2):
                return
        except OSError:
            await anyio.sleep(0.02)
    raise TimeoutError(f'run_http 未在 {timeout}s 内监听 127.0.0.1:{port}')


def _parse(result):
    assert result.content, '必须有 content'
    return json.loads(result.content[0].text)


@pytest.mark.anyio
async def test_http_tools_list_and_call():
    store, calls = mock_store()
    port = _free_port()
    async with anyio.create_task_group() as tg:
        tg.start_soon(run_http, store, {
            'port': port, 'text2query': _passthrough_profile,
            'llm': 'gpt', 'ctx': {'userId': 'u1'}, 'host_ask': _stub_ask,
        })
        try:
            await _wait_ready(port)
            async with streamable_http_client(f'http://127.0.0.1:{port}/mcp') as streams:
                read_stream, write_stream = streams
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    tools = (await session.list_tools()).tools
                    names = [t.name for t in tools]
                    for expected in ('query', 'describe_schemas', 'ask'):
                        assert expected in names, f'tools/list 应含 {expected}'
                    assert len(tools) == 13  # 2 模型 × 5 + query + describe_schemas + ask

                    result = await session.call_tool('query', {'gql': 'User { name }'})
                    assert not result.is_error
                    assert _parse(result) == [{'_id': 'u1'}]
                    assert calls[0] == ['query', 'User { name }', None]
        finally:
            tg.cancel_scope.cancel()


@pytest.mark.anyio
async def test_http_ctx_from_request():
    store, _ = mock_store()
    seen = []
    orig = store.describe_for_ai

    def capture(ctx=None):
        seen.append(ctx)
        return orig(ctx)

    store.describe_for_ai = capture
    port = _free_port()

    async def hook(request):
        return {'user': 'alice', 'roles': ['admin']}

    async with anyio.create_task_group() as tg:
        tg.start_soon(run_http, store, {
            'port': port, 'text2query': _passthrough_profile, 'ctx_from_request': hook,
        })
        try:
            await _wait_ready(port)
            async with streamable_http_client(f'http://127.0.0.1:{port}/mcp') as streams:
                read_stream, write_stream = streams
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    result = await session.call_tool('describe_schemas', {})
                    assert not result.is_error
                    assert seen[-1] == {'user': 'alice', 'roles': ['admin']}
                    # ctx 非空 ⇒ mock 返回完整摘要（而非降级裸摘要）
                    assert _parse(result) == MOCK_DIGEST_FULL
        finally:
            tg.cancel_scope.cancel()


@pytest.mark.anyio
async def test_http_ctx_mutex():
    store, _ = mock_store()
    with pytest.raises(ValueError, match='互斥'):
        await run_http(store, {
            'text2query': _passthrough_profile,
            'ctx': {'userId': 'u1'},
            'ctx_from_request': lambda request: {'userId': 'u2'},
        })


@pytest.mark.anyio
async def test_http_unknown_path_404():
    import httpx2

    store, _ = mock_store()
    port = _free_port()
    async with anyio.create_task_group() as tg:
        tg.start_soon(run_http, store, {'port': port, 'text2query': _passthrough_profile})
        try:
            await _wait_ready(port)
            async with httpx2.AsyncClient() as client:
                resp = await client.post(f'http://127.0.0.1:{port}/nope', json={})
            assert resp.status_code == 404
            assert resp.json()['error'] == 'notFound'
        finally:
            tg.cancel_scope.cancel()
