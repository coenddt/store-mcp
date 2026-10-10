"""store-mcp-py — 为 py-store 已注册 schema 自动生成 MCP 工具面。

语义依据：../spec/*.md（双端 parity，改动先改 spec）。
设计哲学：MCP 只是 GQL 的又一层 AI 客户端皮肤 —— 适配层零语义发明。
双出口：
    export_tools(store, opts)   → list[dict]（纯构建，零 SDK 依赖，永远可用）
    create_server(store, opts)  → 低层 Server（装配全部守卫，不绑传输）
    run_stdio(store, opts)      → stdio 阻塞运行（create_server + stdio_server）

store 端口契约见 spec/00：query / query_one / insert / update / remove / set_context；
元数据（list / get）走 opts.schema_module → duck(store.list/store.get) → py_store.schema；
档位上下文 text2query（query 工具强制沙箱）取用顺序：opts["text2query"] → py_store.schema。
"""

from __future__ import annotations

import json
from typing import Any

__all__ = ['export_tools', 'create_server', 'run_stdio',
           'filter_archived', 'schema_projection', 'build_surface', 'error_of']

ARCHIVE_SUFFIX = 'Deleted'


# ── spec/01：归档表过滤（与 store-api / store-graphql / store-grpc 逐字一致）──

def filter_archived(names: list[str]) -> list[str]:
    names_set = set(names)
    return [n for n in names
            if not (n.endswith(ARCHIVE_SUFFIX) and n[:-len(ARCHIVE_SUFFIX)] in names_set)]


# ── spec/01：schema 投影（fields + computes 均视为字段，与 store-graphql 对齐）──

def schema_projection(defn: dict | None) -> str:
    if not defn:
        return ''
    keys = list({**(defn.get('fields') or {}), **(defn.get('computes') or {})})
    return f' {{ {", ".join(keys)} }}' if keys else ''


def id_field_of(defn: dict | None) -> str:
    return (defn or {}).get('idField') or '_id'


# ── 协议面错误（spec/03 判定链的皮肤侧子集）──

class SkinError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _assert_object(value: Any, field: str) -> None:
    if not isinstance(value, dict):
        raise SkinError('invalidBody', f'{field} 必须为 JSON 对象（数组/标量拒绝，spec/02）')


# ── spec/03：错误判定链（类名判定跨包安全，不依赖宿主 isinstance）──

def error_of(e: BaseException) -> dict:
    name = getattr(e, 'name', None) or e.__class__.__name__
    if name == 'SkinError':
        return {'code': e.code, 'message': str(e)}  # type: ignore[attr-defined]
    if name == 'AskExhausted':
        return {'code': 'askExhausted', 'message': str(e)}
    if name == 'PermissionError':
        return {'code': 'permissionDenied', 'message': str(e)}
    if name == 'NoContextError' or getattr(e, 'code', None) == 'no_context':
        return {'code': 'noContext', 'message': str(e)}
    if name == 'ProfileViolation':
        return {'code': 'profileBlocked', 'message': str(e)}
    return {'code': 'planError', 'message': str(e)}


# ── 元数据 provider（spec/00：opts.schema_module → duck → py_store.schema）──

def _meta_provider(store: Any, opts: dict):
    module = opts.get('schema_module')
    if module is not None:
        return module
    if hasattr(store, 'list') and hasattr(store, 'get'):
        return store
    try:
        from py_store import schema
        return schema
    except ImportError as e:
        raise RuntimeError(
            'store-mcp: 取不到 schema 元数据（store 无 list/get，且未安装 py_store）。'
            '传 opts["schema_module"] 或安装 py-store') from e


# ── spec/01：工具清单构建（纯 JSON Schema 直出）──

def _obj(properties: dict, required: list[str]) -> dict:
    return {'type': 'object', 'properties': properties, 'required': required}


def model_tools(name: str, defn: dict | None, description: str | None) -> list[dict]:
    desc = description or f'{name}（MCP 工具面，由 schema 自动生成）'
    d = lambda s: f'{desc} — {s}'  # noqa: E731
    return [
        {'name': f'get_{name}', 'description': d('按 id 查单条'),
         'inputSchema': _obj({'id': {'type': 'string', 'description': '文档 id（原样透传）'}}, ['id'])},
        {'name': f'list_{name}', 'description': d('列表查询：q 为自模型名始的 GQL 余部（与 REST ?q= 同源），空则按 schema 投影'),
         'inputSchema': _obj({'q': {'type': 'string', 'description': 'GQL 余部，如 "($condition: @c0) -> { name }"'},
                              'params': {'type': 'object', 'description': 'GQL params（键 = 去掉 @ 的引用名）'}}, [])},
        {'name': f'create_{name}', 'description': d('插入文档'),
         'inputSchema': _obj({'body': {'type': 'object', 'description': '文档对象'}}, ['body'])},
        {'name': f'update_{name}', 'description': d('按 id 定位后部分更新'),
         'inputSchema': _obj({'id': {'type': 'string'},
                              'set': {'type': 'object', 'description': '待更新字段集'}}, ['id', 'set'])},
        {'name': f'delete_{name}', 'description': d('按 id 定位删除'),
         'inputSchema': _obj({'id': {'type': 'string'}}, ['id'])},
    ]


QUERY_TOOL = {
    'name': 'query',
    'description': ('全局 GQL 直查（只读沙箱：强制 text2query 档，core 硬限 1000 行 / 深度 3，'
                    '禁 route_override）。gql 为自模型名始的完整 GQL 查询串，条件值一律参数化（@key 引用，值放 params）'),
    'inputSchema': _obj({'gql': {'type': 'string'}, 'params': {'type': 'object'}}, ['gql']),
}

DESCRIBE_TOOL = {
    'name': 'describe_schemas',
    'description': ('列出可用数据模型及其字段/关系/计算列（权限过滤后的紧凑 JSON）。'
                    '翻译 GQL 前先调用本工具获取 schema；无权限上下文时仅返回模型名与字段名'),
    'inputSchema': _obj({}, []),
}

ASK_TOOL = {
    'name': 'ask',
    'description': ('AI 问数（只读）：自然语言 → 宿主 ask() 编排（LLM 翻译 → text2query 档校验执行 → '
                    '失败结构化回喂重试）。成功返回 {data, attempts, events}；失败显式报错（不降级、不返回空结果）'),
    'inputSchema': _obj({'question': {'type': 'string', 'description': '自然语言问题'}}, ['question']),
}


def build_surface(store: Any, opts: dict):
    """收集工具面（归档过滤 + x-mcp 注记 + ask 启用守卫）。返回 (tools, handlers)。"""
    meta = _meta_provider(store, opts)
    names = opts.get('resources') or filter_archived(list(meta.list()))
    tools: list[dict] = []
    handlers: dict[str, Any] = {}

    for name in names:
        defn = meta.get(name) if hasattr(meta, 'get') else None
        xm = (defn or {}).get('x-mcp') or {}
        if xm.get('hidden'):
            continue  # spec/01 注记：模型级 hidden
        proj = schema_projection(defn)
        id_field = id_field_of(defn)
        description = defn.get('description') if defn else None
        for tool in model_tools(name, defn, description):
            if tool['name'] in handlers:
                raise RuntimeError(f'ERR_NAME_CONFLICT:工具名 "{tool["name"]}" 冲突（spec/01）')
            tools.append(tool)
            handlers[tool['name']] = _model_handler_curry(store, tool['name'], name, proj, id_field)

    # spec/02：query 工具强制 text2query 档 —— 档位上下文取用顺序见模块头
    tools.append(dict(QUERY_TOOL))
    handlers['query'] = _query_handler(store, opts)

    # spec/01：describe_schemas —— AI 自主翻译 GQL 前的 schema 出口（零入参；ctx 走 opts，不进 inputSchema）
    tools.append(dict(DESCRIBE_TOOL))
    handlers['describe_schemas'] = _describe_handler(store, opts)

    # spec/01：ask 仅 opts.llm 提供时注册；配 llm 缺 ctx 装配期抛错（fail-secure）
    if opts.get('llm') is not None:
        if opts.get('ctx') is None:
            raise RuntimeError(
                'store-mcp: opts["llm"] 已提供但缺 opts["ctx"] —— ask 工具需要服务端用户上下文'
                '（如 {"userId": ..., "roles": [...]}）；ctx 属受信参数，不进任何工具入参（D5）')
        tools.append(dict(ASK_TOOL))
        handlers['ask'] = _ask_handler(opts)

    return tools, handlers


# ── spec/02：映射表 handler ──

async def _model_handler(store, tool_name, name, proj, id_field, args):
    verb = tool_name[:tool_name.index('_')]
    if verb == 'get':
        row = await store.query_one(f'{name}($condition: @c0){proj}', {'c0': {id_field: args['id']}}, None)
        if row is None:
            raise SkinError('notFound', f'{name} {args["id"]} not found')
        return row
    if verb == 'list':
        q = args.get('q')
        return await store.query(f'{name}{q}' if q else f'{name}{proj}', args.get('params'), None)
    if verb == 'create':
        _assert_object(args.get('body'), 'body')
        return await store.insert(name, args['body'])
    if verb == 'update':
        _assert_object(args.get('set'), 'set')
        return await store.update(name, {id_field: args['id']}, args['set'])
    if verb == 'delete':
        return await store.remove(name, {id_field: args['id']})
    raise SkinError('planError', f'未知工具动词: {verb}')


def _model_handler_curry(store, tool_name, name, proj, id_field):
    async def handler(args):
        return await _model_handler(store, tool_name, name, proj, id_field, args)
    return handler


def _query_handler(store, opts):
    async def handler(args):
        gql = args.get('gql')
        if not isinstance(gql, str) or not gql.strip():
            raise SkinError('invalidParam', 'gql 必须为非空字符串（自模型名始，spec/02）')
        t2q = opts.get('text2query')

        async def run():
            # routeOverride 恒 None（D5/CWE-639）
            return await store.query(gql, args.get('params'), None)

        # 形态契约（spec/00）：与宿主逐字同形的 sync contextmanager 工厂——
        # py_store.schema.text2query 即 `@contextmanager def text2query(): ...`
        # （实为 `with t2q(): await run()`；回调/awaitable 形态一律不收，守卫按 callable 放行后
        #  在此处以 with 进入——非 contextmanager 形态会在此 TypeError 显式暴露，禁静默降级）
        if callable(t2q):
            with t2q():
                return await run()
        return await run()  # 测试注入路径之外不可达：装配期已守卫
    return handler


def _describe_handler(store, opts):
    async def handler(args):
        fn = getattr(store, 'describe_for_ai', None)
        if not callable(fn):
            raise SkinError('planError', 'store 未提供 describe_for_ai（需提供该门面的 py-store 宿主）')
        return fn(opts.get('ctx'))
    return handler


def _ask_handler(opts):
    async def handler(args):
        question = args.get('question')
        if not isinstance(question, str) or not question.strip():
            raise SkinError('invalidParam', 'question 必须为非空自然语言字符串')
        # 护栏零新增：档位/只读/回喂/硬限全在宿主 ask()；AskResult(data, attempts, events) 全量返回
        r = await opts['host_ask'](question)
        return {'data': r.data, 'attempts': r.attempts, 'events': r.events}
    return handler


# ── 双出口 ──

def export_tools(store: Any, opts: dict | None = None) -> list[dict]:
    """纯构建工具清单（零 SDK 依赖，永远可用；对齐 store-grpc export_proto 先例）。"""
    return build_surface(store, opts or {})[0]


def create_server(store: Any, opts: dict | None = None):
    """装配 MCP Server（全部守卫在此，不绑传输——测试经 memory 流直连）。"""
    opts = dict(opts or {})
    try:
        import mcp.types as types
        from mcp.server.lowlevel import Server
    except ImportError as e:
        raise RuntimeError(
            f'store-mcp-py 缺承载依赖 mcp（{e}）。安装：pip install "mcp>=2.2,<3"') from e

    # spec/02：query 工具强制 text2query 档 —— opts["text2query"] 优先，缺省从宿主取，两者皆无 ⇒ 拒绝装配
    if not callable(opts.get('text2query')):
        try:
            from py_store.schema import text2query
            opts['text2query'] = text2query
        except ImportError:
            pass
        if not callable(opts.get('text2query')):
            raise RuntimeError(
                'store-mcp: query 工具强制 text2query 档（spec/02），但未取得档位上下文。'
                '安装 py-store 或传 opts["text2query"]（async 上下文管理器/装饰器，py_store.schema 导出）')

    if opts.get('llm') is not None:
        if opts.get('ctx') is None:
            raise RuntimeError('store-mcp: opts["llm"] 已提供但缺 opts["ctx"]（fail-secure，spec/01）')
        if not callable(opts.get('host_ask')):
            try:
                from py_store import ask as host_ask
                opts['host_ask'] = lambda q: host_ask(q, llm=opts['llm'], ctx=opts['ctx'])
            except ImportError as e:
                raise RuntimeError(f'store-mcp: ask 工具需要宿主 py_store（{e}）。安装：pip install py-store') from e

    tools, handlers = build_surface(store, opts)
    app = Server(opts.get('name') or 'store-mcp')

    async def list_tools(ctx, params):
        return types.ListToolsResult(tools=[
            types.Tool(name=t['name'], description=t['description'], inputSchema=t['inputSchema'])
            for t in tools])

    async def call_tool(ctx, params):
        name = params.name
        args = params.arguments or {}
        try:
            handler = handlers.get(name)
            if handler is None:
                raise SkinError('invalidParam', f'未知工具: {name}')
            provider = opts.get('context_provider')
            if provider is not None:
                ctx = await provider(getattr(params, 'meta', None))
                await store.set_context(ctx or None)  # 显式清除语义，spec/02
            data = await handler(args)
            # 成功响应不含任何 error 键（spec/03 正向断言）
            return types.CallToolResult(content=[types.TextContent(
                type='text', text=json.dumps(data if data is not None else None, ensure_ascii=False))])
        except Exception as e:  # noqa: BLE001 —— 一切失败显式 isError（spec/03，禁静默失守）
            err = error_of(e)
            return types.CallToolResult(isError=True, content=[types.TextContent(
                type='text', text=json.dumps(err, ensure_ascii=False))])

    app.add_request_handler('tools/list', types.PaginatedRequestParams, list_tools)
    app.add_request_handler('tools/call', types.CallToolRequestParams, call_tool)
    return {'server': app, 'tools': tools}


def run_stdio(store: Any, opts: dict | None = None) -> None:
    """stdio 阻塞运行：create_server + stdio_server（对齐 node createStdioServer）。"""
    import anyio
    from mcp.server.stdio import stdio_server

    app = create_server(store, opts)['server']

    async def _main():
        async with stdio_server() as (read_stream, write_stream):
            await app.run(read_stream, write_stream, app.create_initialization_options())

    anyio.run(_main)
