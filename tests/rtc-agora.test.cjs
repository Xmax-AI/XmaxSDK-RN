const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const tick = () => new Promise(resolve => setImmediate(resolve));
const calls = [], callbacks = new Set();
let owner = null, next = 0;
const native = {
  runtimeInfo: () => JSON.stringify({ platform: 'ios', os_version: '27' }),
  randomUUID: () => `owner-${++next}`,
  prepareRuntime: async () => {},
  acquire(value) { if (owner) return false; owner = value; return true; },
  isActive: value => value === owner,
  release(value) { if (value === owner) owner = null; },
  onRtcEvent(callback) { callbacks.add(callback); return { remove: () => callbacks.delete(callback) }; },
  async rtcCommand(lease, value) {
    const command = JSON.parse(value); calls.push({ owner: lease, ...command });
    if (command.operation === 'camera') emit({ type: 'localFrame' });
    if (command.operation === 'join') emit({ type: 'joined', roomID: command.roomID });
    return 'null';
  },
};
function emit(event, lease = owner) {
  const value = JSON.stringify({ owner: lease, roomID: 'room', ...event });
  for (const callback of [...callbacks]) callback(value);
}
mock.module('react-native', { namedExports: { Platform: { OS: 'ios' }, PermissionsAndroid: {} } });
mock.module(require.resolve('../lib/commonjs/Foundation/Native/NativeXmaxRuntime.js'), { defaultExport: native });
const { RtcManager } = require('../lib/commonjs/Foundation/RTC/RtcManager');
const { encodeRoomMessage, utf8Length, RtcMessageQueue } = require('../lib/commonjs/Foundation/RTC/RtcMessageQueue');
const format = { width: 1024, height: 1920, fps: 30 };
async function fixture(t, joined = true) {
  const rtc = new RtcManager();
  await rtc.open(new AbortController().signal);
  t.after(() => rtc.close());
  if (joined) await rtc.join({ roomID: 'room', userID: 'local', token: 'test-token', botName: 'bot' }, false, new AbortController().signal);
  return rtc;
}

test('camera and native image calls preserve source format without JS video buffers', async t => {
  const rtc = await fixture(t, false);
  await rtc.startCamera(format, 'front', new AbortController().signal);
  await rtc.configureImageSource();
  await rtc.startImage('/prepared/image.jpg', format);
  const image = calls.findLast(call => call.operation === 'startImage');
  assert.deepEqual({ width: image.width, height: image.height, fps: image.fps }, format);
  assert.equal(image.path, '/prepared/image.jpg');
  assert.equal('buffer' in image, false);
});

test('encoder defaults to frame rate priority and preserves explicit policies', async t => {
  const rtc = await fixture(t, false);
  for (const preference of [undefined, 'auto', 'maintainQuality', 'maintainFramerate']) {
    await rtc.configureEncoding({ ...format, encoderPreference: preference }, 100, 3600);
    const call = calls.at(-1);
    assert.equal(call.preference, preference ?? 'maintainFramerate');
    assert.equal(call.minimum, 100); assert.equal(call.maximum, 3600);
  }
});

test('publication and render before account mapping are delivered with the correct remote account', async t => {
  const rtc = await fixture(t), events = [];
  rtc.onEvent(event => events.push(event));
  emit({ type: 'publication', uid: 42, published: true });
  emit({ type: 'rendered', uid: 42, width: 800, height: 1500 });
  assert.equal(events.length, 0);
  emit({ type: 'account', uid: 42, userID: 'bot' });
  await tick();
  assert.equal(events[0].type, 'publication');
  assert.deepEqual(events[1].stream, { roomID: 'room', userID: 'bot' });
  assert.equal(calls.at(-1).operation, 'subscribe');
  assert.deepEqual(rtc.publishedStreams, [{ roomID: 'room', userID: 'bot' }]);
});

test('wrong-room and unrelated remote events do not reveal or report another stream', async t => {
  const rtc = await fixture(t), events = [];
  rtc.onEvent(event => events.push(event));
  emit({ type: 'account', uid: 3, userID: 'other' });
  emit({ type: 'rendered', uid: 3, width: 1, height: 1 });
  emit({ type: 'account', uid: 4, userID: 'bot', roomID: 'old-room' });
  assert.equal(events.length, 0);
});

test('native lease prevents an old event source from mutating a replacement manager', async t => {
  const first = await fixture(t, false), previous = owner;
  await first.close();
  const second = await fixture(t, false), events = [];
  second.onEvent(event => events.push(event));
  emit({ type: 'error', code: 9 }, previous);
  emit({ type: 'localFrame' });
  assert.deepEqual(events, [{ type: 'localFrame' }]);
  assert.equal(callbacks.size, 1);
});

test('recycled video bindings cannot detach their replacement', async t => {
  const rtc = await fixture(t, false);
  rtc.bind('old', null, 'fit');
  rtc.bind('new', null, 'fill');
  const before = calls.length;
  rtc.unbind('old', null);
  await tick();
  assert.equal(calls.length, before);
  rtc.unbind('new', null);
  await tick();
  assert.equal(calls.at(-1).operation, 'unbind');
});

test('statistics expose measured metrics and normalize unavailable dimensions', async t => {
  const rtc = await fixture(t), events = [];
  rtc.onEvent(event => events.push(event));
  emit({ type: 'uplinkStatistics', width: 0, height: -1, sendFrameRate: 24, bitrateKbps: 600, packetLossPercent: -1 });
  const stats = events[0].statistics;
  assert.equal(stats.width, null); assert.equal(stats.height, null);
  assert.equal(stats.sendFrameRate, 24); assert.equal(stats.captureFrameRate, null);
  assert.equal(stats.packetLossPercent, null);
});

test('chunk codec preserves Chinese, emoji, quotes and backslashes within native packet limits', () => {
  const value = JSON.stringify({ event: 'start', prompt: '中文🙂"\\'.repeat(600) });
  const packets = encodeRoomMessage(value, 'test-id');
  assert(packets.length > 1);
  assert(packets.every(packet => utf8Length(packet) <= 1024));
  assert.equal(packets.map(packet => JSON.parse(packet).data).join(''), value);
  assert.equal(JSON.parse(packets[0]).event, '__agora_chunk__');
  assert.equal(encodeRoomMessage('a'.repeat(800), 'id').length, 1);
  assert.throws(() => encodeRoomMessage('', 'id'), { code: 'INVALID_CONFIGURATION' });
  assert.throws(() => encodeRoomMessage('a'.repeat(262145), 'id'), { code: 'INVALID_CONFIGURATION' });
});

test('message queue coalesces only unsent tracks while keeping control-message order', async () => {
  let release;
  const packets = [];
  const queue = new RtcMessageQueue(async packet => {
    packets.push(packet);
    if (packets.length === 1) await new Promise(resolve => { release = resolve; });
  }, () => 'id');
  const start = queue.enqueue('start');
  await tick();
  const first = queue.enqueue('old-tracks', 'tracks:task');
  const latest = queue.enqueue('new-tracks', 'tracks:task');
  const stop = queue.enqueue('stop');
  release();
  await Promise.all([start, first, latest, stop]);
  assert.deepEqual(packets, ['start', 'new-tracks', 'stop']);
  queue.close();
});

test('closing a rate-limited message queue rejects pending work and wakes the active wait', async () => {
  let release;
  const queue = new RtcMessageQueue(async () => new Promise(resolve => { release = resolve; }), () => 'id');
  const first = queue.enqueue('start');
  await tick();
  const pending = queue.enqueue('stop');
  const rejected = assert.rejects(pending, { code: 'CANCELLED' });
  queue.close();
  release();
  await first;
  await rejected;
  await assert.rejects(queue.enqueue('late'), { code: 'CANCELLED' });
});

test('deferred remote canvases bind once after account resolution and detach before leave', async t => {
  const rtc = await fixture(t), stream = { roomID: 'room', userID: 'bot' };
  const before = calls.length;
  await rtc.bind('remote-canvas', stream, 'fit');
  assert.equal(calls.length, before);
  emit({ type: 'account', uid: 42, userID: 'bot' });
  emit({ type: 'account', uid: 42, userID: 'bot' });
  await tick();
  assert.equal(calls.slice(before).filter(call => call.operation === 'bind').length, 1);
  await rtc.leave();
  assert.deepEqual(calls.slice(-2).map(call => call.operation), ['unbind', 'leave']);
});

test('retiring a task discards queued tracks before the ordered stop command', async () => {
  let release;
  const packets = [];
  const queue = new RtcMessageQueue(async value => {
    packets.push(value);
    if (packets.length === 1) await new Promise(resolve => { release = resolve; });
  }, () => 'id');
  const first = queue.enqueue('start');
  await tick();
  const retired = queue.enqueue('stale-touch', 'tracks:old');
  const rejected = assert.rejects(retired, { code: 'CANCELLED' });
  queue.drop('tracks:old');
  const stop = queue.enqueue('stop');
  release();
  await Promise.all([first, rejected, stop]);
  assert.deepEqual(packets, ['start', 'stop']);
  queue.close();
});

for (const [bytes, count, limit] of [[1, 60, 58], [800, 40, 36]]) {
  test(`rolling budget delays excess ${bytes}-byte packets without reordering`, async () => {
    const packets = [];
    const queue = new RtcMessageQueue(async value => packets.push({ value, at: performance.now() }), () => 'id');
    await Promise.all(Array.from({ length: count }, () => queue.enqueue('a'.repeat(bytes))));
    assert.equal(packets.length, count);
    assert(packets[limit].at - packets[0].at >= 990);
    for (const packet of packets) {
      const window = packets.filter(sample => sample.at > packet.at - 1000 && sample.at <= packet.at);
      assert(window.length <= 58);
      assert(window.length * bytes <= 29000);
    }
    queue.close();
  });
}

test('capture-ready callback allows track creation before the first preview canvas exists', async t => {
  const rtc = await fixture(t, false);
  const original = native.rtcCommand;
  t.mock.method(native, 'rtcCommand', async (lease, value) => {
    if (JSON.parse(value).operation === 'camera') {
      emit({ type: 'captureReady' });
      return 'null';
    }
    return original(lease, value);
  });
  await rtc.startCamera(format, 'front', new AbortController().signal);
});

test('unrecoverable native media configuration errors request full resource cleanup', async t => {
  const rtc = await fixture(t, false), events = [];
  rtc.onEvent(event => events.push(event));
  emit({ type: 'error', code: -1, scope: 'all' });
  assert.equal(events.at(-1).scope, 'all');
  emit({ type: 'error', code: 7, scope: 'unsupported' });
  assert.equal(events.at(-1).scope, undefined);
});

test('camera format updates use one native command and are rejected while joined', async t => {
  const rtc = await fixture(t, false);
  await rtc.startCamera(format, 'front', new AbortController().signal);
  const before = calls.length;
  const next = { width: 1408, height: 1408, fps: 24, encoderPreference: 'auto' };
  await rtc.updateCameraFormat(next, 500, 3000);
  assert.equal(calls.length, before + 1);
  assert.equal(calls.at(-1).operation, 'updateCameraFormat');
  assert.equal(calls.at(-1).minimum, 500);
  assert.equal(calls.at(-1).preference, 'auto');
  await rtc.join({ roomID: 'room', userID: 'local', token: 'test-token', botName: 'bot' }, false, new AbortController().signal);
  const joinedCalls = calls.length;
  await assert.rejects(rtc.updateCameraFormat(next, 500, 3000), { code: 'INVALID_CONFIGURATION' });
  assert.equal(calls.length, joinedCalls);
});

test('local publication timing events require the current room and native owner', async t => {
  const rtc = await fixture(t), events = [];
  rtc.onEvent(event => events.push(event));
  emit({ type: 'localPublished', roomID: 'old-room' });
  emit({ type: 'localPublished' }, 'retired-owner');
  assert.deepEqual(events, []);
  emit({ type: 'localPublished' });
  assert.deepEqual(events, [{ type: 'localPublished' }]);
  await rtc.leave();
  emit({ type: 'localPublished' });
  assert.equal(events.length, 1);
});

test('first-frame readiness is headless, one-shot and bound to the requested room, account and token', async t => {
  const rtc = await fixture(t);
  emit({ type: 'account', uid: 42, userID: 'bot' });
  const controller = new AbortController();
  let ready = false;
  const pending = rtc.waitUntilRemoteFrameReady({ roomID: 'room', userID: 'bot' }, controller.signal).then(() => { ready = true; });
  const observation = calls.findLast(call => call.operation === 'observeRemoteFrame');
  assert.equal(observation.uid, 42);
  assert(!calls.some(call => call.operation === 'bind' && call.owner === owner));
  emit({ type: 'decoded', uid: 42, width: 1024, height: 1920 });
  emit({ type: 'remoteFrameReady', uid: 42, token: 'old-token' });
  emit({ type: 'remoteFrameReady', uid: 42, token: observation.token, roomID: 'old-room' });
  await tick(); assert.equal(ready, false);
  emit({ type: 'remoteFrameReady', uid: 42, token: observation.token });
  await pending;
  assert.equal(calls.findLast(call => call.operation === 'clearRemoteFrame').token, observation.token);
  const next = rtc.waitUntilRemoteFrameReady({ roomID: 'room', userID: 'bot' }, controller.signal);
  const cancelled = assert.rejects(next, { code: 'CANCELLED' });
  const token = calls.findLast(call => call.operation === 'observeRemoteFrame').token;
  assert.notEqual(token, observation.token);
  emit({ type: 'remoteFrameReady', uid: 42, token: observation.token });
  controller.abort(); await cancelled;
});

test('first-frame timeout and audio subscription remain separate from video subscription and volume', async t => {
  const rtc = await fixture(t);
  emit({ type: 'account', uid: 42, userID: 'bot' });
  emit({ type: 'publication', uid: 42, published: true });
  await tick();
  assert.equal(calls.at(-1).operation, 'subscribe');
  await rtc.setRemoteAudioSubscription({ roomID: 'room', userID: 'bot' }, true);
  assert.deepEqual({ uid: calls.at(-1).uid, enabled: calls.at(-1).enabled, operation: calls.at(-1).operation }, { uid: 42, enabled: true, operation: 'remoteAudio' });
  assert.notEqual(calls.at(-1).operation, 'volume');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = rtc.waitUntilRemoteFrameReady({ roomID: 'room', userID: 'bot' }, new AbortController().signal);
  const timedOut = assert.rejects(pending, { code: 'TIMEOUT' });
  t.mock.timers.tick(10000);
  await timedOut;
  assert.equal(calls.at(-1).operation, 'clearRemoteFrame');
});

test('engine leases queue in order, cancel pending acquisition and ignore stale release', async t => {
  const { RtcEngineManager } = require('../lib/commonjs/Foundation/RTC/RtcEngineManager');
  const engines = new RtcEngineManager();
  let active = null, count = 0;
  const platform = { prepareRuntime: async () => {}, randomUUID: () => `lease-${++count}`, acquire(id) { assert.equal(active, null); active = id; return true; }, release(id) { assert.equal(active, id); active = null; } };
  const first = await engines.acquire(platform, new AbortController().signal);
  const abort = new AbortController();
  const second = engines.acquire(platform, abort.signal);
  const cancelled = assert.rejects(second, { code: 'CANCELLED' });
  let third;
  const next = engines.acquire(platform, new AbortController().signal).then(lease => { third = lease; return lease; });
  abort.abort(); await cancelled; await tick();
  assert.equal(third, undefined);
  engines.release(first); const thirdLease = await next;
  assert.equal(active, thirdLease.id); assert.equal(count, 2);
  engines.release(first); assert.equal(active, thirdLease.id);
  engines.release(thirdLease); assert.equal(active, null);
});

test('closing a manager cancels its queued acquisition without closing another owner', async t => {
  const first = await fixture(t, false);
  const second = new RtcManager();
  const waiting = second.open(new AbortController().signal);
  const cancelled = assert.rejects(waiting, { code: 'CANCELLED' });
  await tick(); const current = owner;
  await second.close(); await cancelled;
  assert.equal(owner, current);
  await first.startImage('/prepared/image.jpg', format);
});

test('failed native engine startup returns its lease and removes its native subscription', async t => {
  const first = new RtcManager(), original = native.rtcCommand;
  native.rtcCommand = async (lease, value) => {
    if (JSON.parse(value).operation === 'open') throw new Error('engine initialization');
    return original(lease, value);
  };
  try { await assert.rejects(first.open(new AbortController().signal), /engine initialization/); }
  finally { native.rtcCommand = original; }
  assert.equal(owner, null); assert.equal(callbacks.size, 0);
  await fixture(t, false);
});

test('room retirement clears deferred mappings and remote bindings without invalidating local preview', async t => {
  const rtc = await fixture(t), events = [];
  await rtc.bind('local-preview', null, 'fit');
  rtc.onEvent(event => events.push(event));
  emit({ type: 'account', uid: 20, userID: 'bot' });
  await rtc.bind('remote-preview', { roomID: 'room', userID: 'bot' }, 'fit');
  await rtc.leave();
  const start = calls.length;
  emit({ type: 'account', uid: 20, userID: 'bot', roomID: 'retired-room' });
  rtc.unbind('remote-preview', { roomID: 'room', userID: 'bot' });
  await tick(); assert.equal(calls.length, start);
  rtc.unbind('local-preview', null); await tick();
  assert.equal(calls.at(-1).operation, 'unbind'); assert.equal(calls.at(-1).uid, 0);
  assert.deepEqual(rtc.publishedStreams, []);
});

test('permission manager requests camera and microphone independently and normalizes denial', async () => {
  const { PermissionManager } = require('../lib/commonjs/Foundation/Permissions/PermissionManager');
  const requested = [];
  const permissions = new PermissionManager(async permission => { requested.push(permission); return permission === 'camera'; });
  await permissions.ensureCameraPermission();
  await assert.rejects(permissions.ensureMicrophonePermission(), { code: 'MICROPHONE_PERMISSION_DENIED' });
  assert.deepEqual(requested, ['camera', 'microphone']);
  const failure = new PermissionManager(async () => { throw new Error('native authorization'); });
  await assert.rejects(failure.ensureCameraPermission(), { code: 'CAMERA_PERMISSION_DENIED' });
});

test('RTC facade accepts an injected platform, room and lease manager independently of permissions', async () => {
  const { RtcEngineManager } = require('../lib/commonjs/Foundation/RTC/RtcEngineManager');
  const activity = [];
  let rawListener, roomListener, held = false;
  const room = {
    publishedStreams: [],
    setEventListener(listener) { roomListener = listener; },
    async join(microphone) { activity.push(['join', microphone]); roomListener({ type: 'joined' }); },
    receive(event) { if (event.type === 'test-publication') roomListener({ type: 'publication', published: true, stream: { roomID: 'injected', userID: 'result' } }); },
    async destroy() { activity.push(['destroy']); },
  };
  const platform = {
    runtime: { platform: 'ios', os_version: '27', sdk_version: 'fixture', device_model: 'test' },
    randomUUID: () => 'injected-owner', prepareRuntime: async () => {},
    acquire() { held = true; return true; }, isActive() { return held; }, release() { held = false; },
    onEvent(_owner, listener) { rawListener = listener; return () => { rawListener = null; }; },
    async execute(_owner, operation) { activity.push([operation]); return 'null'; },
    createRoom() { return room; },
  };
  const rtc = new RtcManager(platform, new RtcEngineManager());
  const events = []; rtc.onEvent(event => events.push(event));
  await rtc.open(new AbortController().signal);
  await rtc.join({ roomID: 'injected', userID: 'local', token: 'test' }, true, new AbortController().signal);
  rawListener({ type: 'test-publication' });
  assert.equal(events[0].stream.userID, 'result');
  await rtc.close();
  assert.equal(held, false); assert.equal(rawListener, null);
  assert(activity.some(([kind]) => kind === 'destroy'));
});

test('RTC room admission times out at fifteen seconds and removes its waiter', async t => {
  const rtc = await fixture(t, false), original = native.rtcCommand;
  t.mock.method(native, 'rtcCommand', async (lease, value) => {
    if (JSON.parse(value).operation === 'join') return 'null';
    return original(lease, value);
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let settled = false;
  const joining = rtc.join({ roomID: 'room', userID: 'local', token: 'test-token' }, false, new AbortController().signal);
  const failure = assert.rejects(joining, { code: 'TIMEOUT' }).then(() => { settled = true; });
  await tick(); t.mock.timers.tick(14999); await tick(); assert.equal(settled, false);
  t.mock.timers.tick(1); await failure;
  emit({ type: 'joined', roomID: 'room' });
  await rtc.leave();
  assert.deepEqual(rtc.publishedStreams, []);
});
