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

test('existing loggers select details using the latest global language', () => {
  const logs = [];
  const sink = (_level, message) => logs.push(message);
  XmaxLogger.configure(1, sink, 'chinese');
  XmaxLogger.room.info(() => XmaxLogger.localized('创建会话', 'Creating Session'));
  XmaxLogger.configure(1, sink, 'english');
  XmaxLogger.room.info(() => XmaxLogger.localized('创建会话', 'Creating Session'));
  assert.deepEqual(logs, ['[Xmax][Room] 创建会话', '[Xmax][Room] Creating Session']);
  capture(0);
});

test('startup timing reports measured stages once and ignores unrelated task frames', () => {
  const { RealtimeTiming } = require('../lib/commonjs/Service/Realtime/RealtimeTiming');
  let time = 0;
  const logs = [];
  XmaxLogger.configure(2, (_level, message) => logs.push(message), 'english');
  const timing = new RealtimeTiming(() => time);
  timing.begin();
  timing.beginSessionCreation(); time = 0.1; timing.finishSessionCreation();
  timing.beginRoomJoin(); time = 0.15; timing.finishRoomJoin();
  timing.beginLocalPublication(); time = 0.16; timing.finishLocalPublication();
  timing.beginSignal('secret-task-id'); time = 0.3;
  timing.finishFirstFrame('different'); timing.finish('secret-task-id');
  assert.equal(logs.length, 0);
  timing.finishFirstFrame('secret-task-id'); timing.finish('secret-task-id');
  timing.finish('secret-task-id'); timing.finishFirstFrame('secret-task-id');
  assert.equal(logs.length, 1);
  assert.match(logs[0], /Total Duration: 300\.0 ms/);
  assert.match(logs[0], /Session Creation: 100\.0 ms/);
  assert.match(logs[0], /RTC Room Join: 50\.0 ms/);
  assert.match(logs[0], /Local Stream Publication: 10\.0 ms/);
  assert.match(logs[0], /First Frame Arrival: 140\.0 ms/);
  assert(!logs[0].includes('secret-task-id'));
  capture(0);
});

test('startup failure timings identify the pending stage and exclude sensitive error bodies', () => {
  const { RealtimeTiming } = require('../lib/commonjs/Service/Realtime/RealtimeTiming');
  const { XmaxError, XmaxErrorCode } = require('../lib/commonjs/Foundation/Errors/XmaxError');
  let time = 1;
  const logs = [];
  XmaxLogger.configure(2, (_level, message) => logs.push(message), 'english');
  const timing = new RealtimeTiming(() => time);
  timing.begin(); timing.beginSessionCreation(); time = 1.25;
  timing.finishFailure(new XmaxError({ code: XmaxErrorCode.apiError, message: 'secret-token-echo' }));
  assert.equal(logs.length, 1);
  assert.match(logs[0], /Current Stage: Creating Session/);
  assert.match(logs[0], /Session Creation: 250\.0 ms/);
  assert.match(logs[0], /RTC Room Join: —/);
  assert.match(logs[0], /Failure Reason: API_ERROR/);
  assert(!logs[0].includes('secret-token-echo'));
  timing.begin(); timing.finishFailure(new XmaxError({ code: XmaxErrorCode.cancelled, message: 'cancelled' }));
  assert.equal(logs.length, 1);
  timing.reset(); timing.finishFailure(new Error('late failure'));
  assert.equal(logs.length, 1);
  capture(0);
});

test('Chinese startup details and performance filtering do not affect business logging', () => {
  const { RealtimeTiming } = require('../lib/commonjs/Service/Realtime/RealtimeTiming');
  const logs = [];
  const sink = (_level, message) => logs.push(message);
  const timing = new RealtimeTiming(() => 1);
  for (const options of [1, 2]) {
    XmaxLogger.configure(options, sink, 'chinese');
    timing.begin(); timing.beginSignal('task'); timing.finishFirstFrame('task'); timing.finish('task');
    assert.equal(logs.length, options === 1 ? 0 : 1);
  }
  assert.match(logs[0], /总耗时：0\.0 ms/);
  assert.match(logs[0], /创建会话：—/);
  capture(0);
});

test('an in-flight transfer uses the latest language for its complete outcome message', async () => {
  const logs = [];
  const sink = (_level, message) => logs.push(message);
  let resolve;
  const transfer = new Promise(done => { resolve = done; });
  const service = new StorageService({}, { download: async () => transfer }, () => 'id');
  XmaxLogger.configure(1, sink, 'chinese');
  const pending = service.download({ remoteURL: 'https://example.invalid/image', destinationURL: 'file:///tmp/image.png' });
  XmaxLogger.configure(1, sink, 'english');
  resolve({ fileURL: 'file:///tmp/image.png', size: 1 });
  await pending;
  assert.match(logs[0], /开始下载/);
  assert.match(logs[1], /Download Completed/);
  assert.match(logs[1], /Duration:/);
  assert.doesNotMatch(logs[1], /耗时：/);
  capture(0);
});

test('storage logs oriented media dimensions, encoded size and safety selection without source content', async t => {
  const logs = [];
  XmaxLogger.configure(1, (level, message) => logs.push({ level, message }), 'english');
  t.after(() => capture(0));
  const requests = [];
  const storage = { fileSize: async () => 1536, upload: async options => ({ url: 'https://example.invalid/result?token=secret', objectKey: options.objectKey, etag: null }) };
  const metadata = { async readMetadata(fileURL, media) { requests.push({ fileURL, media }); return { width: 720, height: 1280 }; } };
  const payload = { bucket: 'fixture-123', region: 'ap-nanjing', endpoint: '', prefix: 'open/', credentials: { accessKeyId: 'id', secretAccessKey: 'secret', sessionToken: 'token' } };
  const api = { request: async (_method, path) => path === '/cos/sts' ? payload : { safe: true, url: 'https://example.invalid/checked' } };
  const service = new StorageService(api, storage, () => 'UUID', () => 1200, undefined, metadata);
  for (const media of ['image', 'video']) await service.upload({ fileURL: `file:///private/secret.${media === 'image' ? 'png' : 'mp4'}` }, media, media === 'image');
  assert.deepEqual(requests.map(request => request.media), ['image', 'video']);
  const text = logs.map(log => log.message).join('\n');
  assert.match(text, /Type: image/); assert.match(text, /Type: video/);
  assert.match(text, /Resolution: 720x1280/); assert.match(text, /Size: 1\.50 KB/);
  assert.match(text, /Safety Check: true/); assert.match(text, /Safety Check: false/);
  assert(!text.includes('secret')); assert(!text.includes('file:///')); assert(!text.includes('token='));
});

test('missing metadata does not block upload and disabled logging does not read metadata', async t => {
  t.after(() => capture(0));
  let reads = 0;
  const payload = { bucket: 'fixture-123', region: 'ap-nanjing', endpoint: '', prefix: '', credentials: { accessKeyId: 'id', secretAccessKey: 'secret', sessionToken: 'token' } };
  const service = new StorageService({ request: async () => payload }, {
    fileSize: async () => 12, upload: async () => ({ url: 'https://example.invalid/file', objectKey: 'key', etag: null }),
  }, () => 'UUID', Date.now, undefined, { async readMetadata() { reads++; throw new Error('secret native metadata error'); } });
  capture(0); await service.upload({ fileURL: 'file:///tmp/image.png' }, 'image', false); assert.equal(reads, 0);
  const logs = capture(1);
  await service.upload({ fileURL: 'file:///tmp/image.png' }, 'image', false);
  assert.equal(reads, 1); assert.match(logs[0].message, /--/);
  assert(!JSON.stringify(logs).includes('secret'));
});

test('media metadata reader validates native display sizes and routes image and video independently', async () => {
  const { MediaFileMetadataManager } = require('../lib/commonjs/Foundation/Media/MediaFileMetadataManager');
  const seen = [];
  const metadata = new MediaFileMetadataManager(async (url, media) => { seen.push({ url, media }); return JSON.stringify({ width: 720, height: 1280 }); });
  assert.deepEqual(await metadata.readMetadata('file:///image.png', 'image'), { width: 720, height: 1280 });
  assert.deepEqual(await metadata.readMetadata('file:///video.mp4', 'video'), { width: 720, height: 1280 });
  assert.deepEqual(seen.map(call => call.media), ['image', 'video']);
  for (const value of [null, {}, { width: 0, height: 4 }, { width: 4, height: -1 }, { width: 4.5, height: 8 }]) {
    assert.equal(await new MediaFileMetadataManager(async () => JSON.stringify(value)).readMetadata('file:///file', 'video'), null);
  }
});
