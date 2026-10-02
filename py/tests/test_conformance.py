"""conformance 一致性测试 —— 加载 ../../conformance/cases.json（双端唯一断言事实源），
断言值逐字取自 JSON，本文件零内联期望（改断言先改 cases.json）。"""

import json
from pathlib import Path

import anyio
import pytest

from mock_store import mock_store
from store_mcp import create_server, filter_archived
from test_mcp import make_session

_CASES = Path(__file__).resolve().parents[2] / 'conformance' / 'cases.json'
cases = json.loads(_CASES.read_text(encoding='utf-8'))


def parse(result):
    assert result.content, '必须有 content'
    return json.loads(result.content[0].text)


@pytest.mark.anyio
async def test_surface_tool_names():
    store, _ = mock_store()
    async with await make_session(store) as s:
        tools = (await s.list_tools()).tools
        assert sorted(t.name for t in tools) == cases['surface']['expected_tool_names']
        assert len(tools) == cases['surface']['expected_count']


@pytest.mark.anyio
async def test_get_projection_and_miss():
    store, calls = mock_store()
    async with await make_session(store) as s:
        r = await s.call_tool(cases['get']['tool'], cases['get']['args'])
        assert not r.is_error
        assert parse(r) == cases['get']['hit_data']
        op, q, params = calls[0]
        assert op == cases['get']['expected_op']['py']
        assert q == cases['get']['expected_q']
        assert params == cases['get']['expected_params']

        miss = await s.call_tool(cases['get']['tool'], cases['get']['miss_args'])
        assert miss.is_error
        assert parse(miss)['code'] == cases['get']['miss_code']


@pytest.mark.anyio
async def test_list_q_handling():
    store, calls = mock_store()
    async with await make_session(store) as s:
        await s.call_tool(cases['list']['tool'], {})
        await s.call_tool(cases['list']['tool'], cases['list']['with_q_args'])
        assert calls[0][0] == cases['list']['empty_q_op']['py']
        assert calls[0][1] == cases['list']['empty_q_expected']
        assert calls[1][1] == cases['list']['with_q_expected_q']
        assert calls[1][2] == cases['list']['with_q_expected_params']


@pytest.mark.anyio
async def test_create_body_validation():
    store, calls = mock_store()
    async with await make_session(store) as s:
        await s.call_tool(cases['create']['tool'], cases['create']['args'])
        op, name, body = calls[0]
        assert op == cases['create']['expected_op']['py']
        assert name == cases['create']['expected_q']
        assert body == cases['create']['expected_params']
        bad = await s.call_tool(cases['create']['tool'], cases['create']['bad_args'])
        assert parse(bad)['code'] == cases['create']['bad_code']


@pytest.mark.anyio
async def test_update_and_remove_id_field():
    store, calls = mock_store()
    async with await make_session(store) as s:
        await s.call_tool(cases['update']['tool'], cases['update']['args'])
        await s.call_tool(cases['remove']['tool'], cases['remove']['args'])
        assert calls[0][0] == cases['update']['expected_op']['py']
        assert calls[0][1] == cases['update']['expected_q']
        assert calls[0][2] == cases['update']['expected_params']
        assert calls[0][3] == cases['update']['expected_set']
        assert calls[1][0] == cases['remove']['expected_op']['py']
        assert calls[1][2] == cases['remove']['expected_params']


@pytest.mark.anyio
async def test_query_profile_passthrough():
    store, calls = mock_store()
    entered = []

    async def t2q(fn):
        entered.append(True)
        return await fn()

    async with await make_session(store, text2query=t2q) as s:
        r = await s.call_tool(cases['query']['tool'], cases['query']['args'])
        assert not r.is_error
        assert entered, 'query 必须在 text2query 档内执行'
        op, q, params = calls[0]
        assert op == cases['query']['expected_op']['py']
        assert q == cases['query']['expected_q']
        assert params == cases['query']['expected_params']


@pytest.mark.anyio
async def test_error_mappings():
    store, _ = mock_store()

    async def boom(q, params=None, route_override=None):
        raise ValueError(cases['errors']['stable_prefix'] + '深度超限')

    store.query = boom

    async def passthrough(fn):
        return await fn()

    async with await make_session(store, text2query=passthrough) as s:
        r = await s.call_tool(cases['query']['tool'], cases['query']['args'])
        assert r.is_error
        err = parse(r)
        assert err['code'] == cases['errors']['plan_error_code']
        assert cases['errors']['stable_prefix'] in err['message']

    s2, _ = mock_store()

    class PermissionError(Exception):  # noqa: A001 —— 模拟宿主同名异常（跨包按名判定）
        pass

    async def denied(q, params=None, route_override=None):
        raise PermissionError('denied')

    s2.query_one = denied
    async with await make_session(s2) as s:
        r = await s.call_tool(cases['get']['tool'], cases['get']['args'])
        assert parse(r)['code'] == cases['errors']['permission_code']

    s3, _ = mock_store()

    class ProfileViolation(Exception):
        pass

    async def blocked(q, params=None, route_override=None):
        raise ProfileViolation('blocked')

    s3.query_one = blocked
    async with await make_session(s3) as s:
        r = await s.call_tool(cases['get']['tool'], cases['get']['args'])
        assert parse(r)['code'] == cases['errors']['profile_code']


def test_archive_filter_pure():
    assert filter_archived(cases['archive_filter']['input']) == cases['archive_filter']['expected']
