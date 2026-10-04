"""store-mcp-py 测试 — 全部跑在 mock store + mcp SDK memory 流上，
零真实库、零宿主包依赖（语义一致性以 ../spec 为准；conformance/cases.json 见步骤 8）。

mcp 2.x 握手只协商 legacy 版本（实测 2025-11-25）：tools/call 裸调用即可；
add_request_handler 的 params_type 必须是 params 模型（CallToolRequestParams /
PaginatedRequestParams），传整 Request 模型会拿 params dict 去验 id/jsonrpc 而必拒。
"""

import json
from contextlib import contextmanager

import anyio
import pytest
from mcp import ClientSession
from mcp.shared.memory import create_client_server_memory_streams

from mock_store import mock_store, MOCK_DIGEST_FULL, MOCK_DIGEST_BARE
from store_mcp import (create_server, error_of, export_tools, filter_archived)

USER_PROJ = ' { name, full }'


async def make_session(store, **opts):
    """起 server（后台任务组）+ 已 initialize 的 ClientSession；用 async with 组合。"""
    if 'text2query' not in opts:
        opts['text2query'] = _passthrough_profile

    app = create_server(store, opts)['server']
    streams = create_client_server_memory_streams()

    class Ctx:
        async def __aenter__(self):
            self._cm = streams.__aenter__()
            cs, ss = await self._cm
            self._tg = anyio.create_task_group()
            await self._tg.__aenter__()
            self._tg.start_soon(app.run, ss[0], ss[1], app.create_initialization_options())
            self._session = ClientSession(cs[0], cs[1])
            await self._session.__aenter__()
            await self._session.initialize()
            return self._session

        async def __aexit__(self, *exc):
            await self._session.__aexit__(*exc)
            self._tg.cancel_scope.cancel()
            await self._tg.__aexit__(*exc)
            await streams.__aexit__(*exc)

    return Ctx()


def parse(result):
    assert result.content, '必须有 content'
    return json.loads(result.content[0].text)


# ── 1. 工具清单：归档过滤 + x-mcp hidden + query ──

@pytest.mark.anyio
async def test_tools_list():
    store, _ = mock_store()
    async with await make_session(store) as s:
        tools = (await s.list_tools()).tools
        names = sorted(t.name for t in tools)
        assert names == sorted([
            'create_Order', 'create_User', 'delete_Order', 'delete_User',
            'describe_schemas', 'get_Order', 'get_User', 'list_Order', 'list_User',
            'query', 'update_Order', 'update_User'])
        assert len(tools) == 12


@pytest.mark.anyio
async def test_ask_tool_registered_only_with_llm():
    store, _ = mock_store()

    async def host_ask(question):
        class R:
            data = [1]
            attempts = [{'rows': 1}]
            events = []
        return R()

    async with await make_session(store, llm='gpt', ctx={'userId': 'u1', 'roles': ['admin']},
                                  host_ask=host_ask) as s:
        tools = (await s.list_tools()).tools
        assert any(t.name == 'ask' for t in tools)


@pytest.mark.anyio
async def test_ask_guard_missing_ctx():
    store, _ = mock_store()
    with pytest.raises(RuntimeError, match='缺 opts\\["ctx"\\]'):
        create_server(store, {'llm': 'gpt', 'text2query': lambda fn: fn()})


# ── 2. get_X ──

@pytest.mark.anyio
async def test_get_user_projection_and_hit():
    store, calls = mock_store()
    async with await make_session(store) as s:
        r = await s.call_tool('get_User', {'id': 'u1'})
        assert not r.is_error
        assert parse(r) == {'_id': 'u1', 'name': 'Alice'}
        op, q, params = calls[0]
        assert op == 'query_one'
        assert q == f'User($condition: @c0){USER_PROJ}'
        assert params == {'c0': {'_id': 'u1'}}


@pytest.mark.anyio
async def test_get_user_not_found():
    store, _ = mock_store()
    async with await make_session(store) as s:
        r = await s.call_tool('get_User', {'id': 'nope'})
        assert r.is_error
        assert parse(r)['code'] == 'notFound'


# ── 3. list_X ──

@pytest.mark.anyio
async def test_list_user_q_handling():
    store, calls = mock_store()
    async with await make_session(store) as s:
        await s.call_tool('list_User', {})
        await s.call_tool('list_User', {'q': '($condition: @c1) -> { name }', 'params': {'c1': {'name': 'A'}}},
                          )
        assert calls[0][1] == f'User{USER_PROJ}'
        assert calls[1][1] == 'User($condition: @c1) -> { name }'
        assert calls[1][2] == {'c1': {'name': 'A'}}


# ── 4. create / update / delete ──

@pytest.mark.anyio
async def test_create_user_body_validation():
    store, calls = mock_store()
    async with await make_session(store) as s:
        r = await s.call_tool('create_User', {'body': {'name': 'Bob'}})
        assert parse(r)['_id'] == 'n1'
        assert calls[0] == ['insert', 'User', {'name': 'Bob'}]

        bad = await s.call_tool('create_User', {'body': [1, 2]})
        assert bad.is_error
        assert parse(bad)['code'] == 'invalidBody'


@pytest.mark.anyio
async def test_update_delete_user_id_field():
    store, calls = mock_store()
    async with await make_session(store) as s:
        await s.call_tool('update_User', {'id': 'u1', 'set': {'name': 'A2'}})
        await s.call_tool('delete_User', {'id': 'u1'})
        assert calls[0] == ['update', 'User', {'_id': 'u1'}, {'name': 'A2'}]
        assert calls[1] == ['remove', 'User', {'_id': 'u1'}]


# ── 5. query 工具：强制 text2query 档 ──

@pytest.mark.anyio
async def test_query_runs_in_text2query_profile():
    store, calls = mock_store()
    entered = []

    @contextmanager
    def t2q():
        entered.append(True)
        yield

    async with await make_session(store, text2query=t2q) as s:
        r = await s.call_tool('query', {'gql': 'User -> { name }', 'params': {}})
        assert not r.is_error
        assert entered, 'query 必须在 text2query 档内执行'
        assert calls[0] == ['query', 'User -> { name }', {}]


@pytest.mark.anyio
async def test_text2query_defaults_to_host():
    """缺省路径：本机 py-store 已装 ⇒ 从宿主 schema 模块取得 text2query，装配成功。

    （与 node 侧「缺失 ⇒ 装配期抛错」用例对称互补：py 环境宿主常驻，缺失场景
    由 create_server 守卫段的 RuntimeError 路径覆盖——opts 与宿主皆无时抛错。）
    """
    store, _ = mock_store()
    r = create_server(store, {})
    assert any(t['name'] == 'query' for t in r['tools'])


# ── 5b. describe_schemas：ctx 走 opts，摘要原样透传 ──

@pytest.mark.anyio
async def test_describe_schemas_ctx_switch():
    store, _ = mock_store()
    async with await make_session(store, ctx={'userId': 'u1', 'roles': []}) as s:
        full = await s.call_tool('describe_schemas', {})
        assert not full.is_error
        assert parse(full) == MOCK_DIGEST_FULL

    store2, _ = mock_store()
    async with await make_session(store2) as s:
        r = await s.call_tool('describe_schemas', {})
        assert not r.is_error
        assert parse(r) == MOCK_DIGEST_BARE


# ── 6. 错误透传 ──

@pytest.mark.anyio
async def test_err_prefix_passthrough():
    store, calls = mock_store()

    async def boom(q, params=None, route_override=None):
        raise ValueError('ERR_TEXT2QUERY:深度超限')

    store.query = boom

    async with await make_session(store) as s:
        r = await s.call_tool('query', {'gql': 'User'})
        assert r.is_error
        err = parse(r)
        assert err['code'] == 'planError'
        assert 'ERR_TEXT2QUERY:' in err['message'], '前缀必须原样保留'


@pytest.mark.anyio
async def test_permission_error_mapping_by_name():
    store, calls = mock_store()

    class PermissionError(Exception):  # noqa: A001 —— 模拟宿主同名异常（跨包按名判定）
        pass

    async def denied(q, params=None, route_override=None):
        raise PermissionError('denied')

    store.query_one = denied
    async with await make_session(store) as s:
        r = await s.call_tool('get_User', {'id': 'u1'})
        assert parse(r)['code'] == 'permissionDenied'


# ── 7. context_provider ──

@pytest.mark.anyio
async def test_context_provider_explicit_clear():
    store, calls = mock_store()
    async def provider(_meta):
        return None
    async with await make_session(store, context_provider=provider) as s:
        await s.call_tool('get_User', {'id': 'u1'})
        assert calls[0] == ['set_context', None]
        assert calls[1][0] == 'query_one'


# ── 8. export_tools：纯构建零 SDK 侧效应 ──

@pytest.mark.anyio
async def test_export_tools_matches_surface():
    store, _ = mock_store()
    async def host_ask(question):
        class R:
            data = []
            attempts = []
            events = []
        return R()
    tools = export_tools(store, {'llm': 'gpt', 'ctx': {'userId': 'u1'}, 'host_ask': host_ask})
    assert sum(1 for t in tools if t['name'] == 'ask') == 1
    assert len(tools) == 13  # 2 模型 × 5 + query + describe_schemas + ask


# ── 9. 纯函数：filter_archived / error_of ──

def test_filter_archived():
    assert filter_archived(['User', 'OrderDeleted', 'Order', 'StandaloneDeleted']) == \
        ['User', 'Order', 'StandaloneDeleted']


def test_error_of_known_names():
    class ProfileViolation(Exception):
        pass
    assert error_of(ProfileViolation('x'))['code'] == 'profileBlocked'
    assert error_of(ValueError('boom')) == {'code': 'planError', 'message': 'boom'}


@contextmanager
def _passthrough_profile():
    """mock 档位上下文——与 py_store.schema.text2query 逐字同形（@contextmanager 工厂）。"""
    yield


@pytest.mark.anyio
async def test_query_host_profile_actually_enters():
    """宿主兜底回归：opts 不注入时从 py_store.schema 取得真实 text2query
    （@contextmanager 工厂），query 执行期档位必须**真实进入**——mock store 内
    断言 core 判决面 get_profile()=='text2query'（此前 mock 走 async 回调形态，
    掩盖了 `with` 包裹缺失的缺陷，本用例堵住该回归）。"""
    from py_store.schema import get_profile
    store, calls = mock_store()

    async def spy_query(q, params=None, route_override=None):
        calls.append(['query', q, params, get_profile()])
        return [{'profile': get_profile()}]

    store.query = spy_query
    async with await make_session(store, text2query=False) as s:  # False ⇒ 走宿主兜底 import
        r = await s.call_tool('query', {'gql': 'User -> { name }'}, )
        assert not r.is_error, parse(r)
        assert calls[0][3] == 'text2query', 'query 必须真实进入 text2query 档'
        assert parse(r) == [{'profile': 'text2query'}]
