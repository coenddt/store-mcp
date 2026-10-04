"""测试共享 mock store —— spec/00 端口契约的最小实现（conformance/cases.json 的
schema 假设与此处逐条对应；node 侧 test/mock-store.js 同形）。"""

# describe_schemas 摘要桩（双端同一份字面量）：带 ctx 为完整摘要，无 ctx 为降级裸摘要
MOCK_DIGEST_FULL = [{'name': 'User', 'fields': {'name': 'string', 'age': 'int'}}]
MOCK_DIGEST_BARE = [{'name': 'User', 'fields': ['name', 'age']}]


def mock_store():
    docs = {'u1': {'_id': 'u1', 'name': 'Alice'}}
    calls = []
    schemas = {
        'User': {'fields': {'name': {}}, 'computes': {'full': {}}, 'idField': '_id', 'description': '用户'},
        'Order': {'fields': {'total': {}}, 'computes': {}, 'idField': '_id'},
        'OrderDeleted': {'fields': {'total': {}}, 'computes': {}, 'idField': '_id'},
        'SecretHidden': {'fields': {'s': {}}, 'computes': {}, 'x-mcp': {'hidden': True}},
    }

    class Store:
        list = staticmethod(lambda: list(schemas))
        get = staticmethod(lambda n: schemas.get(n))

        @staticmethod
        async def query(q, params=None, route_override=None):
            calls.append(['query', q, params])
            return [{'_id': 'u1'}]

        @staticmethod
        async def query_one(q, params=None, route_override=None):
            calls.append(['query_one', q, params])
            return docs.get(params['c0']['_id'])

        @staticmethod
        async def insert(name, body):
            calls.append(['insert', name, body])
            return {'_id': 'n1', **body}

        @staticmethod
        async def update(name, condition, data):
            calls.append(['update', name, condition, data])
            return 1

        @staticmethod
        async def remove(name, condition):
            calls.append(['remove', name, condition])
            return 1

        @staticmethod
        async def set_context(ctx):
            calls.append(['set_context', ctx])

        @staticmethod
        def describe_for_ai(ctx=None):
            return MOCK_DIGEST_FULL if ctx else MOCK_DIGEST_BARE

    return Store(), calls
