const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const tick = () => new Promise(resolve => setImmediate(resolve));

let metadataReads = 0;
mock.module('react-native', {
  namedExports: {
    Platform: { OS: 'ios' },
    PermissionsAndroid: {},
    AppState: { addEventListener: () => ({ remove() {} }) },
  },
});
mock.module(require.resolve('../lib/commonjs/Foundation/Native/NativeXmaxRuntime.js'), {
  defaultExport: {
    runtimeInfo() { metadataReads++; return '{}'; },
    randomUUID: () => 'native-owner',
  },
});

const { XmaxRealtimeFactory } = require('../lib/commonjs/Core/Realtime/XmaxRealtimeFactory');
const { XmaxRealtimeManager } = require('../lib/commonjs/Core/Realtime/XmaxRealtimeManager');
const { XmaxRealtimeErrorManager } = require('../lib/commonjs/Core/Realtime/XmaxRealtimeErrorManager');
const { XmaxError, XmaxErrorCode } = require('../lib/commonjs/Foundation/Errors/XmaxError');
const { MediaController } = require('../lib/commonjs/Media/MediaController');
const { InteractionController } = require('../lib/commonjs/Media/Interaction/InteractionController');

function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}

// Replace resource boundaries while exercising the actual factory, error manager,
// operation admission, and cleanup implementation.
function fixture({ hide, disconnect, render } = {}) {
  const calls = [];
  const mediaController = {
    stream: { id: 'local', videoTrack: null },
    async close() { calls.push('media.close'); this.stream = null; },
    stopInteraction() { calls.push('interaction.stop'); },
  };
  const connectionManager = {
    lastSessionID: 'session', session: { id: 'session' },
    async disconnect() {
      calls.push('connection.disconnect');
      await disconnect?.();
      this.session = null;
    },
  };
  const dependencies = {
    mediaController, connectionManager,
    generationManager: { async reset() { calls.push('generation.reset'); } },
    renderController: render ?? {
      setPreviewReadyListener(listener) { this.onPreviewReady = listener; },
      setBindingFailureListener(listener) { this.onBindingFailure = listener; },
      async hideRemote() { calls.push('render.hide'); await hide?.(); },
      invalidate() { calls.push('render.invalidate'); },
    },
    streamController: { quality: { reset() { calls.push('quality.reset'); } } },
    mediaService: {},
    rtcManager: { stopLocalCapture() { calls.push('capture.pause'); } },
    errorManager: new XmaxRealtimeErrorManager(),
  };
  const components = XmaxRealtimeFactory.assemble(dependencies);
  return { calls, components, mediaController, connectionManager };
}

async function connected(components) {
  await components.lifecycleManager.run('connection', async token => {
    components.lifecycleManager.commit({
      connectionState: 'Connected', sessionID: 'session', taskID: null, reason: null,
    }, token);
  });
}

test('an injected realtime graph bypasses default native construction and preserves state listeners during cleanup', async () => {
  const { components, calls } = fixture();
  const before = metadataReads;
  const manager = new XmaxRealtimeManager(
    { apiKey: '', environment: 'china', loggerOptions: 0, baseURL: null },
    { model: 'x2.1' }, components,
  );
  assert.equal(metadataReads, before);
  const states = [], uplink = [], downlink = [];
  await manager.setStateListener(state => states.push(state.connectionState));
  await connected(components);
  await manager.setUplinkVideoStatisticsListener(value => uplink.push(value));
  await manager.setDownlinkVideoStatisticsListener(value => downlink.push(value));
  await manager.close();
  assert.deepEqual(states, ['Idle', 'Connected', 'Disconnecting', 'Idle']);
  assert.deepEqual(uplink, [null]);
  assert.equal(downlink.at(-1), null);
  assert(calls.indexOf('render.hide') < calls.indexOf('connection.disconnect'));
  assert(calls.indexOf('connection.disconnect') < calls.indexOf('media.close'));
  assert(calls.indexOf('capture.pause') < calls.indexOf('media.close'));
});

test('scoped disconnect retains media while close escalation waits for pending remote cleanup', async () => {
  const gate = deferred();
  const { components, calls, mediaController } = fixture({ hide: () => gate.promise });
  await connected(components);
  const scopes = [];
  components.lifecycleManager.setCleanupListener(scope => scopes.push(scope));
  const first = components.lifecycleManager.disconnect();
  await tick();
  assert.equal(calls.includes('media.close'), false);
  const expanded = components.lifecycleManager.terminate('all');
  assert.strictEqual(expanded, first);
  assert.equal(calls.includes('capture.pause'), true);
  assert.notEqual(mediaController.stream, null);
  gate.resolve();
  await first;
  assert.equal(mediaController.stream, null);
  assert.equal(calls.filter(call => call === 'media.close').length, 1);
  assert.deepEqual(scopes, ['connection', 'connection', 'all']);
  assert.equal(components.lifecycleManager.currentState.connectionState, 'Idle');
});

test('connection cleanup preserves the existing local media and reports Ready', async () => {
  const { components, calls, mediaController } = fixture();
  await connected(components);
  const stream = mediaController.stream;
  await components.lifecycleManager.disconnect();
  assert.strictEqual(mediaController.stream, stream);
  assert.equal(calls.includes('media.close'), false);
  assert.equal(calls.includes('render.invalidate'), false);
  assert.equal(components.lifecycleManager.currentState.connectionState, 'Ready');
});

test('a connection cleanup failure still releases local media and invalidates render bindings', async () => {
  const failure = new XmaxError({ code: XmaxErrorCode.rtcError, message: 'fixture' });
  const { components, calls } = fixture({ disconnect: () => { throw failure; } });
  await connected(components);
  await components.lifecycleManager.terminate('all');
  assert(calls.includes('media.close'));
  assert(calls.includes('render.invalidate'));
  assert.strictEqual(components.lifecycleManager.currentState.reason.error, failure);
});

test('runtime failures use the assembled cleanup owner and preserve the normalized error', async () => {
  const { components, mediaController } = fixture();
  await connected(components);
  const failure = new XmaxError({ code: XmaxErrorCode.rtcError, message: 'fixture' });
  components.errorManager.forward(failure, 'connection');
  await components.lifecycleManager.disconnect();
  assert.equal(components.lifecycleManager.currentState.connectionState, 'Ready');
  assert.strictEqual(components.lifecycleManager.currentState.reason.error, failure);
  assert.notEqual(mediaController.stream, null);
});

test('failure revisions invalidate connection callbacks independently from retained media', () => {
  const errors = new XmaxRealtimeErrorManager();
  const callbacks = [];
  errors.setFailureHandler((error, target, isCurrent) => callbacks.push({ error, target, isCurrent }));
  errors.forward(new Error('fixture'), 'connection');
  errors.forward(new Error('fixture'), 'all');
  assert(callbacks[0].error instanceof XmaxError);
  assert(callbacks[0].isCurrent());
  errors.invalidatePendingFailures('connection');
  assert.equal(callbacks[0].isCurrent(), false);
  assert.equal(callbacks[1].isCurrent(), true);
  errors.invalidatePendingFailures('all');
  assert.equal(callbacks[1].isCurrent(), false);
});

test('the media owner exposes the original interaction revision and mapping controller', async () => {
  const sent = [];
  const interaction = new InteractionController((taskID, points) => sent.push({ taskID, points }));
  const media = new MediaController({}, {}, interaction);
  let changes = 0;
  const unsubscribe = media.subscribe(() => changes++);
  media.startInteraction('task', { width: 100, height: 100, fps: 30 });
  assert.equal(media.isActive, true);
  media.submitInteraction({
    points: [{ x: 25, y: 50 }], viewportSize: { width: 100, height: 100 }, contentMode: 'fit',
  }, media.generation);
  await tick();
  assert.deepEqual(sent, [{ taskID: 'task', points: [{ x: 0.25, y: 0.5 }] }]);
  media.stopInteraction();
  assert.equal(media.isActive, false);
  assert.equal(changes, 2);
  unsubscribe();
});


test('injected render readiness is wired to the current media binding during assembly', async () => {
  const { RenderController } = require('../lib/commonjs/Render/RenderController');
  const { videoBinding } = require('../lib/commonjs/Render/Video/VideoRenderRegistry');
  let next = 0;
  const render = new RenderController({}, { randomUUID: () => `binding-${++next}` });
  const { components, mediaController } = fixture({ render });
  const format = { width: 1080, height: 1920, fps: 30 };
  const old = render.create(true, format, 'front');
  const current = render.create(true, format, 'front');
  mediaController.stream = current;
  await components.lifecycleManager.run('media', async token => {
    components.lifecycleManager.commit({
      connectionState: 'Preparing', sessionID: null, taskID: null, reason: null,
    }, token);
  });
  videoBinding(old.videoTrack).onPreviewReady();
  assert.equal(components.lifecycleManager.currentState.connectionState, 'Preparing');
  videoBinding(current.videoTrack).onPreviewReady();
  assert.equal(components.lifecycleManager.currentState.connectionState, 'Ready');

  const retired = videoBinding(old.videoTrack);
  retired.valid = false;
  retired.onBindingFailure(new Error('retired binding'));
  assert.equal(components.lifecycleManager.currentState.connectionState, 'Ready');
  videoBinding(current.videoTrack).onBindingFailure(new Error('current binding'));
  await components.lifecycleManager.terminate('all');
  assert.equal(components.lifecycleManager.currentState.connectionState, 'Idle');
  assert.equal(mediaController.stream, null);
});
