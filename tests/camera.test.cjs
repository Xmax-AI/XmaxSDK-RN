const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate: nextTurn } = require('node:timers/promises');
const {
  XmaxRealtimeLifecycleManager,
} = require('../lib/commonjs/Core/Realtime/XmaxRealtimeLifecycleManager');
const {
  waitFor,
  abortable,
  repeatHeartbeat,
} = require('../lib/commonjs/Foundation/Runtime/Async');
const {
  XmaxError,
  XmaxErrorCode,
} = require('../lib/commonjs/Foundation/Errors/XmaxError');
const { MediaService } = require('../lib/commonjs/Service/Media/MediaService');
const {
  RealtimeSessionService,
} = require('../lib/commonjs/Service/Realtime/RealtimeSessionService');
const { ApiService } = require('../lib/commonjs/Service/Network/ApiService');
const { roomEvent } = require('../lib/commonjs/Stream/Room/RoomEvent');
const {
  taskIDFromUUID,
} = require('../lib/commonjs/Foundation/Runtime/RuntimeInfo');
const {
  resolveBitrates,
} = require('../lib/commonjs/Stream/Encoding/EncodingBitratePolicy');
const runtime = {
  platform: 'ios',
  os_version: '26.6',
  sdk_version: '1.0.0',
  device_model: 'fixture',
};
const defer = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const sessionPayload = {
  sessionUid: 'session-1',
  userUid: 'user-1',
  status: 'ACTIVE',
  modelExtra: JSON.stringify({
    room_id: 'room-1',
    room_token: 'test-room-token',
    user_id: 'user-1',
    bot_name: 'bot-1',
  }),
};
function response(data, status = 200, success = true) {
  return new Response(JSON.stringify({ success, data }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('current model cameras require a bucket while images retain their aspect ratio', () => {
  const service = new MediaService();
  assert.deepEqual(service.resolveMediaSize({ width: 1200, height: 1600 }, 'image'), { width: 1200, height: 1600 });
  assert.throws(() => service.resolveMediaSize({ width: 1200, height: 1600 }, 'camera'), { code: 'INVALID_CONFIGURATION' });
  assert.deepEqual(service.resolveGenerationSize({ width: 1200, height: 1600 }), { width: 1152, height: 1536 });
  assert.deepEqual(service.resolveMediaSize({ width: 640, height: 480 }, 'image'), { width: 640, height: 480 });
  assert.deepEqual(service.resolveTargetSize({ width: 1200, height: 1600 }, { width: 900, height: 900 }), { width: 672, height: 896 });
  assert.deepEqual(resolveBitrates({ width: 640, height: 480, fps: 15 }), { minimum: 100, maximum: 600 });
});

test('RN task IDs carry their platform through room commands and normalized tracks', () => {
  const { tracksEvent } = require('../lib/commonjs/Stream/Room/RoomEvent');
  const base = 'task-ABEiM0RVZneImaq7zN3u_w';
  for (const platform of ['ios', 'android']) {
    const id = taskIDFromUUID('00112233-4455-6677-8899-aabbccddeeff', platform);
    assert.equal(id, `${base}?os=rn-${platform}`);
    for (const event of ['start', 'change_condition', 'stop']) {
      const payload = JSON.parse(roomEvent(event, 'user-1', { ...runtime, platform }, id));
      assert.equal(payload.uid, id);
      assert.equal(payload.runtime.platform, platform);
    }
    assert.equal(JSON.parse(tracksEvent('user-1', id, [{ x: 0.1, y: 0.2 }])).uid, id);

  }
});

test('task IDs reject invalid UUIDs and unsupported platforms', () => {
  assert.throws(() => taskIDFromUUID('not-a-uuid', 'ios'), /Invalid runtime UUID/);
  assert.throws(() => taskIDFromUUID('00112233-4455-6677-8899-aabbccddeeff', 'web'), /Unsupported runtime platform/);
});

test('interrupt cancels confirmation promptly, cleanup runs once, operation gate reopens', async () => {
  let cleaned = 0;
  const coordinator = new XmaxRealtimeLifecycleManager(async () => { cleaned++; }, () => false);
  const pending = coordinator.run('generation', ({ signal }) =>
    waitFor(() => () => {}, signal, 10000, 'confirmation'),
  );
  const rejection = assert.rejects(pending, { code: 'CANCELLED' });
  await nextTurn();
  const one = coordinator.terminate('all'),
    two = coordinator.terminate('all');
  await Promise.all([one, two, rejection]);
  assert.equal(cleaned, 1);
  assert.equal(await coordinator.run('media', async () => 7), 7);
});

test('permission wait is cancellable without waiting for system dialog', async () => {
  const permission = defer(),
    abort = new AbortController();
  const waiting = abortable(permission.promise, abort.signal);
  abort.abort();
  await assert.rejects(waiting, { code: 'CANCELLED' });
  permission.resolve('granted');
});

test('session parser cleans up allocated sessions with invalid RTC data', async () => {
  const calls = [];
  const service = new RealtimeSessionService({
    async request(method, path) {
      calls.push([method, path]);
      return method === 'POST' ? { sessionUid: 'orphan', modelExtra: {} } : {};
    },
  });
  await assert.rejects(service.createSession('x2.1'), {
    code: 'SESSION_ERROR',
  });
  assert.deepEqual(calls, [
    ['POST', '/session'],
    ['DELETE', '/session/orphan'],
  ]);
});

test('API uses X-Api-Key and runtime headers, unwraps envelope, handles HTTP business failures', async () => {
  let request;
  const api = new ApiService(
    'test-api-key',
    'https://example.invalid',
    runtime,
    async (url, init) => {
      request = { url, init };
      return response({ sessionUid: 's' });
    },
  );
  assert.deepEqual(await api.request('POST', '/session', { model: 'x2.1' }), {
    sessionUid: 's',
  });
  assert.equal(request.url, 'https://example.invalid/session');
  assert.equal(request.init.headers['X-Api-Key'], 'test-api-key');
  assert.equal(request.init.headers['X-Platform'], 'ios');
  assert.equal(request.init.body, '{"model":"x2.1"}');
  const failing = new ApiService(
    'key',
    'https://example.invalid',
    runtime,
    async () =>
      new Response(
        JSON.stringify({ success: false, code: 4031, message: 'Denied' }),
        { status: 403 },
      ),
  );
  await assert.rejects(failing.request('POST', '/session'), {
    code: 'API_ERROR',
    apiCode: 4031,
    httpStatus: 403,
  });
});

test('stopped heartbeat ignores a late failure', async () => {
  const gate = defer();
  let failures = 0,
    started = 0;
  const stop = repeatHeartbeat(
    () => {
      started++;
      return gate.promise;
    },
    () => {
      failures++;
    },
    1,
  );
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(started, 1);
  stop();
  gate.reject(new Error('late'));
  await nextTurn();
  assert.equal(failures, 0);
});

// Mock only the native boundary; run the real Core/Media/Stream/Service implementation.
const lifecycleListeners = new Set();
mock.module('react-native', {
  namedExports: {
    AppState: {
      addEventListener(_event, listener) {
        lifecycleListeners.add(listener);
        return {
          remove() {
            lifecycleListeners.delete(listener);
          },
        };
      },
    },
  },
});
class FakeRtc {
  discardPendingMessages() {}
  async waitUntilRemoteFrameReady() {}
  async setRemoteAudioSubscription(stream, enabled) { this.remoteAudio = { stream, enabled }; }
  static instances = [];
  runtime = runtime;
  listeners = new Set();
  packets = [];
  camera = false;
  closed = false;
  joins = 0;
  closes = 0;
  constructor() {
    FakeRtc.instances.push(this);
  }
  randomUUID() {
    return require('node:crypto').randomUUID();
  }
  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  publishedStreams = [];
  emit(event) {
    if (event.type === 'publication') {
      this.publishedStreams = this.publishedStreams.filter(stream => stream.roomID !== event.stream.roomID || stream.userID !== event.stream.userID);
      if (event.published) this.publishedStreams.push(event.stream);
    }
    for (const listener of [...this.listeners]) listener(event);
  }
  imagePath = null;
  startImage(path) { this.imagePath = path; }
  async open() {
    this.closed = false;
  }
  async startCamera() {
    this.camera = true;
  }
  configureEncoding(format, minimum, maximum) { this.encoding = { format, minimum, maximum }; }
  async updateCameraFormat(format, minimum, maximum) { this.configureEncoding(format, minimum, maximum); }
  beginImageTask() {}
  endImageTask() {}
  configureImageSource() { this.imageSourceConfigured = true; }
  async startExternalSource(nativeHandle, sourceFormat, format, hasAudio) { this.external = { nativeHandle, sourceFormat, format, hasAudio }; }
  switchCamera() {}
  async join() {
    this.joins++;
  }
  async send(message) {
    this.packets.push(JSON.parse(message));
  }
  setRemoteAudioVolume(value) { this.volume = value; }
  async leave() { this.publishedStreams = []; }
  async readPreference() { return "null"; }
  async writePreference() {}
  stopLocalCapture() { this.camera = false; this.imagePath = null; }
  async close() {
    this.camera = false;
    this.imagePath = null;
    this.closed = true;
    this.closes++;
  }
}
mock.module(require.resolve('../lib/commonjs/Foundation/RTC/RtcManager.js'), {
  namedExports: { RtcManager: FakeRtc },
});
class FakePermissions {
  static instances = [];
  cameraCalls = 0;
  microphoneCalls = 0;
  constructor() { FakePermissions.instances.push(this); }
  async ensureCameraPermission() { this.cameraCalls++; }
  async ensureMicrophonePermission() { this.microphoneCalls++; }
}
mock.module(require.resolve('../lib/commonjs/Foundation/Permissions/PermissionManager.js'), {
  namedExports: { PermissionManager: FakePermissions },
});
class FakeImages {
  static instances = [];
  removed = [];
  prepared = [];
  constructor() { FakeImages.instances.push(this); }
  async size() { return { width: 1010, height: 770 }; }
  async prepare(_source, size) {
    this.prepared.push(size);
    return 'file:///cache/prepared%20image.jpg';
  }
  async remove(path) { this.removed.push(path); }
}
mock.module(require.resolve('../lib/commonjs/Foundation/Media/ImageManager.js'), {
  namedExports: { ImageManager: FakeImages },
});
const {
  XmaxRealtimeManager,
} = require('../lib/commonjs/Core/Realtime/XmaxRealtimeManager');
const config = { apiKey: 'test-key', environment: 'china', loggerOptions: 0 };
const createManager = () => new XmaxRealtimeManager(config, { model: 'x2.1' });

for (const model of ['x2.1']) {
test(`camera validates buckets before permission and preserves accepted dimensions and fps (${model})`, async () => {
  const manager = new XmaxRealtimeManager(config, { model });
  const rtc = FakeRtc.instances.at(-1);
  try {
    for (const videoFormat of [
      { width: 640, height: 480, fps: 24 },
      { width: 1080, height: 1920, fps: 0 },
      { width: 1080, height: 1918, fps: 24 },
    ]) {
      await assert.rejects(manager.createLocalCameraStream({ videoFormat }), {
        code: 'INVALID_CONFIGURATION',
      });
    }
    assert.equal(FakePermissions.instances.at(-1).cameraCalls, 0);
    assert.equal(rtc.camera, false);
    const defaultStream = await manager.createLocalCameraStream();
    assert.deepEqual(defaultStream.videoTrack.videoFormat, { width: 1080, height: 1920, fps: 30 });
    await manager.stopLocalCameraStream();
    for (const videoFormat of [
      { width: 1080, height: 1920, fps: 15 },
      { width: 1920, height: 1080, fps: 30 },
    ]) {
      const local = await manager.createLocalCameraStream({ videoFormat });
      assert.deepEqual(local.videoTrack.videoFormat, videoFormat);
      await manager.stopLocalCameraStream();
    }
  } finally {
    await manager.close();
  }


});
}

for (const model of ['x2.1']) {
test(`image source keeps its aspect ratio independently of generation buckets (${model})`, async t => {
  const manager = new XmaxRealtimeManager(config, { model });
  t.after(() => manager.close());
  const images = FakeImages.instances.at(-1);
  t.mock.method(images, 'size', async () => ({ width: 1200, height: 1600 }));
  const local = await manager.createLocalImageStream({ fileURL: '/image.jpg' });
  assert.deepEqual(local.videoTrack.videoFormat, { width: 1200, height: 1600, fps: 30 });
  assert.equal(FakePermissions.instances.at(-1).cameraCalls, 0);
});
}

test('client accepts X2.1 and sends its identifier to the session API', async t => {
  const configured = [], nativeLogs = [];
  // Storage native modules are unrelated to realtime model selection.
  mock.module(require.resolve('../lib/commonjs/Foundation/Storage/StorageManager.js'), {
    namedExports: { StorageManager: class {} },
  });
  mock.module(require.resolve('../lib/commonjs/Foundation/Native/NativeXmaxRuntime.js'), {
    defaultExport: { configureLogging(options) { configured.push(options); }, writeLog(level, message) { nativeLogs.push({ level, message }); } },
  });
  const { XmaxClient } = require('../lib/commonjs/Core/XmaxClient');
  const { RealtimeModel } = require('../lib/commonjs/Service/Realtime/RealtimeModel');
  const client = new XmaxClient(config);
  const { XmaxLogger } = require('../lib/commonjs/Foundation/Logging/XmaxLogger');
  new XmaxClient({ ...config, loggerOptions: 3 });
  XmaxLogger.realtime.info('existing category enabled by latest client');
  new XmaxClient({ ...config, loggerOptions: 0 });
  XmaxLogger.realtime.info('disabled for existing services too');
  assert.deepEqual(configured, [config.loggerOptions, 3, 0]);
  assert.equal(nativeLogs.length, 1);
  assert.equal(nativeLogs[0].message, '[Xmax][Realtime] existing category enabled by latest client');
  new XmaxClient({ ...config, environment: 'china', loggerOptions: 1 });
  XmaxLogger.realtime.info(() => XmaxLogger.localized('中文详情', 'English Details'));
  new XmaxClient({ ...config, environment: 'global', loggerOptions: 1 });
  XmaxLogger.realtime.info(() => XmaxLogger.localized('中文详情', 'English Details'));
  assert.equal(nativeLogs.at(-2).message, '[Xmax][Realtime] 中文详情');
  assert.equal(nativeLogs.at(-1).message, '[Xmax][Realtime] English Details');
  new XmaxClient(config);
  for (const model of ['x2.0', 'x2.1.1-preview-cn', 'x2.1.1-preview-us']) {
    assert.throws(() => client.createRealtimeManager({ model }), { code: 'INVALID_CONFIGURATION' });
    assert.throws(() => client.createMediaService(model), { code: 'INVALID_CONFIGURATION' });
  }
  assert.throws(() => client.createRealtimeManager({ model: 'x2.1', isAdaptiveQualityEnabled: 1 }), { code: 'INVALID_CONFIGURATION' });
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    if (init.method === 'POST') requests.push(JSON.parse(init.body));
    return response(init.method === 'POST' ? sessionPayload : {});
  });
  for (const model of Object.values(RealtimeModel)) {
    const manager = client.createRealtimeManager({ model });
    try {
      const media = client.createMediaService(model);
      assert.equal(media.model, model);
      assert.deepEqual(media.resolveMediaSize({ width: 1080, height: 1920 }, 'camera'), {
        width: 1080, height: 1920,
      });
      assert.equal(client.createMediaService().model, 'x2.1');
      const local = await manager.createLocalCameraStream();
      await manager.connect({ localStream: local });
      assert.deepEqual(requests.at(-1), { model });
      assert.throws(() => client.createRealtimeManager({ model: 'unknown' }), {
        code: 'INVALID_CONFIGURATION',
      });
      assert.throws(() => client.createMediaService('unknown'), {
        code: 'INVALID_CONFIGURATION',
      });
    } finally {
      await manager.close();
    }
  }
  assert.deepEqual(requests, [{ model: 'x2.1' }]);
});

for (const environment of ['china', 'global']) {
  for (const model of ['x2.1']) {
    test(`${environment} ${model} keeps create, heartbeat and close on its session backend`, async t => {
      const requests = [];
      t.mock.timers.enable({ apis: ['setTimeout'] });
      t.mock.method(globalThis, 'fetch', async (url, init) => {
        requests.push({ method: init.method, url, body: init.body });
        return response(init.method === 'DELETE' ? {} : sessionPayload);
      });
      const manager = new XmaxRealtimeManager({ ...config, environment }, { model });
      try {
        const localStream = await manager.createLocalCameraStream();
        await manager.connect({ localStream });
        t.mock.timers.tick(10000);
        await nextTurn();
      } finally {
        await manager.close();
      }
      const base = environment === 'global' ? 'https://api.xmax.ai/open/api/v1' : 'https://cloud.xmax.22duck.cn/open/api/v1';
      assert.deepEqual(requests, [
        { method: 'POST', url: `${base}/session`, body: JSON.stringify({ model }) },
        { method: 'PUT', url: `${base}/session/session-1/heartbeat`, body: undefined },
        { method: 'DELETE', url: `${base}/session/session-1`, body: undefined },
      ]);
      const { apiBaseURLs } = require('../lib/commonjs/Core/XmaxEnvironment');
      assert.equal(apiBaseURLs.global, 'https://api.xmax.cloud/open/api/v1', 'Model selection must not change the shared storage backend');
    });
  }
}

// Fetch is replaced only within each sequential test. No live service is contacted.
for (const honorsCancellation of [false, true]) {
test(`close during POST aborts transport and reclaims any late session (transport honors abort: ${honorsCancellation})`, async t => {
  const post = defer();
  const calls = [];
  let postSignal;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    calls.push(init.method);
    if (init.method === 'POST') {
      postSignal = init.signal;
      if (honorsCancellation) init.signal.addEventListener('abort', () => {
        post.reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    } else {
      assert.equal(init.signal.aborted, false, 'Cleanup must use a fresh request signal');
    }
    return init.method === 'POST' ? post.promise : response({});
  });
  const manager = createManager();
  const local = await manager.createLocalCameraStream();
  const rtc = FakeRtc.instances.at(-1);
  const connect = manager.connect({ localStream: local });
  const rejection = assert.rejects(connect, { code: 'CANCELLED' });
  await nextTurn();
  const closing = manager.close(),
    again = manager.close();
  await nextTurn();
  assert.equal(rtc.camera, false);
  assert.equal(postSignal.aborted, true);
  if (!honorsCancellation) post.resolve(response(sessionPayload));
  await Promise.all([closing, again, rejection]);
  assert.deepEqual(calls, honorsCancellation ? ['POST'] : ['POST', 'DELETE']);
  assert.equal(rtc.joins, 0);
  assert.equal(local.videoTrack.videoFormat, null);
  assert.equal(manager.currentState.connectionState, 'Idle');
  const replacement = await manager.createLocalCameraStream();
  assert.notEqual(replacement.videoTrack, local.videoTrack);
  await assert.rejects(manager.connect({ localStream: local }), {
    code: 'INVALID_CONFIGURATION',
  });
  await manager.close();
  assert.equal(lifecycleListeners.size, 0);
});
}

for (const honorsCancellation of [false, true]) {
test(`XLab rapid replacement reaches C after cancelling A (transport honors abort: ${honorsCancellation})`, async t => {
  const { readFileSync } = require('node:fs');
  const { resolve } = require('node:path');
  const { Module } = require('node:module');
  const ts = require('typescript');
  const file = resolve(__dirname, '../Example/XLab/src/realtime/RealtimeGenerationOperations.ts');
  const loaded = new Module(file);
  loaded._compile(ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, file);
  const firstPost = defer(), requests = [];
  let posts = 0;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    requests.push(init.method);
    if (init.method === 'POST') {
      if (++posts === 1) {
        if (honorsCancellation) init.signal.addEventListener('abort', () => {
          firstPost.reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
        return firstPost.promise;
      }
      return response(sessionPayload);
    }
    return response({});
  });
  const manager = createManager();
  t.after(() => manager.close());
  const queue = new loaded.exports.RealtimeGenerationOperations(() => manager.disconnect());
  const local = await manager.createLocalCameraStream();
  const rtc = FakeRtc.instances.at(-1);
  const start = prompt => queue.run(async signal => {
    await manager.startGeneration({ localStream: local, context: { prompt } });
  });
  const a = start('A');
  await nextTurn();
  const b = start('B'), c = start('C');
  await nextTurn();
  assert.equal(posts, honorsCancellation ? 2 : 1);
  assert.equal(rtc.camera, true);
  if (!honorsCancellation) firstPost.resolve(response(sessionPayload));
  await nextTurn();
  const packet = rtc.packets.find(value => value.event === 'start');
  assert.equal(packet.params.prompt, 'C');
  assert.deepEqual(requests, honorsCancellation ? ['POST', 'POST'] : ['POST', 'DELETE', 'POST']);
  rtc.emit({ type: 'publication', published: true, stream: { roomID: 'room-1', userID: 'bot-1' }, message: packet.uid });
  await Promise.all([a, b, c]);
  await start('D');
  assert.equal(posts, 2, 'A finished generation reuses its connection');
  const change = rtc.packets.find(value => value.event === 'change_condition');
  assert.equal(change.params.prompt, 'D');
  assert.equal(change.uid, packet.uid);
  await queue.cancel();
  assert.equal(rtc.camera, true);
  assert.equal(manager.currentState.connectionState, 'Ready');
});
}

test('generation waits for its room and bot publication, updates reuse task, disconnect preserves camera', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, init) =>
    response(init.method === 'POST' ? sessionPayload : {}),
  );
  const manager = createManager();
  const local = await manager.createLocalCameraStream();
  const rtc = FakeRtc.instances.at(-1);
  await assert.rejects(manager.connect({ localStream: { ...local } }), {
    code: 'INVALID_CONFIGURATION',
  });
  const remote = await manager.connect({ localStream: local });
  let finished = false;
  const generation = manager
    .startGeneration({
      context: { prompt: '  水彩  ', referencePath: ' image/key ' },
    })
    .then(() => {
      finished = true;
    });
  await nextTurn();
  const id = rtc.packets.find(p => p.event === 'start').uid;
  assert.match(id, /^task-[A-Za-z0-9_-]{22}\?os=rn-ios$/);
  const emit = (message, roomID = 'room-1', userID = 'bot-1') =>
    rtc.emit({ type: 'publication', published: true, stream: { roomID, userID }, message });
  rtc.emit({
    type: 'decoded',
    stream: { roomID: 'room-1', userID: 'bot-1' },
    width: 1080,
    height: 1920,
  });
  emit(id, 'old-room');
  emit(id, 'other-user');
  await nextTurn();
  assert.equal(finished, false);
  emit(id + '&index=12');
  await generation;
  assert.equal(manager.currentState.connectionState, 'Generating');
  assert.equal(manager.currentState.taskID, id);
  const value = await manager.startGeneration({
    context: { prompt: '油画', referencePath: null },
  });
  assert.equal(value, undefined);
  const change = rtc.packets.find(p => p.event === 'change_condition');
  assert.equal(change.uid, id);
  assert.deepEqual(change.params, {
    model: 'default',
    size: [1080, 1920],
    face_replace: false,
    prompt: '油画',
  });
  const sameTrack = local.videoTrack;
  const switching = manager.switchCamera();
  await new Promise(resolve => setTimeout(resolve, 550));
  const next = rtc.packets.filter(p => p.event === 'start').at(-1);
  assert.notEqual(next.uid, id);
  assert.equal(next.params.prompt, '油画');
  assert.deepEqual(next.params.target_size, [972, 1728]);
  emit(next.uid);
  const switched = await switching;
  assert.equal(switched.videoTrack, sameTrack);
  assert.equal(sameTrack.position, 'back');
  await manager.disconnect();
  assert.equal(rtc.camera, true);
  assert.equal(remote.videoTrack.videoFormat, null);
  emit(id);
  assert.equal(manager.currentState.connectionState, 'Ready');
  await manager.close();
  assert.equal(lifecycleListeners.size, 0);
});

test('close cancels generation wait and still releases camera when DELETE fails', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, init) =>
    init.method === 'POST'
      ? response(sessionPayload)
      : response({}, 500, false),
  );
  const manager = createManager();
  const local = await manager.createLocalCameraStream();
  const rtc = FakeRtc.instances.at(-1);
  await manager.connect({ localStream: local });
  const pending = manager.startGeneration({ context: { prompt: '水彩' } });
  const rejection = assert.rejects(pending, { code: 'CANCELLED' });
  await nextTurn();
  await manager.close();
  assert.equal(manager.currentState.connectionState, 'Idle');
  assert.equal(manager.currentState.reason.type, 'failure');
  assert.equal(manager.currentState.reason.error.code, 'API_ERROR');
  await rejection;
  assert.equal(rtc.camera, false);
  assert.equal(local.videoTrack.videoFormat, null);
  assert.equal(lifecycleListeners.size, 0);
});

test('failed condition update retains task and cached prompt, switch failure releases only connection', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, init) =>
    response(init.method === 'POST' ? sessionPayload : {}),
  );
  const manager = createManager(),
    local = await manager.createLocalCameraStream(),
    rtc = FakeRtc.instances.at(-1);
  const remote = await manager.connect({ localStream: local });
  const pending = manager.startGeneration({ context: { prompt: 'original' } });
  await nextTurn();
  const id = rtc.packets.find(p => p.event === 'start').uid;
  assert.match(id, /^task-[A-Za-z0-9_-]{22}\?os=rn-ios$/);
  rtc.emit({
    type: 'publication', published: true,
    stream: { roomID: 'room-1', userID: 'bot-1' },
    message: id,
  });
  await pending;
  const originalSend = rtc.send.bind(rtc);
  t.mock.method(rtc, 'send', message => {
    if (JSON.parse(message).event === 'change_condition')
      throw new XmaxError({
        code: XmaxErrorCode.rtcError,
        message: 'delivery failed',
      });
    return originalSend(message);
  });
  await assert.rejects(
    manager.startGeneration({ context: { prompt: 'failed' } }),
    { code: 'RTC_ERROR' },
  );
  assert.equal(manager.currentState.taskID, id);
  assert.equal(manager.currentState.connectionState, 'Generating');
  assert.notEqual(remote.videoTrack.videoFormat, null);
  const switching = manager.switchCamera();
  await new Promise(resolve => setTimeout(resolve, 550));
  const next = rtc.packets.filter(p => p.event === 'start').at(-1);
  assert.equal(next.params.prompt, 'original');
  rtc.emit({
    type: 'publication', published: true,
    stream: { roomID: 'room-1', userID: 'bot-1' },
    message: next.uid,
  });
  await switching;
  t.mock.method(rtc, 'switchCamera', () => {
    throw new XmaxError({
      code: XmaxErrorCode.mediaError,
      message: 'camera unavailable',
    });
  });
  await assert.rejects(manager.switchCamera(), { code: 'MEDIA_ERROR' });
  assert.equal(manager.currentState.connectionState, 'Ready');
  assert.equal(remote.videoTrack.videoFormat, null);
  assert.equal(rtc.camera, true);
  assert.notEqual(local.videoTrack.videoFormat, null);
  await manager.close();
});

test('background closes resources, inactive does not, throwing app listeners cannot prevent cleanup', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, init) =>
    response(init.method === 'POST' ? sessionPayload : {}),
  );
  const manager = createManager(),
    local = await manager.createLocalCameraStream(),
    rtc = FakeRtc.instances.at(-1);
  await manager.setStateListener(() => {
    throw new Error('host listener failed');
  });
  await manager.connect({ localStream: local });
  for (const listener of [...lifecycleListeners]) listener('inactive');
  await nextTurn();
  assert.equal(rtc.camera, true);
  for (const listener of [...lifecycleListeners]) listener('background');
  await manager.close();
  assert.equal(rtc.camera, false);
  assert.equal(local.videoTrack.videoFormat, null);
  assert.equal(manager.currentState.connectionState, 'Idle');
  assert.equal(lifecycleListeners.size, 0);
});

test('synchronous subscription failure is rejected and its timeout is cleaned', async () => {
  const controller = new AbortController();
  await assert.rejects(
    waitFor(
      () => {
        throw new Error('subscribe failed');
      },
      controller.signal,
      60000,
      'test',
    ),
    /subscribe failed/,
  );
});

test('async native encoder rejection prevents capture and releases the engine', async t => {
  const manager = createManager(),
    rtc = FakeRtc.instances.at(-1);
  t.mock.method(rtc, 'configureEncoding', async () => {
    throw new XmaxError({
      code: XmaxErrorCode.rtcError,
      message: 'encoder rejected',
    });
  });
  await assert.rejects(manager.createLocalCameraStream(), {
    code: 'RTC_ERROR',
  });
  assert.equal(rtc.camera, false);
  assert.equal(rtc.closed, true);
  await manager.close();
});

test('close invalidates a camera switch while its native mirror request is pending', async t => {
  const manager = createManager(),
    local = await manager.createLocalCameraStream(),
    rtc = FakeRtc.instances.at(-1);
  const gate = defer();
  t.mock.method(rtc, 'switchCamera', () => gate.promise);
  const switching = manager.switchCamera(),
    rejected = assert.rejects(switching, { code: 'CANCELLED' });
  await nextTurn();
  const closing = manager.close();
  await nextTurn();
  assert.equal(rtc.camera, false);
  assert.equal(local.videoTrack.position, 'front', 'Retire the binding after the native operation unwinds');
  gate.resolve();
  await Promise.all([closing, rejected]);
  assert.equal(manager.currentState.connectionState, 'Idle');
  assert.equal(local.videoTrack.position, null);
});


test('image pipeline uses prepared dimensions/path, no camera permissions, and correct source stops', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, init) =>
    response(init.method === 'POST' ? sessionPayload : {}),
  );
  const manager = createManager();
  const local = await manager.createLocalImageStream({ fileURL: 'file:///original.heic' });
  const rtc = FakeRtc.instances.at(-1), images = FakeImages.instances.at(-1);
  assert.deepEqual(local.videoTrack.videoFormat, { width: 808, height: 616, fps: 30 });
  assert.equal(local.videoTrack.position, null);
  assert.equal(rtc.imagePath, '/cache/prepared image.jpg');
  assert.equal(rtc.imageSourceConfigured, true);
  assert.equal(FakePermissions.instances.at(-1).cameraCalls, 0);
  assert.equal(rtc.camera, false);
  await manager.stopLocalCameraStream();
  assert(local.videoTrack.videoFormat);
  await assert.rejects(manager.createLocalCameraStream(), { code: 'INVALID_CONFIGURATION' });
  await assert.rejects(manager.createLocalImageStream({ fileURL: '/second.jpg' }), { code: 'INVALID_CONFIGURATION' });
  await manager.connect({ localStream: local });
  const generation = manager.startGeneration({ context: { prompt: 'animate', referencePath: 'https://example.test/ref.jpg' } });
  await nextTurn();
  const start = rtc.packets.find(p => p.event === 'start');
  assert.deepEqual(start.params.size, [1536, 1152]);
  assert.equal(start.params.ref_image_path, 'https://example.test/ref.jpg');
  rtc.emit({ type: 'publication', published: true, stream: { roomID: 'room-1', userID: 'bot-1' }, message: start.uid });
  await generation;
  await assert.rejects(manager.switchCamera(), { code: 'INVALID_CONFIGURATION' });
  await assert.rejects(manager.stopLocalImageStream(), { code: 'INVALID_CONFIGURATION' });
  assert.equal(manager.currentState.taskID, start.uid);
  await manager.disconnect();
  assert(local.videoTrack.videoFormat);
  assert.equal(images.removed.length, 0);
  await manager.stopLocalImageStream();
  assert.equal(local.videoTrack.videoFormat, null);
  assert.equal(rtc.imagePath, null);
  assert.deepEqual(images.removed, ['file:///cache/prepared%20image.jpg']);
  const camera = await manager.createLocalCameraStream();
  await manager.stopLocalImageStream();
  assert(camera.videoTrack.videoFormat);
  await manager.close();
});

test('generation sends face restoration and preserved-image canvas padding', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => init.method === 'POST' ? response(sessionPayload) : response({}));
  const manager = createManager();
  const local = await manager.createLocalImageStream({ fileURL: '/image.jpg' });
  const rtc = FakeRtc.instances.at(-1);
  const pending = manager.startGeneration({ localStream: local, context: { prompt: 'Portrait' }, faceRestoration: true });
  await nextTurn();
  const start = rtc.packets.find(packet => packet.event === 'start');
  assert.equal(start.params.face_replace, true);
  assert.equal(start.params.padding, 'contain');
  assert.equal(start.session_uid, start.uid);
  assert.equal(start.params.min_bitrate, 500);
  rtc.emit({ type: 'publication', published: true, stream: { roomID: 'room-1', userID: 'bot-1' } });
  await pending;
  await manager.startGeneration({ faceRestoration: false });
  assert.equal(rtc.packets.at(-1).params.face_replace, false);
  await manager.close();
});

test('close during image preparation removes late file and never starts image RTC', async t => {
  const manager = createManager();
  const images = FakeImages.instances.at(-1), rtc = FakeRtc.instances.at(-1);
  const preparation = defer();
  t.mock.method(images, 'prepare', () => preparation.promise);
  const creating = manager.createLocalImageStream({ fileURL: '/original.png' });
  const rejected = assert.rejects(creating, { code: 'CANCELLED' });
  await nextTurn();
  const closing = manager.close();
  preparation.resolve('file:///late.jpg');
  await Promise.all([closing, rejected]);
  assert.equal(rtc.imagePath, null);
  assert.deepEqual(images.removed, ['file:///late.jpg']);
  assert.equal(lifecycleListeners.size, 0);
  images.prepare.mock.restore();
  const local = await manager.createLocalImageStream({ fileURL: '/replacement.png' });
  assert(local.videoTrack.videoFormat);
  await manager.close();
});

test('image RTC failure removes only prepared copy, invalid fps never prepares', async t => {
  const manager = createManager();
  const images = FakeImages.instances.at(-1), rtc = FakeRtc.instances.at(-1);
  await assert.rejects(manager.createLocalImageStream({ fileURL: '/image.jpg', videoFormat: { width: 640, height: 480, fps: 0 } }), { code: 'INVALID_CONFIGURATION' });
  assert.equal(images.prepared.length, 0);
  t.mock.method(rtc, 'startImage', () => { throw new Error('image rejected'); });
  await assert.rejects(manager.createLocalImageStream({ fileURL: '/image.jpg' }), /image rejected/);
  assert.deepEqual(images.removed, ['file:///cache/prepared%20image.jpg']);
  rtc.startImage.mock.restore();
  const local = await manager.createLocalImageStream({ fileURL: '/image.jpg', videoFormat: { width: 641, height: 481, fps: 15 } });
  assert.deepEqual(local.videoTrack.videoFormat, { width: 808, height: 616, fps: 15 });
  await manager.close();
});

test('background destroys image source, removes prepared file, and foreground does not generate', async () => {
  const manager = createManager();
  const local = await manager.createLocalImageStream({ fileURL: '/image.jpg' });
  const rtc = FakeRtc.instances.at(-1), images = FakeImages.instances.at(-1);
  for (const listener of [...lifecycleListeners]) listener('background');
  await manager.close();
  assert.equal(local.videoTrack.videoFormat, null);
  assert.equal(rtc.imagePath, null);
  assert.equal(images.removed.length, 1);
  assert.equal(rtc.packets.length, 0);
  assert.equal(lifecycleListeners.size, 0);
});

test('disconnect waits for native overlay hiding before stop signal and room release', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => response(init.method === 'POST' ? sessionPayload : {}));
  const manager = createManager();
  const local = await manager.createLocalCameraStream();
  const rtc = FakeRtc.instances.at(-1);
  const remote = await manager.connect({ localStream: local });
  const starting = manager.startGeneration({ context: { prompt: 'animate' } });
  await nextTurn();
  const start = rtc.packets.find(packet => packet.event === 'start');
  rtc.emit({ type: 'publication', published: true, stream: { roomID: 'room-1', userID: 'bot-1' }, message: start.uid });
  await starting;
  const { videoBinding } = require('../lib/commonjs/Render/Video/VideoRenderRegistry');
  const record = videoBinding(remote.videoTrack);
  const hidden = defer();
  let hiding = false, leaves = 0;
  record.hideBeforeRelease.add(() => { hiding = true; return hidden.promise; });
  t.mock.method(rtc, 'leave', () => { leaves++; });
  const disconnecting = manager.disconnect();
  try {
    await nextTurn();
    assert.equal(hiding, true);
    assert.equal(record.valid, true);
    assert.equal(record.retiring, true);
    assert.equal(rtc.packets.some(packet => packet.event === 'stop'), false);
    assert.equal(leaves, 0);
    assert.equal(rtc.camera, true);
    hidden.resolve();
    await disconnecting;
    assert.equal(rtc.packets.filter(packet => packet.event === 'stop').length, 1);
    assert.equal(leaves, 1);
    assert.equal(record.valid, false);
    assert.equal(videoBinding(local.videoTrack).valid, true);
    assert.equal(rtc.camera, true);
  } finally { hidden.resolve(); await disconnecting; await manager.close(); }
});

const { videoBinding } = require('../lib/commonjs/Render/Video/VideoRenderRegistry');
const { VideoSurfaceBinding } = require('../lib/commonjs/Render/Video/VideoSurfaceBinding');

function bindPreview(manager, stream) {
  const rtc = FakeRtc.instances.at(-1);
  rtc.bind = () => {};
  rtc.unbind = () => {};
  const surface = new VideoSurfaceBinding(videoBinding(stream.videoTrack), 'preview', null, () => {});
  surface.start('fill');
  return surface;
}

test('camera readiness waits for capture and preview binding; retired previews cannot ready new media', async t => {
  const manager = createManager(), states = [], frame = defer();
  t.after(() => manager.close());
  const rtc = FakeRtc.instances.at(-1);
  const start = rtc.startCamera.bind(rtc);
  t.mock.method(rtc, 'startCamera', async () => { await frame.promise; await start(); });
  await manager.setStateListener(state => states.push(state.connectionState));
  const preparing = manager.createLocalCameraStream();
  await nextTurn();
  assert.equal(manager.currentState.connectionState, 'Preparing');
  frame.resolve();
  const local = await preparing;
  assert.equal(manager.currentState.connectionState, 'Preparing');
  const oldBinding = videoBinding(local.videoTrack);
  const surface = bindPreview(manager, local);
  assert.equal(manager.currentState.connectionState, 'Ready');
  surface.setContentMode('fit');
  assert.deepEqual(states, ['Idle', 'Preparing', 'Ready']);
  surface.dispose();
  await manager.stopLocalCameraStream();
  assert.equal(manager.currentState.connectionState, 'Idle');
  const replacement = await manager.createLocalCameraStream();
  oldBinding.onPreviewReady();
  assert.equal(manager.currentState.connectionState, 'Preparing');
  bindPreview(manager, replacement).dispose();
  assert.equal(manager.currentState.connectionState, 'Ready');
});

test('disconnect during media preparation is a no-op; overlapping operations reject without cancelling preparation', async t => {
  const manager = createManager(), permission = defer();
  t.after(() => manager.close());
  t.mock.method(FakePermissions.instances.at(-1), 'ensureCameraPermission', () => permission.promise);
  const preparing = manager.createLocalCameraStream();
  await nextTurn();
  await manager.disconnect();
  await assert.rejects(manager.createLocalCameraStream(), { code: 'INVALID_CONFIGURATION' });
  assert.equal(manager.currentState.connectionState, 'Preparing');
  assert.equal(manager.currentState.reason, null);
  permission.resolve();
  const local = await preparing;
  bindPreview(manager, local).dispose();
  assert.equal(manager.currentState.connectionState, 'Ready');
});

test('image preparation becomes Ready without a canvas; validation rejects without a failure termination', async t => {
  const manager = createManager(), states = [];
  t.after(() => manager.close());
  await manager.setStateListener(state => states.push(state.connectionState));
  await assert.rejects(manager.createLocalCameraStream({ videoFormat: { width: 0, height: 0, fps: 0 } }), { code: 'INVALID_CONFIGURATION' });
  assert.deepEqual(states, ['Idle', 'Preparing', 'Idle']);
  assert.equal(manager.currentState.reason, null);
  await manager.createLocalImageStream({ fileURL: 'file:///photo.jpg' });
  assert.equal(manager.currentState.connectionState, 'Ready');
  await assert.rejects(manager.startGeneration(), { code: 'INVALID_CONFIGURATION' });
  assert.equal(manager.currentState.connectionState, 'Ready');
  assert.equal(manager.currentState.reason, null);
  await manager.stopLocalImageStream();
  assert.equal(manager.currentState.connectionState, 'Idle');
});

test('connection failure retains local preview and session identity; reconnect clears the failure reason', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => response(init.method === 'POST' ? sessionPayload : {}));
  const manager = createManager(), states = [];
  t.after(() => manager.close());
  const local = await manager.createLocalCameraStream(), rtc = FakeRtc.instances.at(-1);
  await manager.setStateListener(state => states.push(state));
  const failure = new XmaxError({ code: XmaxErrorCode.rtcError, message: 'join rejected' });
  const join = t.mock.method(rtc, 'join', async () => { throw failure; });
  await assert.rejects(manager.connect({ localStream: local }), failure);
  assert.equal(manager.currentState.connectionState, 'Ready');
  assert.equal(manager.currentState.sessionID, 'session-1');
  assert.equal(manager.currentState.reason.error, failure);
  assert.equal(rtc.camera, true);
  join.mock.restore();
  await manager.connect({ localStream: local });
  assert.equal(manager.currentState.reason, null);
  assert.equal(states.filter(state => state.connectionState === 'Connecting').at(-1).sessionID, null);
  await manager.disconnect({ reason: { type: 'orientationChanged' } });
  assert.deepEqual(manager.currentState, { connectionState: 'Ready', sessionID: 'session-1', taskID: null, reason: { type: 'orientationChanged' } });
  await manager.close();
  assert.deepEqual(manager.currentState, { connectionState: 'Idle', sessionID: 'session-1', taskID: null, reason: { type: 'normal' } });
});

test('background room failures end in Ready; engine failures end in Idle with failure reason', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => response(init.method === 'POST' ? sessionPayload : {}));
  const manager = createManager();
  t.after(() => manager.close());
  const local = await manager.createLocalCameraStream(), rtc = FakeRtc.instances.at(-1);
  await manager.connect({ localStream: local });
  const failure = new XmaxError({ code: XmaxErrorCode.rtcError, message: 'connection lost' });
  rtc.emit({ type: 'error', error: failure });
  await nextTurn();
  assert.equal(manager.currentState.connectionState, 'Ready');
  assert.equal(manager.currentState.reason.error, failure);
  assert.equal(rtc.camera, true);
  rtc.emit({ type: 'error', scope: 'all', error: failure });
  await nextTurn();
  assert.equal(manager.currentState.connectionState, 'Idle');
  assert.equal(manager.currentState.reason.error, failure);
  assert.equal(rtc.camera, false);
});

test('preview bind failure terminates local media through the state error interface', async t => {
  const manager = createManager();
  t.after(() => manager.close());
  const local = await manager.createLocalCameraStream(), rtc = FakeRtc.instances.at(-1);
  const failure = new XmaxError({ code: XmaxErrorCode.rtcError, message: 'bind failed' });
  rtc.bind = () => { throw failure; };
  rtc.unbind = () => {};
  const surface = new VideoSurfaceBinding(videoBinding(local.videoTrack), 'preview', null, () => {});
  surface.start('fill');
  await nextTurn();
  assert.equal(manager.currentState.connectionState, 'Idle');
  assert.equal(manager.currentState.reason.error, failure);
  assert.equal(rtc.camera, false);
  surface.dispose();
});

test('disconnect expanded to close joins one session cleanup and ignores late room errors', async t => {
  const deleted = defer();
  let deletes = 0;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    if (init.method === 'POST') return response(sessionPayload);
    deletes++;
    return deleted.promise;
  });
  const manager = createManager(), local = await manager.createLocalCameraStream();
  const rtc = FakeRtc.instances.at(-1);
  await manager.connect({ localStream: local });
  const disconnect = manager.disconnect();
  await nextTurn();
  const close = manager.close();
  await nextTurn();
  rtc.emit({ type: 'error', error: new XmaxError({ code: XmaxErrorCode.rtcError, message: 'late' }) });
  assert.equal(rtc.camera, false);
  assert.equal(manager.currentState.connectionState, 'Disconnecting');
  deleted.resolve(response({}));
  await Promise.all([disconnect, close]);
  assert.equal(deletes, 1);
  assert.deepEqual(manager.currentState, { connectionState: 'Idle', sessionID: 'session-1', taskID: null, reason: { type: 'normal' } });
});

test('terminal listener can create new media while the cancelled allocation unwinds', async t => {
  const post = defer();
  t.mock.method(globalThis, 'fetch', async (_url, init) => init.method === 'POST' ? post.promise : response({}));
  const manager = createManager(), local = await manager.createLocalCameraStream();
  t.after(() => manager.close());
  let replacement;
  await manager.setStateListener(state => {
    if (state.connectionState === 'Idle' && state.reason && !replacement)
      replacement = manager.createLocalImageStream({ fileURL: 'file:///new.jpg' });
  });
  const connecting = manager.connect({ localStream: local });
  const rejection = assert.rejects(connecting, { code: 'CANCELLED' });
  await nextTurn();
  const closing = manager.close();
  post.resolve(response(sessionPayload));
  await Promise.all([closing, rejection]);
  const next = await replacement;
  assert.ok(next.videoTrack.videoFormat);
  assert.equal(manager.currentState.connectionState, 'Ready');
  assert.equal(manager.currentState.reason, null);
  assert.equal(manager.currentState.sessionID, null);
  await manager.setStateListener(null);
});

test('engine failure during generation rejects the pending call with the terminal error and closes local media', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => response(init.method === 'POST' ? sessionPayload : {}));
  const manager = createManager(), local = await manager.createLocalCameraStream();
  t.after(() => manager.close());
  const pending = manager.startGeneration({ localStream: local, context: { prompt: 'test' } });
  const failure = new XmaxError({ code: XmaxErrorCode.rtcError, message: 'engine stopped' });
  const rejected = assert.rejects(pending, error => error === failure);
  await nextTurn();
  const rtc = FakeRtc.instances.at(-1);
  rtc.emit({ type: 'error', scope: 'all', error: failure });
  await rejected;
  assert.equal(manager.currentState.connectionState, 'Idle');
  assert.equal(manager.currentState.reason.error, failure);
  assert.equal(manager.currentState.sessionID, 'session-1');
  assert.equal(manager.currentState.taskID, null);
  assert.equal(rtc.camera, false);
});

test('normal close hides remote and sends stop before destroying the shared RTC engine', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => response(init.method === 'POST' ? sessionPayload : {}));
  const manager = createManager(), local = await manager.createLocalCameraStream();
  const remote = await manager.connect({ localStream: local }), rtc = FakeRtc.instances.at(-1);
  const pending = manager.startGeneration({ context: { prompt: 'test' } });
  await nextTurn();
  const id = rtc.packets.find(packet => packet.event === 'start').uid;
  rtc.emit({ type: 'publication', published: true, stream: { roomID: 'room-1', userID: 'bot-1' }, message: id });
  await pending;
  const hidden = defer(), order = [];
  videoBinding(remote.videoTrack).hideBeforeRelease.add(async () => { await hidden.promise; order.push('hidden'); });
  const send = rtc.send.bind(rtc), close = rtc.close.bind(rtc);
  t.mock.method(rtc, 'send', message => {
    assert.equal(rtc.closed, false, 'No signalling after engine destruction');
    if (JSON.parse(message).event === 'stop') order.push('stop');
    return send(message);
  });
  t.mock.method(rtc, 'close', async () => { order.push('close'); await close(); });
  const closing = manager.close();
  await nextTurn();
  assert.deepEqual(order, []);
  hidden.resolve();
  await closing;
  assert.deepEqual(order, ['hidden', 'stop', 'close']);
  assert.deepEqual(manager.currentState.reason, { type: 'normal' });
});

for (const size of [{ width: 1080, height: 1920 }, { width: 1920, height: 1080 }]) {
  test(`Pro image input preserves its ${size.width}x${size.height} bucket through preparation and RTC`, async t => {
    const manager = new XmaxRealtimeManager(config, { model: 'x2.1' });
    t.after(() => manager.close());
    const images = FakeImages.instances.at(-1), rtc = FakeRtc.instances.at(-1);
    const format = { ...size, fps: 30 };
    t.mock.method(images, 'size', async () => size);
    const start = t.mock.method(rtc, 'startImage', () => {});
    // Native image dimensions are used when videoFormat is omitted.
    const local = await manager.createLocalImageStream({ fileURL: 'file:///pro.jpg' });
    assert.deepEqual(images.prepared, [format]);
    assert.deepEqual(start.mock.calls[0].arguments[1], format);
    assert.deepEqual(local.videoTrack.videoFormat, format);
    assert.equal(manager.currentState.connectionState, 'Ready');
    await manager.stopLocalImageStream();
    // Encoder overrides must not crop the original image to a model canvas.
    t.mock.method(images, 'size', async () => ({ width: 800, height: 600 }));
    const cropped = await manager.createLocalImageStream({ fileURL: 'file:///photo.jpg', videoFormat: format });
    assert.deepEqual(cropped.videoTrack.videoFormat, { width: 800, height: 600, fps: 30 });
    assert.deepEqual(images.prepared.at(-1), { width: 800, height: 600, fps: 30 });
    await manager.stopLocalImageStream();
    const preserved = await manager.createLocalImageStream({ fileURL: 'file:///photo.jpg' });
    assert.deepEqual(preserved.videoTrack.videoFormat, { width: 800, height: 600, fps: 30 });
  });
}

test('already aborted realtime calls reject without allocating media or changing state', async t => {
  const manager = createManager(), abort = new AbortController();
  t.after(() => manager.close());
  abort.abort(new Error('caller reason must not become a lifecycle failure'));
  const signal = abort.signal, snapshot = manager.currentState;
  for (const action of [
    () => manager.createLocalCameraStream({ signal }),
    () => manager.createLocalImageStream({ fileURL: '/photo.jpg', signal }),
    () => manager.connect({ localStream: {}, signal }),
    () => manager.startGeneration({ context: { prompt: 'test' }, signal }),
    () => manager.switchCamera({ signal }),
    () => manager.stopLocalCameraStream({ signal }),
    () => manager.stopLocalImageStream({ signal }),
  ]) {
    await assert.rejects(action(), { code: 'CANCELLED' });
    assert.equal(manager.currentState, snapshot);
  }
  assert.equal(FakePermissions.instances.at(-1).cameraCalls, 0);
  assert.deepEqual(FakeImages.instances.at(-1).prepared, []);
});

test('caller cancellation during permission releases admission without waiting for the system dialog', async t => {
  const manager = createManager(), permission = defer(), abort = new AbortController();
  t.after(() => manager.close());
  const rtc = FakeRtc.instances.at(-1);
  t.mock.method(FakePermissions.instances.at(-1), 'ensureCameraPermission', () => permission.promise);
  const pending = manager.createLocalCameraStream({ signal: abort.signal });
  const rejected = assert.rejects(pending, { code: 'CANCELLED' });
  await nextTurn();
  abort.abort();
  await rejected;
  assert.equal(manager.currentState.connectionState, 'Idle');
  assert.equal(manager.currentState.reason, null);
  const replacement = await manager.createLocalImageStream({ fileURL: '/new.jpg' });
  permission.resolve();
  await nextTurn();
  assert.equal(manager.currentState.connectionState, 'Ready');
  assert.ok(replacement.videoTrack.videoFormat);
  assert.equal(rtc.camera, false);
});

test('cancelling after camera creation cleans prepared media before rejecting and releases signal listeners', async t => {
  const manager = createManager(), volume = defer(), abort = new AbortController();
  t.after(() => manager.close());
  const add = t.mock.method(abort.signal, 'addEventListener');
  const remove = t.mock.method(abort.signal, 'removeEventListener');
  t.mock.method(manager, 'setRemoteAudioVolume', () => volume.promise);
  const pending = manager.createLocalCameraStream({ signal: abort.signal });
  const rejected = assert.rejects(pending, { code: 'CANCELLED' });
  await nextTurn();
  const rtc = FakeRtc.instances.at(-1);
  assert.equal(rtc.camera, true);
  abort.abort();
  volume.resolve();
  await rejected;
  assert.equal(rtc.closed, true);
  assert.equal(manager.currentState.connectionState, 'Idle');
  assert.deepEqual(manager.currentState.reason, { type: 'normal' });
  assert.equal(add.mock.callCount(), 1);
  assert.equal(remove.mock.callCount(), 1);
});

test('caller-cancelled image preparation reclaims its late file before allowing the next operation', async t => {
  const manager = createManager(), prepare = defer(), abort = new AbortController();
  t.after(() => manager.close());
  const images = FakeImages.instances.at(-1), rtc = FakeRtc.instances.at(-1);
  const mockPrepare = t.mock.method(images, 'prepare', () => prepare.promise);
  const pending = manager.createLocalImageStream({ fileURL: '/old.jpg', signal: abort.signal });
  const rejected = assert.rejects(pending, { code: 'CANCELLED' });
  await nextTurn();
  abort.abort();
  await assert.rejects(manager.createLocalCameraStream(), { code: 'INVALID_CONFIGURATION' });
  prepare.resolve('file:///late.jpg');
  await rejected;
  assert.deepEqual(images.removed, ['file:///late.jpg']);
  assert.equal(rtc.imagePath, null);
  assert.equal(manager.currentState.connectionState, 'Idle');
  mockPrepare.mock.restore();
  await manager.createLocalCameraStream();
  assert.equal(rtc.camera, true);
});

test('cancelled initial generation hides remote before stop and retains local media', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => response(init.method === 'POST' ? sessionPayload : {}));
  const manager = createManager(), local = await manager.createLocalCameraStream(), abort = new AbortController();
  t.after(() => manager.close());
  const remote = await manager.connect({ localStream: local }), hidden = defer(), rtc = FakeRtc.instances.at(-1);
  videoBinding(remote.videoTrack).hideBeforeRelease.add(() => hidden.promise);
  const pending = manager.startGeneration({ context: { prompt: 'test' }, signal: abort.signal });
  const rejected = assert.rejects(pending, { code: 'CANCELLED' });
  await nextTurn();
  abort.abort();
  await nextTurn();
  assert.equal(manager.currentState.connectionState, 'Disconnecting');
  assert.equal(rtc.packets.some(packet => packet.event === 'stop'), false);
  hidden.resolve();
  await rejected;
  assert.equal(manager.currentState.connectionState, 'Ready');
  assert.deepEqual(manager.currentState.reason, { type: 'normal' });
  assert.equal(rtc.camera, true);
  assert.equal(rtc.packets.filter(packet => packet.event === 'stop').length, 1);
});

test('cancelling a condition update preserves generation and late cancellation cannot affect later updates', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => response(init.method === 'POST' ? sessionPayload : {}));
  const manager = createManager(), local = await manager.createLocalCameraStream(), rtc = FakeRtc.instances.at(-1);
  t.after(() => manager.close());
  const start = manager.startGeneration({ localStream: local, context: { prompt: 'first' } });
  await nextTurn();
  const id = rtc.packets.find(packet => packet.event === 'start').uid;
  rtc.emit({ type: 'publication', published: true, stream: { roomID: 'room-1', userID: 'bot-1' }, message: id });
  const remote = await start;
  const abort = new AbortController(), send = rtc.send.bind(rtc);
  const mocked = t.mock.method(rtc, 'send', message => {
    const delivery = send(message);
    if (JSON.parse(message).event === 'change_condition') abort.abort();
    return delivery;
  });
  await assert.rejects(manager.startGeneration({ context: { prompt: 'second' }, signal: abort.signal }), { code: 'CANCELLED' });
  assert.equal(manager.currentState.connectionState, 'Generating');
  assert.equal(manager.currentState.taskID, id);
  assert.equal(manager.currentState.reason, null);
  assert.ok(remote.videoTrack.videoFormat);
  assert.equal(rtc.packets.some(packet => packet.event === 'stop'), false);
  mocked.mock.restore();
  const completed = new AbortController();
  await manager.startGeneration({ context: { prompt: 'third' }, signal: completed.signal });
  completed.abort();
  await manager.startGeneration({ context: { prompt: 'fourth' } });
  assert.equal(manager.currentState.taskID, id);
  assert.equal(rtc.joins, 1);
});

test('close pauses capture but waits for a pending native join before destroying the engine', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => response(init.method === 'POST' ? sessionPayload : {}));
  const manager = createManager(), local = await manager.createLocalCameraStream(), rtc = FakeRtc.instances.at(-1), joining = defer();
  t.mock.method(rtc, 'join', () => joining.promise);
  const pending = manager.connect({ localStream: local });
  const rejected = assert.rejects(pending, { code: 'CANCELLED' });
  await nextTurn();
  const closing = manager.close();
  await nextTurn();
  assert.equal(rtc.camera, false);
  assert.equal(rtc.closed, false, 'An in-flight native operation must retain its engine');
  assert.equal(manager.currentState.connectionState, 'Disconnecting');
  joining.resolve();
  await Promise.all([closing, rejected]);
  assert.equal(rtc.closed, true);
  assert.equal(manager.currentState.connectionState, 'Idle');
});

test('HTTP authentication failure preserves one error in both promise rejection and state notification', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    success: false, code: 4011, message: 'Invalid API key',
  }), { status: 401 }));
  const manager = createManager(), states = [];
  t.after(() => manager.close());
  const local = await manager.createLocalCameraStream();
  await manager.setStateListener(state => states.push(state));
  let rejected;
  await assert.rejects(manager.connect({ localStream: local }), error => {
    rejected = error;
    assert.equal(error.code, 'API_ERROR');
    assert.equal(error.message, 'Invalid API key');
    assert.equal(error.apiCode, 4011);
    assert.equal(error.httpStatus, 401);
    return true;
  });
  assert.equal(manager.currentState.connectionState, 'Ready');
  assert.equal(manager.currentState.reason.error, rejected);
  assert.equal(states.filter(state => state.reason?.type === 'failure').length, 1);
  assert.equal(states.at(-1).reason.error, rejected);
});

for (const code of ['MEDIA_ERROR', 'CANCELLED']) {
  test(`image frame startup preserves native ${code} through cleanup and rejection without duplicating preparation errors in state`, async t => {
    const manager = createManager(), rtc = FakeRtc.instances.at(-1), states = [];
    const images = FakeImages.instances.at(-1);
    t.after(() => manager.close());
    const nativeFailure = Object.assign(new Error('Unable to start native image frames'), { code });
    const startup = t.mock.method(rtc, 'startImage', async () => { throw nativeFailure; });
    await manager.setStateListener(state => states.push(state));
    let rejected;
    await assert.rejects(manager.createLocalImageStream({ fileURL: '/image.jpg' }), error => {
      rejected = error;
      assert(error instanceof XmaxError);
      assert.equal(error.code, code);
      assert.equal(error.message, nativeFailure.message);
      return true;
    });
    assert.equal(manager.currentState.connectionState, 'Idle');
    assert.equal(rtc.closed, true);
    assert.deepEqual(images.removed, ['file:///cache/prepared%20image.jpg']);
    // Like iOS, failures before media publication reject the call and reset to Idle.
    assert.equal(manager.currentState.reason, null);
    assert.equal(states.some(state => state.reason?.type === 'failure'), false);
    startup.mock.restore();
    await manager.createLocalImageStream({ fileURL: '/image.jpg' });
    assert.equal(manager.currentState.connectionState, 'Ready');
    if (code === 'MEDIA_ERROR') {
      // A runtime failure after publication instead travels through the state listener.
      rtc.emit({ type: 'error', scope: 'all', error: nativeFailure });
      await nextTurn();
      assert.equal(manager.currentState.connectionState, 'Idle');
      assert.equal(manager.currentState.reason.error.code, rejected.code);
      assert.equal(manager.currentState.reason.error.message, rejected.message);
      assert.equal(states.filter(state => state.reason?.type === 'failure').length, 1);
      assert.equal(states.at(-1).reason.error, manager.currentState.reason.error);
    }
  });
}

test('explicit bitrate limits use iOS defaults only for omitted sides and validate the final range', () => {
  const base = { width: 640, height: 480, fps: 15 };
  for (const [settings, expected] of [
    [{ minimumBitrate: 0 }, { minimum: 0, maximum: 600 }],
    [{ maximumBitrate: 600 }, { minimum: 100, maximum: 600 }],
    [{ minimumBitrate: null, maximumBitrate: null }, { minimum: 100, maximum: 600 }],
    [{ minimumBitrate: 0, maximumBitrate: 400 }, { minimum: 0, maximum: 400 }],
    [{ minimumBitrate: 700, maximumBitrate: 700 }, { minimum: 700, maximum: 700 }],
  ]) assert.deepEqual(resolveBitrates({ ...base, ...settings }), expected);
  for (const settings of [
    { minimumBitrate: -1 }, { minimumBitrate: NaN }, { minimumBitrate: 0.5 },
    { maximumBitrate: 0 }, { maximumBitrate: Infinity }, { maximumBitrate: 2.5 },
    { minimumBitrate: 601 }, { maximumBitrate: 99 },
    { minimumBitrate: 1000, maximumBitrate: 999 }, { encoderPreference: 'invalid' },
  ]) assert.throws(() => resolveBitrates({ ...base, ...settings }), { code: 'INVALID_CONFIGURATION' });
});

for (const source of ['camera', 'image']) {
  test(`${source}: resizing preserves explicit encoding, and creating media resets remote volume to zero`, async t => {
    const manager = createManager();
    t.after(() => manager.close());
    const requested = { width: 1080, height: 1920, fps: 15,
      minimumBitrate: 0, maximumBitrate: 3000, encoderPreference: 'maintainQuality' };
    await manager.setRemoteAudioVolume(0.8);
    const stream = source === 'camera'
      ? await manager.createLocalCameraStream({ videoFormat: requested })
      : await manager.createLocalImageStream({ fileURL: '/image.jpg', videoFormat: requested });
    const expected = source === 'camera' ? requested : { ...requested, width: 808, height: 616 };
    assert.deepEqual(stream.videoTrack.videoFormat, expected);
    const rtc = FakeRtc.instances.at(-1);
    assert.deepEqual(rtc.encoding, { format: expected, minimum: 0, maximum: 3000 });
    assert.equal(manager.remoteAudioVolume, 0);
    assert.equal(rtc.volume, 0);
    await manager.setRemoteAudioVolume(0.6);
    assert.equal(manager.remoteAudioVolume, 0.6);
    assert.equal(rtc.volume, 0.6);
    if (source === 'camera') {
      await manager.switchCamera();
      assert.deepEqual(stream.videoTrack.videoFormat, expected);
    }
  });

  test(`${source}: invalid encoding limits reject before allocating native media`, async t => {
    const manager = createManager();
    t.after(() => manager.close());
    const rtc = FakeRtc.instances.at(-1), images = FakeImages.instances.at(-1);
    const videoFormat = { width: 640, height: 480, fps: 30, maximumBitrate: 1 };
    await assert.rejects(source === 'camera'
      ? manager.createLocalCameraStream({ videoFormat })
      : manager.createLocalImageStream({ fileURL: '/image.jpg', videoFormat }), { code: 'INVALID_CONFIGURATION' });
    assert.equal(rtc.encoding, undefined);
    assert.equal(FakePermissions.instances.at(-1).cameraCalls, 0);
    assert.equal(images.prepared.length, 0);
  });
}

test('statistics follow the connected lifecycle and measured remote dimensions keep track identity', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => response(init.method === 'POST' ? sessionPayload : {}));
  const manager = createManager(), up = [], down = [];
  t.after(() => manager.close());
  await manager.setUplinkVideoStatisticsListener(value => up.push(value));
  await manager.setDownlinkVideoStatisticsListener(value => down.push(value));
  const local = await manager.createLocalCameraStream(), rtc = FakeRtc.instances.at(-1);
  const remote = await manager.connect({ localStream: local });
  rtc.emit({ type: 'uplinkStatistics', statistics: { width: 816, height: 1530, bitrateKbps: 600 } });
  rtc.emit({ type: 'downlinkStatistics', statistics: { width: 800, height: 1500 } });
  assert.equal(up.at(-1).width, 816);
  assert.deepEqual(down, [null]);
  const pending = manager.startGeneration({ context: { prompt: 'portrait' } });
  await nextTurn();
  rtc.emit({ type: 'publication', published: true, stream: { roomID: 'room-1', userID: 'bot-1' } });
  await pending;
  const track = remote.videoTrack;
  rtc.emit({ type: 'decoded', stream: { roomID: 'room-1', userID: 'bot-1' }, width: 800, height: 1500 });
  rtc.emit({ type: 'downlinkStatistics', statistics: { width: 800, height: 1500 } });
  assert.equal(remote.videoTrack, track);
  assert.equal(track.videoFormat.width, 800);
  assert.equal(down.at(-1).height, 1500);
  assert.equal(local.videoTrack.videoFormat.width, 1080);
  await manager.disconnect();
  assert.equal(up.at(-1), null);
  assert.equal(down.at(-1), null);
});

test('adaptive changes adjust only transport sizes and reuse the active room and task', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => response(init.method === 'POST' ? sessionPayload : {}));
  const manager = createManager(), local = await manager.createLocalCameraStream(), rtc = FakeRtc.instances.at(-1);
  t.after(() => manager.close());
  const pending = manager.startGeneration({ localStream: local, context: { prompt: 'portrait' } });
  await nextTurn();
  const start = rtc.packets.find(packet => packet.event === 'start');
  assert.deepEqual(start.params.size, [1080, 1920]);
  assert.deepEqual(start.params.target_size, [972, 1728]);
  rtc.emit({ type: 'publication', published: true, stream: { roomID: 'room-1', userID: 'bot-1' } });
  await pending;
  let elapsed = performance.now() + 5000;
  t.mock.method(performance, 'now', () => elapsed++);
  for (let index = 0; index < 3; index++) {
    rtc.emit({ type: 'quality', quality: { uplink: 'Bad', downlink: 'Bad' } });
    await nextTurn();
  }
  const target = rtc.packets.find(packet => packet.event === 'change_target_size');
  assert.deepEqual(target.params.target_size, [792, 1408]);
  assert.equal(target.uid, start.uid);
  assert.equal(rtc.joins, 1);
  assert.equal(rtc.encoding.format.width, 792);
  assert.equal(local.videoTrack.videoFormat.width, 1080);
});

const { RealtimeCameraPreset } = require('../lib/commonjs/Service/Realtime/RealtimeCameraPreset');
const { RealtimeQualityLevel } = require('../lib/commonjs/Stream/Quality/RealtimeQualityLevel');
const { realtimeModelSpecifications } = require('../lib/commonjs/Service/Realtime/RealtimeModel');

async function readyCamera(t, options) {
  const manager = createManager();
  t.after(() => manager.close());
  const local = await manager.createLocalCameraStream(options);
  videoBinding(local.videoTrack).onPreviewReady();
  assert.equal(manager.currentState.connectionState, 'Ready');
  return { manager, local, rtc: FakeRtc.instances.at(-1) };
}

async function generatingCamera(t) {
  t.mock.method(globalThis, 'fetch', async (_url, init) => response(init.method === 'POST' ? sessionPayload : {}));
  const fixture = await readyCamera(t);
  const pending = fixture.manager.startGeneration({ localStream: fixture.local, context: { prompt: 'portrait' } });
  await nextTurn();
  fixture.rtc.emit({ type: 'publication', published: true, stream: { roomID: 'room-1', userID: 'bot-1' } });
  await pending;
  return fixture;
}

test('X2.1 accepts all five camera formats and their presets', async t => {
  const formats = [
    { width: 1920, height: 1080, fps: 30 },
    { width: 1080, height: 1920, fps: 30 },
    { width: 1408, height: 1408, fps: 30 },
    { width: 1152, height: 1536, fps: 30 },
    { width: 1536, height: 1152, fps: 30 },
  ];
  assert.deepEqual(Object.keys(realtimeModelSpecifications), ['x2.1']);
  const spec = realtimeModelSpecifications['x2.1'];
  assert.equal(spec.displayName, 'X2.1');
  assert.deepEqual(spec.defaultCameraVideoFormat, { width: 1080, height: 1920, fps: 30 });
  assert.deepEqual(spec.supportedVideoFormats, formats);
  for (const videoFormat of formats) {
    const preset = `${videoFormat.width}x${videoFormat.height}`;
    for (const options of [{ videoFormat }, { preset }]) {
      const { manager, local } = await readyCamera(t, options);
      assert.deepEqual(manager.currentCameraVideoFormat, videoFormat);
      assert.equal(manager.currentCameraPreset, preset);
      assert.equal(local.videoTrack.videoFormat, manager.currentCameraVideoFormat);
      await manager.close();
    }
  }
  const manager = createManager();
  t.after(() => manager.close());
  for (const videoFormat of [
    { width: 1024, height: 1920, fps: 30 },
    { width: 1920, height: 1024, fps: 30 },
  ]) await assert.rejects(manager.createLocalCameraStream({ videoFormat }), { code: 'INVALID_CONFIGURATION' });
  assert.equal(FakePermissions.instances.at(-1).cameraCalls, 0);
});

test('camera format updates require ready disconnected camera and preserve stream identity and settings', async t => {
  const manager = createManager();
  t.after(() => manager.close());
  await assert.rejects(manager.updateCameraFormat({ width: 1920, height: 1080, fps: 15, minimumBitrate: 0, maximumBitrate: 3000, encoderPreference: 'maintainQuality' }), { code: 'INVALID_CONFIGURATION' });
  const local = await manager.createLocalCameraStream({ videoFormat: { width: 1080, height: 1920, fps: 15, minimumBitrate: 0, maximumBitrate: 3000, encoderPreference: 'maintainQuality' } });
  const track = local.videoTrack, rtc = FakeRtc.instances.at(-1), binding = videoBinding(track);
  await assert.rejects(manager.updateCameraFormat({ width: 1920, height: 1080, fps: 15, minimumBitrate: 0, maximumBitrate: 3000, encoderPreference: 'maintainQuality' }), { code: 'INVALID_CONFIGURATION' });
  binding.onPreviewReady();
  const version = binding.version;
  let updates = 0;
  t.mock.method(rtc, 'updateCameraFormat', async (format, minimum, maximum) => {
    updates++;
    assert.equal(manager.currentCameraVideoFormat.width, 1080, 'Public metadata changes only after native acknowledgment');
    assert.equal(format.width, 1920);
    assert.equal(minimum, 0);
    assert.equal(maximum, 3000);
  });
  await manager.updateCameraFormat({ width: 1920, height: 1080, fps: 15, minimumBitrate: 0, maximumBitrate: 3000, encoderPreference: 'maintainQuality' });
  assert.deepEqual(manager.currentCameraVideoFormat, { width: 1920, height: 1080, fps: 15, minimumBitrate: 0, maximumBitrate: 3000, encoderPreference: 'maintainQuality' });
  assert.equal(manager.currentCameraPreset, RealtimeCameraPreset.resolution1920x1080);
  assert.equal(local.videoTrack, track);
  assert.equal(videoBinding(track), binding);
  assert.equal(binding.version, version + 1);
  assert.equal(FakePermissions.instances.at(-1).cameraCalls, 1);
  assert.equal(rtc.closes, 0);
  assert.equal(updates, 1);
  await assert.rejects(manager.updateCameraFormat({ width: 640, height: 480, fps: 30 }), { code: 'INVALID_CONFIGURATION' });
  assert.equal(updates, 1);
  t.mock.method(globalThis, 'fetch', async (_url, init) => response(init.method === 'POST' ? sessionPayload : {}));
  await manager.connect({ localStream: local });
  await assert.rejects(manager.updateCameraFormat(RealtimeCameraPreset.resolution1080x1920), { code: 'INVALID_CONFIGURATION' });
  assert.equal(manager.currentCameraPreset, RealtimeCameraPreset.resolution1920x1080);
  assert.equal(updates, 1);
});

test('full format updates replace all camera settings and failed native updates retain the acknowledged format', async t => {
  const { manager, local, rtc } = await readyCamera(t);
  const requested = { width: 1920, height: 1080, fps: 24, minimumBitrate: 0, maximumBitrate: 4000, encoderPreference: 'auto' };
  await manager.updateCameraFormat(requested);
  assert.deepEqual(manager.currentCameraVideoFormat, requested);
  const previous = manager.currentCameraVideoFormat;
  t.mock.method(rtc, 'updateCameraFormat', async () => { throw new Error('Capture configuration rejected'); });
  await assert.rejects(manager.updateCameraFormat({ width: 1920, height: 1080, fps: 30 }));
  assert.equal(manager.currentCameraVideoFormat, previous);
  assert.equal(local.videoTrack.videoFormat, previous);
  assert.equal(manager.currentState.connectionState, 'Ready');
  assert.equal(rtc.camera, true);
});

test('cancelled camera changes restore the native configuration before rejecting and preserve old metadata', async t => {
  const { manager, local, rtc } = await readyCamera(t), gate = defer(), calls = [], abort = new AbortController();
  const previous = local.videoTrack.videoFormat;
  t.mock.method(rtc, 'updateCameraFormat', async format => {
    calls.push(format);
    if (calls.length === 1) await gate.promise;
  });
  const pending = manager.updateCameraFormat({ width: 1920, height: 1080, fps: 30 }, { signal: abort.signal });
  const rejected = assert.rejects(pending, { code: 'CANCELLED' });
  await nextTurn();
  await assert.rejects(manager.updateCameraFormat(RealtimeCameraPreset.resolution1152x1536), { code: 'INVALID_CONFIGURATION' });
  abort.abort();
  gate.resolve();
  await rejected;
  assert.equal(calls.length, 2);
  assert.equal(calls[1], previous);
  assert.equal(manager.currentCameraVideoFormat, previous);
  assert.equal(manager.currentState.connectionState, 'Ready');
});

test('image inputs expose no camera format and cannot update camera presets', async t => {
  const manager = createManager();
  t.after(() => manager.close());
  await manager.createLocalImageStream({ fileURL: '/image.jpg' });
  assert.equal(manager.currentCameraVideoFormat, null);
  assert.equal(manager.currentCameraPreset, null);
  await assert.rejects(manager.updateCameraFormat({ width: 1920, height: 1080, fps: 30 }), { code: 'INVALID_CONFIGURATION' });
});

test('quality getters follow connection state and setters require active generation', async t => {
  const { manager, local } = await readyCamera(t);
  assert.equal(manager.uplinkQualityLevel, null);
  assert.equal(manager.downlinkQualityLevel, null);
  await assert.rejects(manager.setUplinkQualityLevel(RealtimeQualityLevel.l1), { code: 'INVALID_CONFIGURATION' });
  t.mock.method(globalThis, 'fetch', async (_url, init) => response(init.method === 'POST' ? sessionPayload : {}));
  await manager.connect({ localStream: local });
  assert.equal(manager.uplinkQualityLevel, RealtimeQualityLevel.l2);
  assert.equal(manager.downlinkQualityLevel, RealtimeQualityLevel.l2);
  await assert.rejects(manager.setDownlinkQualityLevel(RealtimeQualityLevel.l1), { code: 'INVALID_CONFIGURATION' });
  await manager.disconnect();
  assert.equal(manager.uplinkQualityLevel, null);
  assert.equal(manager.downlinkQualityLevel, null);
});

test('manual quality changes reuse the room/task and never mutate camera capture metadata', async t => {
  const { manager, local, rtc } = await generatingCamera(t), track = local.videoTrack, format = track.videoFormat, taskID = manager.currentState.taskID, writes = [];
  t.mock.method(rtc, 'writePreference', async (key, value) => writes.push({ key, ...JSON.parse(value) }));
  for (const level of [1, 3, 5, 2]) {
    await manager.setUplinkQualityLevel(level);
    assert.equal(manager.uplinkQualityLevel, level);
    await manager.setDownlinkQualityLevel(level);
    assert.equal(manager.downlinkQualityLevel, level);
    assert.equal(local.videoTrack, track);
    assert.equal(track.videoFormat, format);
  }
  assert.equal(manager.currentState.taskID, taskID);
  assert.equal(rtc.joins, 1);
  assert.equal(rtc.packets.filter(packet => packet.event === 'start').length, 1);
  assert.equal(rtc.packets.findLast(packet => packet.event === 'change_target_size').uid, taskID);
  assert.deepEqual(writes.map(write => write.key), [false, true, false, true, false, true, false, true].map(down => `quality.x2.1.${down ? 'down' : 'up'}`));
  const before = rtc.packets.length;
  for (const level of [0, 6, 1.5, NaN]) await assert.rejects(manager.setDownlinkQualityLevel(level), { code: 'INVALID_CONFIGURATION' });
  assert.equal(rtc.packets.length, before);
});

for (const source of ['camera', 'image']) {
  test(`${source}: condition updates preserve the downlink size selected for the active task`, async t => {
    t.mock.method(globalThis, 'fetch', async (_url, init) => response(init.method === 'POST' ? sessionPayload : {}));
    const manager = createManager();
    t.after(() => manager.close());
    if (source === 'image')
      t.mock.method(FakeImages.instances.at(-1), 'size', async () => ({ width: 1200, height: 1600 }));
    const local = source === 'camera'
      ? await manager.createLocalCameraStream()
      : await manager.createLocalImageStream({ fileURL: '/image.jpg' });
    const rtc = FakeRtc.instances.at(-1);
    const pending = manager.startGeneration({ localStream: local, context: { prompt: 'portrait' } });
    await nextTurn();
    const start = rtc.packets.find(packet => packet.event === 'start');
    assert.ok(start.params.target_size);
    assert.equal(start.params.min_bitrate, 500);
    assert.ok(start.params.max_bitrate >= 500);
    rtc.emit({ type: 'publication', published: true, stream: { roomID: 'room-1', userID: 'bot-1' } });
    await pending;

    await manager.setDownlinkQualityLevel(3);
    const target = rtc.packets.findLast(packet => packet.event === 'change_target_size');
    const context = { prompt: 'watercolor', referencePath: 'https://example.test/reference.jpg' };
    await manager.startGeneration({ context, faceRestoration: true });
    await manager.startGeneration();

    const changes = rtc.packets.filter(packet => packet.event === 'change_condition');
    assert.equal(changes.length, 2);
    for (const change of changes) {
      assert.equal(change.uid, start.uid);
      assert.equal(change.params.prompt, context.prompt);
      assert.equal(change.params.ref_image_path, context.referencePath);
      for (const key of ['target_size', 'min_bitrate', 'max_bitrate', 'mirror'])
        assert.equal(Object.hasOwn(change.params, key), false);
    }
    assert.equal(changes[0].params.face_replace, true);
    assert.equal(changes[1].params.face_replace, false);
    assert.equal(manager.downlinkQualityLevel, 3);
    assert.equal(manager.currentState.taskID, start.uid);
    assert.equal(manager.currentState.connectionState, 'Generating');
    assert.equal(rtc.packets.filter(packet => packet.event === 'change_target_size').length, 1);
    assert.notDeepEqual(target.params.target_size, start.params.target_size);
    assert.equal(rtc.packets.filter(packet => packet.event === 'start').length, 1);
    assert.equal(rtc.joins, 1);
  });
}

for (const failedDirection of ['uplink', 'downlink']) {
  test(`automatic ${failedDirection} failure does not block the other direction or persist the failed tier`, async t => {
    const { manager, rtc } = await generatingCamera(t), writes = [];
    const taskID = manager.currentState.taskID;
    t.mock.method(rtc, 'writePreference', async (key, value) => writes.push({ key, ...JSON.parse(value) }));
    const encoding = t.mock.method(rtc, 'configureEncoding', async () => {
      if (failedDirection === 'uplink') throw new Error('Encoder rejected');
    });
    const send = rtc.send.bind(rtc);
    const targets = [];
    t.mock.method(rtc, 'send', async message => {
      const packet = JSON.parse(message);
      if (packet.event === 'change_target_size') {
        targets.push(packet);
        if (failedDirection === 'downlink') throw new Error('Signal rejected');
      }
      await send(message);
    });
    let elapsed = performance.now() + 5000;
    t.mock.method(performance, 'now', () => elapsed++);
    for (let index = 0; index < 3; index++) {
      rtc.emit({ type: 'quality', quality: { uplink: 'Bad', downlink: 'Bad' } });
      await nextTurn();
    }

    assert.equal(encoding.mock.callCount(), 1);
    assert.equal(targets.length, 1);
    assert.equal(targets[0].uid, taskID);
    assert.equal(manager.uplinkQualityLevel, failedDirection === 'uplink' ? 2 : 3);
    assert.equal(manager.downlinkQualityLevel, failedDirection === 'downlink' ? 2 : 3);
    assert.deepEqual(writes.map(({ key, level }) => ({ key, level })), [{
      key: `quality.x2.1.${failedDirection === 'uplink' ? 'down' : 'up'}`,
      level: 3,
    }]);
    assert.equal(manager.currentState.connectionState, 'Generating');
    assert.equal(manager.currentState.taskID, taskID);
    assert.equal(rtc.joins, 1);
  });
}

for (const fails of [false, true]) {
  test(`close during automatic uplink adjustment prevents subsequent downlink work (uplink fails: ${fails})`, async t => {
    const { manager, rtc } = await generatingCamera(t), gate = defer(), writes = [];
    t.mock.method(rtc, 'writePreference', async (...args) => writes.push(args));
    const encoding = t.mock.method(rtc, 'configureEncoding', async () => gate.promise);
    let elapsed = performance.now() + 5000;
    t.mock.method(performance, 'now', () => elapsed++);
    for (let index = 0; index < 3; index++) {
      rtc.emit({ type: 'quality', quality: { uplink: 'Bad', downlink: 'Bad' } });
      await nextTurn();
    }
    assert.equal(encoding.mock.callCount(), 1);

    const closing = manager.close();
    if (fails) gate.reject(new Error('Encoder rejected'));
    else gate.resolve();
    await closing;
    assert.equal(rtc.packets.filter(packet => packet.event === 'change_target_size').length, 0);
    assert.deepEqual(writes, []);
    assert.equal(manager.currentState.connectionState, 'Idle');
    assert.equal(manager.uplinkQualityLevel, null);
    assert.equal(manager.downlinkQualityLevel, null);
  });
}

test('failed manual encoding and signals preserve the active quality level and do not save history', async t => {
  const { manager, rtc } = await generatingCamera(t), writes = [];
  t.mock.method(rtc, 'writePreference', async (...args) => writes.push(args));
  const encoding = t.mock.method(rtc, 'configureEncoding', async () => { throw new Error('Encoder rejected'); });
  await assert.rejects(manager.setUplinkQualityLevel(1));
  assert.equal(manager.uplinkQualityLevel, 2);
  encoding.mock.restore();
  const send = t.mock.method(rtc, 'send', async () => { throw new Error('Signal rejected'); });
  await assert.rejects(manager.setDownlinkQualityLevel(1));
  assert.equal(manager.downlinkQualityLevel, 2);
  assert.equal(manager.currentState.connectionState, 'Generating');
  assert.deepEqual(writes, []);
  send.mock.restore();
});

test('close while a quality update is pending rejects its late completion without saving a new tier', async t => {
  const { manager, local, rtc } = await generatingCamera(t), gate = defer(), writes = [];
  t.mock.method(rtc, 'writePreference', async (...args) => writes.push(args));
  t.mock.method(rtc, 'configureEncoding', async () => gate.promise);
  const pending = manager.setUplinkQualityLevel(1);
  const rejected = assert.rejects(pending, { code: 'CANCELLED' });
  await nextTurn();
  const closing = manager.close();
  assert.equal(manager.uplinkQualityLevel, null);
  assert.equal(manager.downlinkQualityLevel, null);
  gate.resolve();
  await Promise.all([closing, rejected]);
  assert.equal(manager.currentState.connectionState, 'Idle');
  assert.equal(local.videoTrack.videoFormat, null);
  assert.deepEqual(writes, []);
});

for (const downlink of [false, true]) {
  test(`cancelled ${downlink ? 'downlink' : 'uplink'} changes restore the acknowledged configuration in a retained session`, async t => {
    const { manager, rtc } = await generatingCamera(t), gate = defer(), abort = new AbortController(), writes = [], submitted = [];
    const previous = rtc.encoding;
    t.mock.method(rtc, 'writePreference', async (...args) => writes.push(args));
    const override = downlink
      ? t.mock.method(rtc, 'send', async message => { submitted.push(JSON.parse(message)); if (submitted.length === 1) await gate.promise; })
      : t.mock.method(rtc, 'configureEncoding', async (...args) => { submitted.push(args); if (submitted.length === 1) await gate.promise; rtc.encoding = { format: args[0], minimum: args[1], maximum: args[2] }; });
    const pending = downlink ? manager.setDownlinkQualityLevel(1, { signal: abort.signal }) : manager.setUplinkQualityLevel(1, { signal: abort.signal });
    const rejected = assert.rejects(pending, { code: 'CANCELLED' });
    await nextTurn();
    abort.abort();
    gate.resolve();
    await rejected;
    assert.equal(submitted.length, 2);
    if (downlink) assert.deepEqual(submitted[1].params.target_size, [972, 1728]);
    else assert.deepEqual(rtc.encoding, previous);
    assert.equal(manager.uplinkQualityLevel, 2);
    assert.equal(manager.downlinkQualityLevel, 2);
    assert.equal(manager.currentState.connectionState, 'Generating');
    assert.deepEqual(writes, []);
    override.mock.restore();
  });
}

test('failed cancellation rollback releases the broken camera and allows a new preview', async t => {
  const { manager, rtc } = await readyCamera(t), gate = defer(), abort = new AbortController();
  let calls = 0;
  const override = t.mock.method(rtc, 'updateCameraFormat', async () => {
    if (++calls === 1) await gate.promise;
    else throw new Error('Unable to restore camera');
  });
  const pending = manager.updateCameraFormat({ width: 1920, height: 1080, fps: 30 }, { signal: abort.signal });
  const rejected = assert.rejects(pending, { code: 'CANCELLED' });
  await nextTurn();
  abort.abort(); gate.resolve();
  await rejected;
  assert.equal(manager.currentState.connectionState, 'Idle');
  assert.equal(manager.currentCameraVideoFormat, null);
  override.mock.restore();
  const next = await manager.createLocalCameraStream();
  assert.equal(next.videoTrack.videoFormat.width, 1080);
});

test('invalid camera presets and conflicting creation options reject before requesting permissions', async t => {
  const manager = createManager();
  t.after(() => manager.close());
  const rtc = FakeRtc.instances.at(-1);
  for (const preset of ['', 'invalid', null]) await assert.rejects(manager.createLocalCameraStream({ preset }), { code: 'INVALID_CONFIGURATION' });
  await assert.rejects(manager.createLocalCameraStream({ preset: RealtimeCameraPreset.resolution1408x1408, videoFormat: { width: 1080, height: 1920, fps: 30 } }), { code: 'INVALID_CONFIGURATION' });
  assert.equal(FakePermissions.instances.at(-1).cameraCalls, 0);
});

test('unrecoverable native camera configuration errors retire the track and release media', async t => {
  const { manager, local, rtc } = await readyCamera(t);
  rtc.emit({ type: 'error', scope: 'all', error: new XmaxError({ code: XmaxErrorCode.rtcError, message: 'Camera configuration could not be restored' }) });
  await nextTurn();
  assert.equal(manager.currentState.connectionState, 'Idle');
  assert.equal(local.videoTrack.videoFormat, null);
  assert.equal(rtc.camera, false);
});

test('SDK replacement while awaiting publication retains the room and reuses the unretired remote track', async t => {
  let posts = 0;
  t.mock.method(globalThis, 'fetch', async (_url, init) => { if (init.method === 'POST') posts++; return response(init.method === 'POST' ? sessionPayload : {}); });
  const { manager, local, rtc } = await readyCamera(t);
  const remote = await manager.connect({ localStream: local }), binding = videoBinding(remote.videoTrack);
  const first = manager.startGeneration({ context: { prompt: 'A' } });
  const firstRejected = assert.rejects(first, { code: 'CANCELLED' });
  await nextTurn();
  const firstID = rtc.packets.find(packet => packet.event === 'start').uid;
  const middle = manager.startGeneration({ context: { prompt: 'B' } });
  const middleRejected = assert.rejects(middle, { code: 'CANCELLED' });
  const latest = manager.startGeneration({ context: { prompt: 'C' } });
  await nextTurn();
  assert.equal(posts, 1);
  assert.equal(rtc.joins, 1);
  assert.deepEqual(rtc.packets.filter(packet => packet.event === 'start').map(packet => packet.params.prompt), ['A', 'C']);
  assert.equal(rtc.packets.find(packet => packet.event === 'stop').uid, firstID);
  rtc.emit({ type: 'publication', published: true, stream: { roomID: 'room-1', userID: 'bot-1' } });
  await Promise.all([firstRejected, middleRejected, latest]);
  assert.equal(videoBinding(remote.videoTrack), binding);
  assert.equal(binding.retiring, false);
  assert.equal(binding.confirmed, true);
  assert.equal(manager.currentState.connectionState, 'Generating');
  assert.equal(manager.currentState.reason, null);
});

test('manager configuration disables automatic changes while retaining manual quality control', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => response(init.method === 'POST' ? sessionPayload : {}));
  const manager = new XmaxRealtimeManager(config, { model: 'x2.1', isAdaptiveQualityEnabled: false });
  t.after(() => manager.close());
  const local = await manager.createLocalCameraStream(), rtc = FakeRtc.instances.at(-1), writes = [];
  t.mock.method(rtc, 'writePreference', async (...args) => writes.push(args));
  const start = manager.startGeneration({ localStream: local, context: { prompt: 'portrait' } });
  await nextTurn();
  rtc.emit({ type: 'publication', published: true, stream: { roomID: 'room-1', userID: 'bot-1' } });
  await start;
  assert.equal(manager.uplinkQualityLevel, 1);
  assert.equal(manager.downlinkQualityLevel, 1);
  await manager.setUplinkQualityLevel(3);
  for (let sample = 0; sample < 8; sample++) { rtc.emit({ type: 'quality', quality: { uplink: 'Bad', downlink: 'Bad' } }); await nextTurn(); }
  assert.equal(manager.uplinkQualityLevel, 3);
  assert.equal(manager.downlinkQualityLevel, 1);
  assert.deepEqual(writes, []);
});

test('generation waits for a decoded first frame before audio, initial quality history and Generating state', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => response(init.method === 'POST' ? sessionPayload : {}));
  const { manager, local, rtc } = await readyCamera(t), frame = defer(), stages = [], writes = [];
  t.mock.method(rtc, 'waitUntilRemoteFrameReady', async (remote, signal) => { stages.push(['wait', remote]); await frame.promise; if (signal.aborted) throw { code: 'CANCELLED' }; });
  t.mock.method(rtc, 'setRemoteAudioSubscription', async (_stream, enabled) => stages.push(enabled ? 'audio-on' : 'audio-off'));
  t.mock.method(rtc, 'writePreference', async (...args) => writes.push(args));
  let finished = false;
  const pending = manager.startGeneration({ localStream: local, context: { prompt: 'portrait' } }).then(value => { finished = true; return value; });
  await nextTurn();
  rtc.emit({ type: 'publication', published: true, stream: { roomID: 'room-1', userID: 'bot-1' } });
  await nextTurn();
  assert.equal(finished, false);
  assert.equal(manager.currentState.connectionState, 'Connected');
  assert.equal(stages.length, 1);
  assert.equal(writes.length, 0);
  frame.resolve(); await pending;
  assert.equal(manager.currentState.connectionState, 'Generating');
  assert.equal(stages.at(-1), 'audio-on');
  assert.equal(writes.length, 2);
  await manager.disconnect();
  assert.equal(stages.at(-1), 'audio-off');
});

test('close during first-frame wait cancels startup without enabling result audio or persisting quality', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => response(init.method === 'POST' ? sessionPayload : {}));
  const { manager, local, rtc } = await readyCamera(t), writes = [], audio = [];
  t.mock.method(rtc, 'waitUntilRemoteFrameReady', async (_remote, signal) => waitFor(() => () => {}, signal, 10000, 'test first frame'));
  t.mock.method(rtc, 'setRemoteAudioSubscription', async (_remote, enabled) => audio.push(enabled));
  t.mock.method(rtc, 'writePreference', async (...args) => writes.push(args));
  const pending = manager.startGeneration({ localStream: local, context: { prompt: 'portrait' } });
  const cancelled = assert.rejects(pending, { code: 'CANCELLED' });
  await nextTurn();
  rtc.emit({ type: 'publication', published: true, stream: { roomID: 'room-1', userID: 'bot-1' } });
  await nextTurn(); await manager.close(); await cancelled;
  assert.deepEqual(audio, []); assert.deepEqual(writes, []);
  assert.equal(manager.currentState.connectionState, 'Idle');
});

test('condition updates use source dimensions for interaction and do not reset a gesture on failed submission', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => response(init.method === 'POST' ? sessionPayload : {}));
  const manager = createManager(); t.after(() => manager.close());
  const local = await manager.createLocalImageStream({ fileURL: '/image.jpg' }), rtc = FakeRtc.instances.at(-1);
  const pending = manager.startGeneration({ localStream: local, context: { prompt: 'portrait' } });
  await nextTurn(); rtc.emit({ type: 'publication', published: true, stream: { roomID: 'room-1', userID: 'bot-1' } });
  const remote = await pending, interaction = videoBinding(remote.videoTrack).interaction;
  const revision = interaction.generation;
  interaction.submitInteraction({ viewportSize: { width: 404, height: 308 }, contentMode: 'fit', points: [{ x: 20.2, y: 154 }] }, revision);
  await nextTurn();
  const tracks = rtc.packets.findLast(packet => packet.event === 'tracks');
  assert(Math.abs(tracks.tracks[0][0] - 0.05) < 0.000001);
  assert.equal(tracks.tracks[0][1], 0.5);
  const send = t.mock.method(rtc, 'send', async () => { throw new Error('Submission rejected'); });
  await assert.rejects(manager.startGeneration({ context: { prompt: 'other' } }));
  assert.equal(interaction.generation, revision);
  send.mock.restore();
});

test('repeated connect rejects while generation convenience calls continue to reuse the room', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => response(init.method === 'POST' ? sessionPayload : {}));
  const { manager, local, rtc } = await readyCamera(t);
  const remote = await manager.connect({ localStream: local });
  await assert.rejects(manager.connect({ localStream: local }), { code: 'INVALID_CONFIGURATION' });
  const pending = manager.startGeneration({ localStream: local, context: { prompt: 'portrait' } });
  await nextTurn(); rtc.emit({ type: 'publication', published: true, stream: { roomID: 'room-1', userID: 'bot-1' } });
  assert.equal(await pending, remote);
  assert.equal(rtc.joins, 1);
});

test('Connected and Generating listeners may immediately submit the next foreground operation', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => response(init.method === 'POST' ? sessionPayload : {}));
  const { manager, local, rtc } = await readyCamera(t);
  let starting, changing;
  await manager.setStateListener(state => {
    if (state.connectionState === 'Connected' && !starting)
      starting = manager.startGeneration({ context: { prompt: 'portrait' } });
    if (state.connectionState === 'Generating' && !changing)
      changing = manager.setUplinkQualityLevel(1);
  });
  await manager.connect({ localStream: local });
  await nextTurn(); rtc.emit({ type: 'publication', published: true, stream: { roomID: 'room-1', userID: 'bot-1' } });
  await starting; await changing;
  assert.equal(manager.uplinkQualityLevel, 1);
});

test('first-frame timeout returns to preview without activating audio or recording initial quality', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => response(init.method === 'DELETE' ? {} : sessionPayload));
  const { manager, local, rtc } = await readyCamera(t), writes = [], audio = [];
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(rtc, 'waitUntilRemoteFrameReady', async (_remote, signal) => waitFor(() => () => {}, signal, 10000, 'Remote video first frame'));
  t.mock.method(rtc, 'setRemoteAudioSubscription', async (_remote, enabled) => audio.push(enabled));
  t.mock.method(rtc, 'writePreference', async (...args) => writes.push(args));
  const pending = manager.startGeneration({ localStream: local, context: { prompt: 'portrait' } });
  const timedOut = assert.rejects(pending, { code: 'TIMEOUT' });
  await nextTurn(); rtc.emit({ type: 'publication', published: true, stream: { roomID: 'room-1', userID: 'bot-1' } });
  await nextTurn(); t.mock.timers.tick(10000); await timedOut;
  assert.equal(manager.currentState.connectionState, 'Ready');
  assert.equal(manager.currentState.reason.error.code, 'TIMEOUT');
  assert.deepEqual(audio, []); assert.deepEqual(writes, []);
  assert.equal(rtc.camera, true);
});

test('a new request replaces first-frame waiting while retaining the connected room', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => response(init.method === 'POST' ? sessionPayload : {}));
  const { manager, local, rtc } = await readyCamera(t), seen = [];
  let waiting = 0;
  t.mock.method(rtc, 'waitUntilRemoteFrameReady', async (_remote, signal) => {
    if (++waiting === 1) await waitFor(() => () => {}, signal, 10000, 'test frame');
  });
  t.mock.method(rtc, 'setRemoteAudioSubscription', async (_remote, enabled) => seen.push(enabled));
  const first = manager.startGeneration({ localStream: local, context: { prompt: 'A' } });
  const cancelled = assert.rejects(first, { code: 'CANCELLED' });
  await nextTurn(); rtc.emit({ type: 'publication', published: true, stream: { roomID: 'room-1', userID: 'bot-1' } });
  await nextTurn();
  const latest = manager.startGeneration({ localStream: local, context: { prompt: 'B' } });
  await Promise.all([cancelled, latest]);
  assert.equal(rtc.joins, 1);
  assert.equal(waiting, 2);
  assert.deepEqual(seen, [true]);
  assert.equal(rtc.packets.filter(packet => packet.event === 'start').at(-1).params.prompt, 'B');
});

test('automatic quality is inactive before generation and respects the initial stabilization window', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => response(init.method === 'POST' ? sessionPayload : {}));
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const { manager, local, rtc } = await readyCamera(t);
  await manager.connect({ localStream: local });
  const sample = async time => { now = time; rtc.emit({ type: 'quality', quality: { uplink: 'Bad', downlink: 'Unknown' } }); await nextTurn(); };
  for (const time of [1000, 2000, 3000]) await sample(time);
  assert.equal(manager.uplinkQualityLevel, 2);
  const pending = manager.startGeneration({ context: { prompt: 'portrait' } });
  await nextTurn(); rtc.emit({ type: 'publication', published: true, stream: { roomID: 'room-1', userID: 'bot-1' } });
  await pending;
  for (const time of [4000, 5000, 6000]) await sample(time);
  assert.equal(manager.uplinkQualityLevel, 2);
  for (const time of [8000, 9000, 10000]) await sample(time);
  assert.equal(manager.uplinkQualityLevel, 3);
});

test('public image-data creation snapshots bytes at invocation before lifecycle work starts', async t => {
  const manager = createManager(); t.after(() => manager.close());
  const bytes = new Uint8Array([0, 128, 255]), seen = [];
  t.mock.method(manager.mediaController, 'createImage', async options => {
    seen.push([...options.imageData]);
    return { id: 'encoded', videoTrack: null };
  });
  const pending = manager.createLocalImageStream({ imageData: bytes });
  bytes.fill(7);
  await pending;
  assert.deepEqual(seen, [[0, 128, 255]]);
  for (const options of [{}, { imageData: new Uint8Array() }, { fileURL: 'file:///a.jpg', imageData: bytes }])
    await assert.rejects(manager.createLocalImageStream(options), { code: 'INVALID_CONFIGURATION' });
});

test('camera permissions are owned by the capture controller and microphone denial precedes RTC acquisition', async t => {
  const manager = createManager(); t.after(() => manager.close());
  const rtc = FakeRtc.instances.at(-1), permissions = FakePermissions.instances.at(-1);
  t.mock.method(permissions, 'ensureMicrophonePermission', async () => { throw new XmaxError({ code: 'MICROPHONE_PERMISSION_DENIED', message: 'denied' }); });
  await assert.rejects(manager.createLocalCameraStream({ useMicrophone: true }), { code: 'MICROPHONE_PERMISSION_DENIED' });
  assert.equal(permissions.cameraCalls, 1);
  assert.equal(rtc.camera, false);
  assert.equal('permissions' in rtc, false);
  assert.equal(manager.currentState.connectionState, 'Idle');
});

test('camera restart waits for a fresh quality stabilization window before automatic changes', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => response(init.method === 'DELETE' ? {} : sessionPayload));
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const { manager, local, rtc } = await readyCamera(t);
  const first = manager.startGeneration({ localStream: local, context: { prompt: 'portrait' } });
  await nextTurn(); rtc.emit({ type: 'publication', published: true, stream: { roomID: 'room-1', userID: 'bot-1' } });
  await first;
  now = 100000;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const switching = manager.switchCamera();
  await nextTurn(); t.mock.timers.tick(500); await switching;
  const sample = async time => { now = time; rtc.emit({ type: 'quality', quality: { uplink: 'Bad', downlink: 'Unknown' } }); await nextTurn(); };
  for (const time of [101000, 102000, 103000]) await sample(time);
  assert.equal(manager.uplinkQualityLevel, 2);
  for (const time of [105000, 106000, 107000]) await sample(time);
  assert.equal(manager.uplinkQualityLevel, 3);
  assert.equal(rtc.joins, 1);
});


function externalSource(overrides = {}) {
  const source = {
    videoFormat: { width: 1200, height: 1600, fps: 24 },
    hasAudio: true,
    starts: 0, stops: 0, sink: null,
    async start(sink) { source.starts++; source.sink = sink; },
    async stop() { source.stops++; },
    ...overrides,
  };
  return source;
}

test('external sources preserve aspect ratio and optional audio without SDK capture permissions', async t => {
  const manager = createManager(), source = externalSource();
  t.after(() => manager.close());
  const local = await manager.createExternalVideoStream(source);
  const rtc = FakeRtc.instances.at(-1);
  assert.equal(manager.currentState.connectionState, 'Ready');
  assert.deepEqual(local.videoTrack.videoFormat, source.videoFormat);
  assert.equal(local.videoTrack.position, null);
  assert.equal(manager.currentCameraVideoFormat, null);
  assert.equal(FakePermissions.instances.at(-1).cameraCalls, 0);
  assert.equal(FakePermissions.instances.at(-1).microphoneCalls, 0);
  assert.equal(source.sink.isRequestingFrames, true);
  assert.equal(source.sink.nativeHandle, rtc.external.nativeHandle);
  assert.equal(rtc.external.hasAudio, true);
  assert.deepEqual(rtc.external.sourceFormat, source.videoFormat);
  assert.equal(source.starts, 1);
  assert.equal(manager.localAudioVolume, 0);
  await manager.stopLocalCameraStream();
  await manager.stopLocalImageStream();
  assert.equal(source.sink.isRequestingFrames, true);
  await manager.stopExternalVideoStream();
  assert.equal(source.sink.isRequestingFrames, false);
  assert.equal(source.stops, 1);
  assert.equal(local.videoTrack.videoFormat, null);
  assert.equal(manager.currentState.connectionState, 'Idle');
});

test('external input is exclusive with image and camera input, and small inputs use resolved media dimensions', async t => {
  const manager = createManager();
  t.after(() => manager.close());
  await manager.createLocalImageStream({ fileURL: '/image.jpg' });
  const source = externalSource({ videoFormat: { width: 160, height: 90, fps: 30 }, hasAudio: undefined });
  await assert.rejects(manager.createExternalVideoStream(source), { code: 'INVALID_CONFIGURATION' });
  assert.equal(source.starts, 0);
  await manager.stopLocalImageStream();
  const local = await manager.createExternalVideoStream(source);
  const format = local.videoTrack.videoFormat;
  assert.ok(format.width * format.height >= 200000);
  assert.equal(format.width % 4, 0);
  assert.equal(format.height % 4, 0);
  assert.equal(format.fps, 30);
  assert.deepEqual(source.sink.videoFormat, format);
  assert.equal(FakeRtc.instances.at(-1).external.hasAudio, false);
  await assert.rejects(manager.createLocalCameraStream(), { code: 'INVALID_CONFIGURATION' });
  await assert.rejects(manager.switchCamera(), { code: 'INVALID_CONFIGURATION' });
});

test('external generation and disconnect retain source preview until explicit detachment', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => response(init.method === 'POST' ? sessionPayload : {}));
  const manager = createManager(), source = externalSource();
  t.after(() => manager.close());
  const local = await manager.createExternalVideoStream(source);
  const rtc = FakeRtc.instances.at(-1);
  const pending = manager.startGeneration({ localStream: local, context: { prompt: 'animate' } });
  await nextTurn();
  rtc.emit({ type: 'publication', published: true, stream: { roomID: 'room-1', userID: 'bot-1' } });
  await pending;
  await assert.rejects(manager.stopExternalVideoStream(), { code: 'INVALID_CONFIGURATION' });
  await manager.disconnect();
  assert.equal(manager.currentState.connectionState, 'Ready');
  assert.equal(source.sink.isRequestingFrames, true);
  assert.equal(source.stops, 0);
  assert.deepEqual(local.videoTrack.videoFormat, source.videoFormat);
  await manager.close();
  assert.equal(source.sink.isRequestingFrames, false);
  assert.equal(source.stops, 1);
});

test('external failures invalidate the attachment and cannot terminate a replacement source', async t => {
  const manager = createManager(), first = externalSource();
  t.after(() => manager.close());
  await manager.createExternalVideoStream(first);
  first.sink.reportError(new Error('Capture failed'));
  await nextTurn();
  assert.equal(first.sink.isRequestingFrames, false);
  assert.equal(manager.currentState.connectionState, 'Idle');
  assert.equal(manager.currentState.reason.error.code, 'MEDIA_ERROR');
  assert.equal(first.stops, 1);
  const second = externalSource();
  await manager.createExternalVideoStream(second);
  first.sink.reportError(new Error('Late failure'));
  await nextTurn();
  assert.equal(manager.currentState.connectionState, 'Ready');
  assert.equal(second.sink.isRequestingFrames, true);
});

test('failed external startup stops the producer and permits a new attachment', async t => {
  const manager = createManager(), source = externalSource({ async start(sink) { this.sink = sink; throw new Error('Startup failed'); } });
  t.after(() => manager.close());
  await assert.rejects(manager.createExternalVideoStream(source));
  assert.equal(source.sink.isRequestingFrames, false);
  assert.equal(source.stops, 1);
  assert.equal(FakeRtc.instances.at(-1).closed, true);
  assert.equal(manager.currentState.connectionState, 'Idle');
  const second = externalSource();
  await manager.createExternalVideoStream(second);
  assert.equal(second.sink.isRequestingFrames, true);
});

test('cancelling external startup invalidates a late producer without releasing its replacement', async t => {
  const manager = createManager(), gate = defer(), abort = new AbortController();
  t.after(() => manager.close());
  const source = externalSource({ async start(sink) { this.sink = sink; await gate.promise; } });
  const pending = manager.createExternalVideoStream(source, { signal: abort.signal });
  await nextTurn();
  abort.abort();
  await assert.rejects(pending, { code: 'CANCELLED' });
  assert.equal(source.sink.isRequestingFrames, false);
  const second = externalSource();
  await manager.createExternalVideoStream(second);
  gate.resolve();
  await nextTurn();
  assert.ok(source.stops >= 1);
  assert.equal(second.stops, 0);
  assert.equal(second.sink.isRequestingFrames, true);
  assert.equal(manager.currentState.connectionState, 'Ready');
});

for (const override of [{ videoFormat: { width: 0, height: 720, fps: 30 } }, { videoFormat: { width: 1280, height: 720, fps: 0 } }, { hasAudio: 'yes' }]) {
  test(`invalid external declarations reject before starting native input (${JSON.stringify(override)})`, async t => {
    const manager = createManager(), source = externalSource(override);
    t.after(() => manager.close());
    await assert.rejects(manager.createExternalVideoStream(source), { code: 'INVALID_CONFIGURATION' });
    assert.equal(source.starts, 0);
    assert.equal(FakeRtc.instances.at(-1).external, undefined);
  });
}
