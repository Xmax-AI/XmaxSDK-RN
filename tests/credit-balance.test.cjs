const { test, mock } = require('node:test');
const assert = require('node:assert/strict');

// Keep account/network code real and fail if an account query allocates media resources.
mock.module(require.resolve('../lib/commonjs/Core/Realtime/XmaxRealtimeManager'), {
  namedExports: { XmaxRealtimeManager: class {
    constructor() { throw new Error('Account queries must not create realtime managers'); }
  } },
});
mock.module(require.resolve('../lib/commonjs/Foundation/Storage/StorageManager'), {
  namedExports: { StorageManager: class {
    constructor() { throw new Error('Account queries must not allocate storage transport'); }
  } },
});
mock.module(require.resolve('../lib/commonjs/Foundation/Native/NativeXmaxRuntime'), {
  defaultExport: {
    configureLogging() {},
    runtimeInfo: () => JSON.stringify({ platform: 'ios', os_version: '27', device_model: 'fixture' }),
  },
});
const { XmaxClient } = require('../lib/commonjs/Core/XmaxClient');
const client = (environment = 'china', apiKey = '  balance-key\n') =>
  new XmaxClient({ environment, apiKey });
const response = (data, status = 200) => new Response(JSON.stringify({ success: true, data }), { status });

for (const [environment, root] of [
  ['china', 'https://cloud.xmax.22duck.cn/open/api/v1'],
  ['global', 'https://api.xmax.cloud/open/api/v1'],
]) {
  test(`credit query uses ${environment} general API, authentication and a bodyless uncached GET`, async t => {
    const requests = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      requests.push({ url, options });
      return response({ currentBalance: 1250.75 });
    });
    const balance = await client(environment).getCreditBalance();
    assert.deepEqual(balance, { currentBalance: 1250.75 });
    assert.equal(Object.isFrozen(balance), true);
    assert.equal(requests.length, 1);
    const { url, options } = requests[0];
    assert.equal(url, `${root}/balance`);
    assert.equal(options.method, 'GET');
    assert.equal(options.body, undefined);
    assert.equal(options.headers['X-Api-Key'], 'balance-key');
    assert.equal(options.headers['Cache-Control'], 'no-cache');
  });
}

test('every balance call fetches fresh data and preserves zero and fractional credits', async t => {
  const values = [0, 0.25, 1250.75];
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => response({ currentBalance: values[calls++] }));
  const account = client();
  for (const value of values) assert.equal((await account.getCreditBalance()).currentBalance, value);
  assert.equal(calls, 3);
});

test('empty key rejects asynchronously before a network request', async t => {
  t.mock.method(globalThis, 'fetch', () => { assert.fail('Empty key must not reach HTTP'); });
  const pending = client('china', ' \n ').getCreditBalance();
  assert(pending instanceof Promise);
  await assert.rejects(pending, { code: 'INVALID_API_KEY' });
});

test('invalid balance payloads never become a zero balance', async t => {
  let body;
  t.mock.method(globalThis, 'fetch', async () => new Response(body));
  const account = client();
  for (const payload of [
    'null', '[]', '{}', 'true', '"credits"',
    '{"currentBalance":null}', '{"currentBalance":true}', '{"currentBalance":"1250.75"}',
    '{"currentBalance":-1}', '{"currentBalance":1e400}', '{"currentBalance":NaN}',
    '{"currentBalance":Infinity}', '{"currentBalance":[]}', '{"currentBalance":{}}',
  ]) {
    body = `{"success":true,"data":${payload}}`;
    await assert.rejects(account.getCreditBalance(), { code: 'API_ERROR' }, payload);
  }
  body = 'not-json';
  await assert.rejects(account.getCreditBalance(), { code: 'API_ERROR', httpStatus: 200 });
});

test('credit query preserves service error code, message and HTTP status', async t => {
  let status;
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    success: false, code: 46002, message: 'Invalid API key', data: null,
  }), { status }));
  for (status of [200, 401, 403, 500]) {
    await assert.rejects(client().getCreditBalance(), {
      code: 'API_ERROR', apiCode: 46002, httpStatus: status, message: 'Invalid API key',
    });
  }
});

test('credit query preserves network failures and transport cancellation', async t => {
  let failure;
  t.mock.method(globalThis, 'fetch', async () => { throw failure; });
  failure = new Error('offline');
  await assert.rejects(client().getCreditBalance(), { code: 'NETWORK_ERROR' });
  failure = Object.assign(new Error('cancelled'), { name: 'AbortError' });
  await assert.rejects(client().getCreditBalance(), { code: 'CANCELLED' });
});

test('credit query timeout cancels transport and rejects instead of returning a balance', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  t.mock.method(globalThis, 'fetch', (_url, options) => new Promise((_resolve, reject) => {
    signal = options.signal;
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  }));
  const pending = assert.rejects(client().getCreditBalance(), { code: 'NETWORK_ERROR' });
  t.mock.timers.tick(15000);
  await pending;
  assert.equal(signal.aborted, true);
});

test('concurrent credit queries return their own responses without serializing or sharing results', async t => {
  const pending = [];
  t.mock.method(globalThis, 'fetch', () => new Promise(resolve => pending.push(resolve)));
  const account = client();
  const first = account.getCreditBalance();
  const second = account.getCreditBalance();
  assert.equal(pending.length, 2);
  pending[1](response({ currentBalance: 9.5 }));
  assert.equal((await second).currentBalance, 9.5);
  pending[0](response({ currentBalance: 10 }));
  assert.equal((await first).currentBalance, 10);
});
