const { test } = require('node:test');
const assert = require('node:assert/strict');
const { XmaxLogger } = require('../lib/commonjs/Foundation/Logging/XmaxLogger');
const { RtcStatsLogger } = require('../lib/commonjs/Foundation/RTC/RtcStatsLogger');
const { ApiService } = require('../lib/commonjs/Service/Network/ApiService');
const { ApiLogger } = require('../lib/commonjs/Service/Network/ApiLogger');
const { StorageService } = require('../lib/commonjs/Service/Storage/StorageService');

const runtime = { platform: 'ios', os_version: '27', sdk_version: '1.0.0', device_model: 'fixture' };

function capture(options) {
  const logs = [];
  XmaxLogger.configure(options, (level, message, option) => logs.push({ level, message, option }));
  return logs;
}

test('global logging filters every level, prefixes every line and switches existing categories immediately', () => {
  const category = XmaxLogger.api;
  for (const options of [0, 1, 2, 3]) {
    const logs = capture(options);
    let evaluations = 0;
    for (const level of ['debug', 'info', 'warn', 'error']) {
      category[level](() => { evaluations++; return 'first\nsecond'; }, 1);
      XmaxLogger.rtc[level](() => { evaluations++; return 'metric'; }, 2);
    }
    assert.equal(logs.length, options === 0 ? 0 : options === 3 ? 8 : 4);
    assert.equal(evaluations, logs.length);
    for (const log of logs) {
      assert(log.message.split('\n').every(line => line.startsWith('[Xmax][')));
      assert.equal(log.option & options, log.option);
    }
  }
  const logs = capture(0);
  category.error('existing category is disabled');
  assert.deepEqual(logs, []);
  assert.equal(XmaxLogger.isEnabled(0), false);
});

test('formatters and failing sinks cannot escape logging or interfere with work', () => {
  XmaxLogger.configure(3, () => { throw new Error('sink failed'); });
  assert.doesNotThrow(() => XmaxLogger.media.error('failure'));
  assert.doesNotThrow(() => XmaxLogger.media.debug(() => { throw new Error('getter failed'); }));
  capture(0);
});

test('API logs response status, UTF-8 size and numeric error code while excluding sensitive payloads', async () => {
  const logs = capture(1);
  const body = JSON.stringify({ success: false, code: 4011, message: 'echo-secret-prompt', data: { token: 'secret-token' } });
  const api = new ApiService('secret-api-key', 'https://example.invalid', runtime,
    async () => new Response(body, { status: 403 }));
  await assert.rejects(api.request('POST', '/session/secret-id?token=secret-query', { prompt: 'secret-prompt' }),
    { code: 'API_ERROR', apiCode: 4011 });
  const output = logs.map(log => log.message).join('\n');
  assert.match(output, /POST \/session\/:id/);
  assert.match(output, /403/);
  assert.match(output, /4011/);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].level, 'error');
  for (const secret of ['secret-api-key', 'secret-query', 'secret-id', 'secret-token', 'secret-prompt']) {
    assert(!output.includes(secret));
  }
  assert.equal(ApiLogger.byteLength('汉😀'), Buffer.byteLength('汉😀'));
  capture(0);
});

test('API success, malformed JSON and transport failures retain their original results', async () => {
  const logs = capture(1);
  const success = new ApiService('key', 'https://example.invalid', runtime,
    async () => new Response(JSON.stringify({ success: true, data: { token: 'do-not-log' } })));
  assert.deepEqual(await success.request('GET', '/cos/sts'), { token: 'do-not-log' });
  const malformed = new ApiService('key', 'https://example.invalid', runtime,
    async () => new Response('secret-invalid-json'));
  await assert.rejects(malformed.request('GET', '/cos/sts'), { code: 'API_ERROR' });
  const offline = new ApiService('key', 'https://example.invalid', runtime,
    async () => { throw new Error('URL with secret'); });
  await assert.rejects(offline.request('GET', '/cos/sts'), { code: 'NETWORK_ERROR' });
  assert.deepEqual(logs.map(log => log.level), ['debug', 'error', 'error']);
  assert(!JSON.stringify(logs).includes('secret'));
  assert(!JSON.stringify(logs).includes('do-not-log'));
  capture(0);
});

test('RTC statistics are lazy and log measured SDK-owned metrics only', () => {
  const poison = new Proxy({}, { get() { throw new Error('disabled statistics read'); } });
  capture(0);
  assert.doesNotThrow(() => RtcStatsLogger.local(poison));
  assert.doesNotThrow(() => RtcStatsLogger.remote(poison));
  const logs = capture(2);
  RtcStatsLogger.remote({ width: 800, height: 1500, decodeFrameRate: 24, renderFrameRate: 23, bitrateKbps: 1000, packetLossPercent: 1, endToEndDelayMs: 100 });
  assert.equal(logs.length, 1);
  assert.match(logs[0].message, /23 fps/);
  assert.match(logs[0].message, /1%/);
  capture(0);
});

test('storage logs operation outcome without URLs, credentials or native error text', async () => {
  const logs = capture(1);
  const service = new StorageService({}, { download() { throw new Error('secret-url'); } }, () => 'id');
  await assert.rejects(service.download({ remoteURL: 'https://example.invalid/image?token=secret', destinationURL: 'file:///tmp/image.png' }),
    { code: 'DOWNLOAD_ERROR' });
  assert.deepEqual(logs.map(log => log.level), ['info', 'error']);
  assert(!JSON.stringify(logs).includes('secret'));
  capture(0);
});

for (const stage of ['request', 'body']) {
  test(`HTTP timeout during ${stage} rejects and logs NETWORK_ERROR`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const logs = capture(1);
    t.after(() => capture(0));
    let signal;
    const api = new ApiService('key', 'https://example.invalid', runtime, async (_url, init) => {
      signal = init.signal;
      const stalled = new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Request aborted', 'AbortError')), { once: true });
      });
      return stage === 'request' ? stalled : { status: 200, ok: true, text: () => stalled };
    });
    const pending = api.request('POST', '/session');
    const rejected = assert.rejects(pending, { code: 'NETWORK_ERROR', message: 'HTTP request failed: API request timed out' });
    await Promise.resolve();
    t.mock.timers.tick(14999);
    assert.equal(signal.aborted, false);
    t.mock.timers.tick(1);
    await rejected;
    assert.equal(signal.aborted, true);
    assert.equal(logs.length, 1);
    assert.match(logs[0].message, /NETWORK_ERROR/);
    assert.doesNotMatch(logs[0].message, /TIMEOUT/);
  });
}

test('generation confirmation waits retain TIMEOUT independently of HTTP classification', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { waitFor } = require('../lib/commonjs/Foundation/Runtime/Async');
  let removed = false;
  const pending = waitFor(() => () => { removed = true; }, new AbortController().signal,
    30000, 'Generation confirmation');
  const rejected = assert.rejects(pending, { code: 'TIMEOUT' });
  t.mock.timers.tick(30000);
  await rejected;
  assert.equal(removed, true);
});
