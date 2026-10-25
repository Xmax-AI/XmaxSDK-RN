const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { Module } = require('node:module');
const ts = require('typescript');

const tick = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Exercise the real screen and panel handlers with controlled async SDK results.
// Native views are element records; hooks retain state and effect dependencies.
function hooks() {
  const slots = [], cleanups = [];
  let cursor = 0, effects = [];
  const memo = (create, deps) => {
    const index = cursor++, previous = slots[index];
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i])))
      slots[index] = { value: create(), deps };
    return slots[index].value;
  };
  return {
    react: {
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = initial;
        return [slots[index], value => {
          slots[index] = typeof value === 'function' ? value(slots[index]) : value;
        }];
      },
      useRef: initial => memo(() => ({ current: initial }), []),
      useMemo: memo,
      useCallback: (callback, deps) => memo(() => callback, deps),
      useEffect(effect, deps) {
        const index = cursor;
        memo(() => { effects.push(() => {
          cleanups[index]?.();
          cleanups[index] = effect();
        }); }, deps);
      },
    },
    render(Component, props) {
      cursor = 0;
      const tree = Component(props);
      const pending = effects;
      effects = [];
      pending.forEach(effect => effect());
      return tree;
    },
    dispose: () => cleanups.splice(0).forEach(cleanup => cleanup?.()),
  };
}

const appStateListeners = new Set();
const native = {
  ...Object.fromEntries(['Alert', 'Image', 'KeyboardAvoidingView', 'Modal', 'Pressable',
    'ScrollView', 'Text', 'TextInput', 'View'].map(name => [name, name])),
  AppState: { currentState: 'active', addEventListener: (_event, listener) => {
    appStateListeners.add(listener);
    return { remove: () => appStateListeners.delete(listener) };
  } },
  Keyboard: { dismiss() {}, addListener: () => ({ remove() {} }) },
  Platform: { OS: 'ios' },
  useWindowDimensions: () => ({ width: 390, height: 844 }),
  StyleSheet: { create: styles => styles, absoluteFill: {} },
};
const catalog = {
  realtimeCategories: [{ id: 'charx', content: 'references', name: 'Character' },
    { id: 'mox', content: 'instruction', defaultPrompt: 'Animate' }],
  realtimeReferences: [{ id: 'first', categoryID: 'charx', uploadState: 'ready',
    referencePath: 'reference.jpg', prompt: 'Transform' },
    { id: 'second', categoryID: 'charx', uploadState: 'ready', referencePath: 'second.jpg', prompt: 'Second' }],
};

function load(relative, react, mocks = {}) {
  const filename = resolve(__dirname, '../Example/XLab/src', relative);
  const source = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const loaded = new Module(filename);
  loaded.require = name => {
    if (name === 'react') return react;
    if (name === 'react-native') return native;
    if (name === 'react/jsx-runtime') {
      const jsx = (type, props) => ({ type, props });
      return { jsx, jsxs: jsx };
    }
    if (name in mocks) return mocks[name];
    if (name.endsWith('/LocalizationProvider')) return { useLocalization: () => ({ t: translateUI, locale }) };
    if (name.endsWith('/ErrorMessages')) return load('localization/ErrorMessages.ts', {});
    if (name.endsWith('RealtimeReferenceCatalog')) return catalog;
    if (name.endsWith('.png')) return name;
    if (name.endsWith('/RealtimeStatisticsPanel')) return { RealtimeStatisticsPanel: 'RealtimeStatisticsPanel' };
    throw new Error(`Missing boundary: ${name}`);
  };
  loaded._compile(source, filename);
  return loaded.exports;
}

const localization = load('localization/Localization.ts', {}, {
  './messages': load('localization/messages.ts', {}),
});
let locale = 'zh-Hans';
const translateUI = (key, parameters) => localization.translate(locale, key, parameters);

function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return;
  if (predicate(tree)) return tree;
  for (const child of [tree.props?.children].flat(Infinity)) {
    const found = find(child, predicate);
    if (found) return found;
  }
}

function panelFixture(t, initialCategoryID) {
  const h = hooks(), submitted = [], failures = [];
  let stopped = 0, update;
  const { RealtimeControlPanel: Panel } = load('realtime/RealtimeControlPanel.tsx', h.react, {
    'react-native-image-picker': {},
    './RealtimeReferenceList': { RealtimeReferenceList: 'ReferenceList' },
    './ReferenceThumbnail': { ReferenceThumbnail: 'Thumbnail' },
    './ReferenceUploadOverlay': { ReferenceUploadOverlay: 'UploadOverlay' },
    './useReferenceUploads': { useReferenceUploads: (_key, _env, _baseURL, callback) => { update = callback; return {}; } },
  });
  const props = { initialCategoryID, bottomInset: 0, prompt: '', canSubmit: true, connected: false,
    generating: false, generationRequested: false, onSubmit: (value, failure) => { submitted.push(value); failures.push(failure); },
    onStop: () => stopped++ };
  const draw = () => h.render(Panel, props);
  const list = () => find(draw(), node => node.type === 'ReferenceList').props;
  t.after(h.dispose);
  draw();
  return { props, draw, list, submitted, failures, update: (...args) => update(...args), stopped: () => stopped };
}

test('selected reference and stop button remain cancellable before connection while submission is busy', t => {
  const { props, draw, list, submitted, stopped } = panelFixture(t);
  list().onSelect('first');
  draw();
  assert.equal(submitted.length, 1);
  props.canSubmit = false;
  props.generationRequested = true;
  assert.equal(list().selectedID, 'first');
  list().onSelect(null);
  assert.equal(stopped(), 1, 'Cancellation must reach the SDK before connected state arrives');
  assert.equal(list().selectedID, null);
  props.canSubmit = true;
  draw();
  assert.equal(submitted.length, 1, 'A cancelled reference must not restart when busy clears');
  const stop = find(draw(), node => node.props?.accessibilityLabel === '停止生成');
  assert.equal(stop.props.disabled, false, 'Prompt/touch preparation is also cancellable');
  stop.props.onPress();
  assert.equal(stopped(), 2);
});

function screenFixture(t, options = {}) {
  const h = hooks(), connect = deferred(), start = deferred(), disconnect = deferred();
  const localTrack = { id: 'local' }, remoteTrack = { id: 'remote' };
  let starts = 0, stops = 0, connects = 0, previews = 0, closes = 0;
  const contexts = [], models = [];
  let stateListener = null;
  let cleanup = null;
  const cancelled = () => ({ code: 'CANCELLED' });
  const manager = {
    currentCameraPreset: null,
    currentCameraVideoFormat: options.fileURL ? null : { width: 1024, height: 1920, fps: 30 },
    uplinkQualityLevel: null, downlinkQualityLevel: null,
    async updateCameraFormat(format) { manager.currentCameraVideoFormat = format; },
    async setUplinkQualityLevel(level) { manager.uplinkQualityLevel = level; },
    async setDownlinkQualityLevel(level) { manager.downlinkQualityLevel = level; },
    currentState: { connectionState: options.preparing ? 'preparing' : 'ready', reason: null },
    setStateListener: async listener => { stateListener = listener; },
    setUplinkVideoStatisticsListener: async () => {},
    setDownlinkVideoStatisticsListener: async () => {},
    createLocalCameraStream: async () => { previews++; return { videoTrack: localTrack }; },
    createLocalImageStream: async () => { previews++; return { videoTrack: localTrack }; },
    async _startGeneration({ context, signal }) {
      const updating = manager.currentState.connectionState === 'generating';
      try {
        if (updating && options.failUpdate) throw { code: 'RTC_ERROR', message: 'Update failed' };
        if (signal?.aborted) throw cancelled();
        if (!updating) {
          manager.currentState = { connectionState: 'connecting' };
          connects++;
          if (connects === 1) await connect.promise; // Allocation must settle for reclamation.
          if (signal?.aborted) throw cancelled();
          manager.currentState = { connectionState: 'connected' };
        }
        contexts.push(context);
        starts++;
        if (starts === 1) await new Promise((resolve, reject) => {
          const abort = () => reject(cancelled());
          signal?.addEventListener('abort', abort, { once: true });
          start.promise.then(resolve, reject).finally(() => signal?.removeEventListener('abort', abort));
        });
        if (signal?.aborted) throw cancelled();
        manager.currentState = { connectionState: 'generating' };
        return { videoTrack: remoteTrack };
      } catch (error) {
        if (!updating) await manager._disconnect();
        throw error;
      }
    },
    _disconnect() {
      if (cleanup) return cleanup;
      if (manager.currentState.connectionState === 'ready') return Promise.resolve();
      stops++;
      cleanup = disconnect.promise.then(() => { manager.currentState = { connectionState: 'ready' }; }).finally(() => { cleanup = null; });
      return cleanup;
    },
    close: async () => { closes++; },
  };
  // Simulate the SDK's public replacement/cancellation contract at the UI boundary.
  // Resource and publication races are exercised against the real SDK in camera.test.cjs.
  let request = null;
  manager.startGeneration = options => {
    const previous = request;
    const current = { controller: new AbortController(), completion: Promise.resolve() };
    request = current;
    const result = (async () => {
      await previous?.completion;
      if (current.controller.signal.aborted) throw cancelled();
      return manager._startGeneration({ ...options, signal: current.controller.signal });
    })().finally(() => { if (request === current) request = null; });
    current.completion = result.catch(() => {});
    previous?.controller.abort();
    return result;
  };
  manager.disconnect = () => {
    request?.controller.abort();
    request = null;
    return manager._disconnect();
  };
  manager.close = () => {
    closes++;
    request?.controller.abort();
    request = null;
    return manager._disconnect();
  };
  const { RealtimeScreen: Screen } = load('screens/RealtimeScreen.tsx', h.react, {
    '../realtime/RealtimeGenerationOperations': load('realtime/RealtimeGenerationOperations.ts', {}),
    '../realtime/XLabTrajectoryRenderer': {},
    '../realtime/TouchAnimationReference': { uploadTouchAnimationReference: options.prepareTouch },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '@xmaxai/react-native-sdk': {
      RealtimeCameraPreset: require('../lib/commonjs/Service/Realtime/RealtimeTypes').RealtimeCameraPreset,
      XmaxLoggerOption: { all: 3 },
      XmaxClient: class { createRealtimeManager({ model }) { models.push(model); return manager; } createStorageManager() { return {}; } },
      XmaxRealtimeDualVideo: 'Video', RealtimeModel: require('../lib/commonjs/Service/Realtime/RealtimeTypes').RealtimeModel, realtimeModelSpecifications: require('../lib/commonjs/Service/Realtime/RealtimeTypes').realtimeModelSpecifications, VideoContentMode: { fit: 'fit', fill: 'fill' },
      RealtimeConnectionState: { idle: 'idle', connecting: 'connecting', connected: 'connected',
        generating: 'generating', preparing: 'preparing', ready: 'ready' },
      XmaxError: { from: value => value },
      XmaxErrorCode: { cancelled: 'CANCELLED' },
    },
    '../realtime/RealtimeControlPanel': { RealtimeControlPanel: 'Panel' },
    '../realtime/RealtimeLoadingOverlay': { RealtimeLoadingOverlay: 'Loading' },
    '../realtime/RealtimeErrorToast': { RealtimeErrorToast: 'Toast' },
  });
  const draw = () => h.render(Screen, { apiKey: 'fixture', environment: 'china', fileURL: options.fileURL, model: options.model, entryReady: options.entryReady });
  const props = type => find(draw(), node => node.type === type).props;
  t.after(() => { h.dispose(); native.AppState.currentState = 'active'; });
  draw();
  return { props, draw, manager, connect, start, disconnect, localTrack, remoteTrack, contexts, models,
    dispose: h.dispose,
    setEntryReady(value) { options.entryReady = value; draw(); },
    state(value) { manager.currentState = value; stateListener?.(value); },
    background(state) {
      native.AppState.currentState = state;
      for (const listener of appStateListeners) listener(state);
    },
    counts: () => ({ starts, stops, connects, previews, closes }) };
}

test('camera uses page layout for fit during rotation even when window metrics remain portrait', async t => {
  const screen = screenFixture(t);
  await tick();
  assert.equal(screen.props('Video').videoContentMode, 'fill');
  const counts = screen.counts();
  screen.props('View').onLayout({ nativeEvent: { layout: { width: 844, height: 390 } } });
  assert.equal(screen.props('Video').videoContentMode, 'fit');
  screen.props('View').onLayout({ nativeEvent: { layout: { width: 0, height: 0 } } });
  assert.equal(screen.props('Video').videoContentMode, 'fit');
  screen.props('View').onLayout({ nativeEvent: { layout: { width: 390, height: 844 } } });
  assert.equal(screen.props('Video').videoContentMode, 'fill');
  assert.deepEqual(screen.counts(), counts, 'Layout changes must not restart capture or generation');
});

test('image preview stays fit in either page orientation', t => {
  const screen = screenFixture(t, { fileURL: 'file:///fixture.jpg' });
  for (const [width, height] of [[390, 844], [844, 390]]) {
    screen.props('View').onLayout({ nativeEvent: { layout: { width, height } } });
    assert.equal(screen.props('Video').videoContentMode, 'fit');
  }
});

test('native entry readiness ignores closing and unfocused events, stays ready across cancelled back gestures, and unsubscribes', t => {
  const h = hooks(), listeners = new Set();
  let focused = true;
  const { useRealtimeEntryReady } = load('navigation/useRealtimeEntryReady.ts', {
    ...h.react, useLayoutEffect: h.react.useEffect,
  });
  const navigation = {
    isFocused: () => focused,
    addListener(name, listener) {
      assert.equal(name, 'transitionEnd');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const draw = () => h.render(() => useRealtimeEntryReady(navigation));
  const finish = closing => [...listeners].forEach(listener => listener({ data: { closing } }));
  t.after(h.dispose);
  assert.equal(draw(), false);
  finish(true);
  assert.equal(draw(), false);
  focused = false;
  finish(false);
  assert.equal(draw(), false);
  focused = true;
  finish(false);
  assert.equal(draw(), true);
  finish(true);
  finish(false);
  assert.equal(draw(), true, 'Returning from a cancelled back gesture must not recreate the media manager');
  assert.equal(listeners.size, 1);
  h.dispose();
  assert.equal(listeners.size, 0);
});

for (const fileURL of [undefined, 'file:///fixture.jpg']) {
  test(`${fileURL ? 'image' : 'camera'} entry displays loading before creating the SDK and starts preview once after transition`, async t => {
    const f = screenFixture(t, { entryReady: false, fileURL });
    await tick();
    assert.equal(f.props('Loading').loading, true);
    assert.equal(f.props('Panel').canSubmit, false);
    assert.equal(f.props('Video').localTrack, null);
    assert.deepEqual(f.models, []);
    assert.equal(f.counts().previews, 0);
    f.setEntryReady(true);
    await tick();
    assert.equal(f.models.length, 1);
    assert.equal(f.counts().previews, 1);
    assert.equal(f.props('Video').localTrack, f.localTrack);
    f.setEntryReady(true);
    await tick();
    assert.equal(f.counts().previews, 1);
    assert.equal(f.counts().closes, 0);
  });
}

test('leaving during entry never allocates a media manager or starts a late preview', async t => {
  const f = screenFixture(t, { entryReady: false });
  f.dispose();
  await tick();
  assert.deepEqual(f.models, []);
  assert.equal(f.counts().previews, 0);
  assert.equal(f.counts().closes, 0);
});

test('backgrounding before entry finishes defers capture until active, and exit cancels pending recovery', async t => {
  const f = screenFixture(t, { entryReady: false });
  f.background('background');
  f.setEntryReady(true);
  await tick();
  assert.equal(f.counts().previews, 0);
  f.background('active');
  await tick();
  assert.equal(f.counts().previews, 1);
  f.background('background');
  f.background('active');
  f.dispose();
  await tick();
  assert.equal(f.counts().previews, 1);
});

test('cancel during connect keeps preview, hides loading immediately and ignores a late remote track', async t => {
  const f = screenFixture(t);
  await tick();
  f.props('Panel').onSubmit({ prompt: 'Transform' });
  assert.equal(f.props('Panel').canSubmit, true, 'Loading must accept another selection');
  await tick();
  assert.equal(f.props('Panel').generationRequested, true);
  f.props('Panel').onStop();
  await tick();
  assert.equal(f.counts().stops, 1);
  assert.equal(f.props('Loading').loading, false);
  assert.equal(f.props('Video').localTrack, f.localTrack);
  assert.equal(f.props('Video').remoteTrack, null);
  f.connect.resolve({ videoTrack: f.remoteTrack });
  await tick();
  assert.equal(f.counts().starts, 0);
  assert.equal(f.props('Video').remoteTrack, null);
  assert.equal(f.props('Panel').canSubmit, true, 'UI accepts the next intent while cleanup runs');
  f.disconnect.resolve();
  await tick();
  assert.equal(f.props('Panel').canSubmit, true);
});

test('cancel before task confirmation never mounts an obsolete remote track', async t => {
  const f = screenFixture(t);
  await tick();
  f.props('Panel').onSubmit({ prompt: 'Transform' });
  f.connect.resolve({ videoTrack: f.remoteTrack });
  await tick();
  assert.equal(f.counts().starts, 1);
  assert.equal(f.props('Video').remoteTrack, null);
  f.props('Panel').onStop();
  assert.equal(f.props('Video').remoteTrack, null, 'Remote video mounts only after successful generation');
  f.start.reject({ code: 'NETWORK_ERROR', message: 'Old request failed' });
  await tick();
  assert.equal(f.props('Toast').notice, null);
  assert.equal(f.props('Panel').generationRequested, false);
  f.disconnect.resolve();
  await tick();
  assert.equal(f.props('Video').remoteTrack, null);
  assert.equal(f.props('Video').localTrack, f.localTrack);
  assert.equal(f.props('Panel').canSubmit, true);
});

test('reference replacement during loading updates selection and stale failure cannot clear it', t => {
  const f = panelFixture(t);
  f.list().onSelect('first');
  f.draw();
  f.props.generationRequested = true;
  f.list().onSelect('second');
  assert.equal(f.list().selectedID, 'second');
  assert.deepEqual(f.submitted.map(value => value.referencePath), ['reference.jpg', 'second.jpg']);
  f.failures[0]();
  assert.equal(f.list().selectedID, 'second');
  f.failures[1]();
  assert.equal(f.list().selectedID, null, 'Only failure of the current selection clears it');
});

test('upload completion follows selection across category changes, and deselection prevents auto-start', t => {
  const f = panelFixture(t);
  f.update('first', { uploadState: 'uploading', referencePath: null });
  f.list().onSelect('first');
  f.draw();
  assert.equal(f.submitted.length, 0);
  const category = find(f.draw(), node => node.props?.onLayout &&
    node.props?.accessibilityState?.selected === false);
  category.props.onPress();
  f.update('first', { uploadState: 'ready', referencePath: 'uploaded.jpg' });
  f.draw();
  assert.equal(f.submitted[0].referencePath, 'uploaded.jpg');

  f.update('second', { uploadState: 'uploading', referencePath: null });
  f.list().onSelect('second');
  f.draw();
  f.list().onSelect(null);
  f.update('second', { uploadState: 'ready', referencePath: 'second-upload.jpg' });
  f.draw();
  assert.equal(f.submitted.length, 1);
});

test('A→B→C during connection starts only C after cancellation and native cleanup', async t => {
  const f = screenFixture(t);
  await tick();
  f.props('Panel').onSubmit({ prompt: 'A' });
  await tick();
  f.props('Panel').onSubmit({ prompt: 'B' });
  f.props('Panel').onSubmit({ prompt: 'C' });
  await tick();
  assert.equal(f.counts().connects, 1);
  f.connect.resolve({ videoTrack: { id: 'obsolete' } });
  await tick();
  assert.equal(f.counts().starts, 0);
  assert.equal(f.props('Loading').loading, true, 'Obsolete completion cannot hide the latest loading state');
  f.disconnect.resolve();
  await tick();
  assert.equal(f.counts().connects, 2);
  assert.deepEqual(f.contexts.map(value => value.prompt), ['C']);
  f.start.resolve();
  await tick();
  assert.equal(f.props('Video').remoteTrack, f.remoteTrack);
  assert.equal(f.props('Loading').loading, false);
});

test('replace→stop→restart while cleanup waits discards old queued selections', async t => {
  const f = screenFixture(t);
  await tick();
  f.props('Panel').onSubmit({ prompt: 'A' });
  f.connect.resolve({ videoTrack: f.remoteTrack });
  await tick();
  f.props('Panel').onSubmit({ prompt: 'B' });
  f.props('Panel').onStop();
  assert.equal(f.props('Loading').loading, false);
  f.props('Panel').onSubmit({ prompt: 'D' });
  f.start.reject({ code: 'CANCELLED' });
  await tick();
  assert.equal(f.counts().connects, 1);
  f.disconnect.resolve();
  await tick();
  assert.deepEqual(f.contexts.map(value => value.prompt), ['A', 'D']);
  assert.equal(f.props('Toast').notice, null);
  assert.equal(f.props('Panel').generationRequested, true);
});

test('completed generation reuses its connection when another context is selected', async t => {
  const f = screenFixture(t);
  await tick();
  f.connect.resolve({ videoTrack: f.remoteTrack });
  f.start.resolve();
  f.props('Panel').onSubmit({ prompt: 'A' });
  await tick();
  f.props('Panel').onSubmit({ prompt: 'B' });
  await tick();
  assert.deepEqual(f.contexts.map(value => value.prompt), ['A', 'B']);
  assert.equal(f.counts().stops, 0, 'Context updates do not disconnect completed generation');
});

test('background→foreground→background discards pending generation and stale preview recovery', async t => {
  const f = screenFixture(t);
  await tick();
  f.props('Panel').onSubmit({ prompt: 'A' });
  await tick();
  f.props('Panel').onSubmit({ prompt: 'B' });
  f.background('background');
  f.background('active');
  f.background('background');
  f.connect.resolve({ videoTrack: f.remoteTrack });
  f.disconnect.resolve();
  await tick();
  assert.equal(f.counts().starts, 0);
  assert.equal(f.counts().previews, 1);
  assert.equal(f.props('Video').localTrack, null);
  f.background('active');
  await tick();
  assert.equal(f.counts().previews, 2);
  assert.equal(f.counts().starts, 0, 'Foreground recovery restores only local preview');
});

test('unmount cancels pending replacements before releasing the manager', async t => {
  const f = screenFixture(t);
  await tick();
  f.props('Panel').onSubmit({ prompt: 'A' });
  await tick();
  f.props('Panel').onSubmit({ prompt: 'B' });
  f.dispose();
  f.connect.resolve({ videoTrack: f.remoteTrack });
  f.disconnect.resolve();
  await tick();
  assert.equal(f.counts().starts, 0);
  assert.equal(f.counts().closes, 1);
});

test('switching from touch preparation to a reference aborts the upload and ignores its late result', async t => {
  const uploaded = deferred();
  let uploadSignal;
  const f = screenFixture(t, {
    fileURL: 'file:///input.jpg',
    prepareTouch: (_storage, _file, _type, signal) => { uploadSignal = signal; return uploaded.promise; },
  });
  await tick();
  f.props('Panel').onInstruction();
  await tick();
  assert.equal(f.counts().connects, 0);
  f.props('Panel').onSubmit({ prompt: 'Reference', referencePath: 'new.jpg' });
  assert.equal(uploadSignal.aborted, true);
  f.disconnect.resolve();
  await tick();
  assert.equal(f.counts().connects, 1, 'Independent reference generation is submitted without waiting for an obsolete upload');
  uploaded.resolve('obsolete-touch.jpg');
  f.connect.resolve({ videoTrack: f.remoteTrack });
  f.start.resolve();
  await tick();
  assert.deepEqual(f.contexts, [{ prompt: 'Reference', referencePath: 'new.jpg' }]);
  assert.equal(f.props('Toast').notice, null);
});

test('only the latest failing request reports failure after cleanup, and a later request can retry', async t => {
  const f = screenFixture(t);
  let failures = 0;
  await tick();
  f.props('Panel').onSubmit({ prompt: 'A' }, () => failures++);
  f.connect.resolve({ videoTrack: f.remoteTrack });
  await tick();
  f.start.reject({ code: 'NETWORK_ERROR', message: 'Generation failed' });
  await tick();
  assert.equal(failures, 0);
  f.disconnect.resolve();
  await tick();
  assert.equal(failures, 1);
  assert.equal(f.props('Panel').generationRequested, false);
  assert.equal(f.props('Video').remoteTrack, null);
  f.props('Panel').onSubmit({ prompt: 'Retry' });
  await tick();
  assert.equal(f.props('Toast').notice, null);
  assert.deepEqual(f.contexts.map(value => value.prompt), ['A', 'Retry']);
});

test('rapid thumbnail presses do not start scrolling or move visible tap targets', t => {
  const h = hooks(), scrolls = [], selections = [];
  const { RealtimeReferenceList: List } = load('realtime/RealtimeReferenceList.tsx', h.react, {
    './ReferenceThumbnail': { ReferenceThumbnail: 'Thumbnail' },
    './ReferenceUploadOverlay': { ReferenceUploadOverlay: 'UploadOverlay' },
  });
  const props = {
    references: Array.from({ length: 12 }, (_, index) => ({
      id: String(index), title: `Reference ${index}`, uploadState: 'ready', iconURL: 'fixture.jpg',
    })),
    selectedID: null, visible: true, picking: false,
    onSelect: id => { props.selectedID = id; selections.push(id); },
  };
  const draw = () => h.render(List, props);
  const scroll = () => find(draw(), node => node.type === 'ScrollView').props;
  scroll().ref.current = { scrollTo: value => scrolls.push(value) };
  find(draw(), node => node.props?.onLayout).props.onLayout({ nativeEvent: { layout: { width: 240 } } });
  for (const id of ['0', '1', '2', '1', '1']) {
    find(draw(), node => node.props?.accessibilityLabel === `Reference ${id}`).props.onPress();
    draw();
  }
  assert.deepEqual(selections, ['0', '1', '2', '1', null]);
  assert.deepEqual(scrolls, [], 'Selection must not create the animation that captures subsequent presses');

  props.selectedID = '8';
  draw();
  assert.deepEqual(scrolls, [{ x: 224, animated: false }]);
  scroll().onScroll({ nativeEvent: { contentOffset: { x: 224 } } });
  props.selectedID = '7';
  draw();
  assert.equal(scrolls.length, 1, 'An already visible selection must stay in place');
  // A user drag can move the selected thumbnail offscreen without an auto-scroll tug-of-war.
  scroll().onScroll({ nativeEvent: { contentOffset: { x: 0 } } });
  draw();
  assert.equal(scrolls.length, 1);
  t.after(h.dispose);
});


test('language changes update realtime controls without restarting media or rewriting prompts', async t => {
  t.after(() => { locale = 'zh-Hans'; });
  const f = screenFixture(t);
  await tick();
  f.props('Panel').onPromptChange('Keep this exact prompt');
  const before = f.counts();
  locale = 'en';
  assert.equal(f.props('Pressable')?.accessibilityLabel, 'Back to Home');
  assert.equal(f.props('Panel').prompt, 'Keep this exact prompt');
  await tick();
  assert.deepEqual(f.counts(), before, 'Language changes must not recreate the realtime manager');
  const panel = panelFixture(t);
  assert(find(panel.draw(), node => node.props?.accessibilityLabel === 'Stop generation'));
  locale = 'zh-Hans';
  assert(find(panel.draw(), node => node.props?.accessibilityLabel === '停止生成'));
});

test('storage selection, progress, safety errors and results follow the current language', t => {
  t.after(() => { locale = 'zh-Hans'; });
  const h = hooks();
  t.after(h.dispose);
  const storage = { file: null, busy: null, result: null, progress: null, error: null, safe: false };
  const { StorageScreen: Screen } = load('screens/StorageScreen.tsx', h.react, {
    'react-native-safe-area-context': { SafeAreaView: 'SafeArea' },
    '@xmaxai/react-native-sdk': { RealtimeModel: require('../lib/commonjs/Service/Realtime/RealtimeTypes').RealtimeModel, XmaxSDKInfo: { version: '1.0.0' } },
    '@react-native-clipboard/clipboard': { setString() {} },
    'react-native-video': 'Video',
    '../storage/useStorage': { useStorage: () => storage, formatFileSize: () => '1 KB' },
  });
  const draw = () => h.render(Screen, { apiKey: '', environment: 'china', onBack() {} });
  assert(find(draw(), node => node.props?.children === '文件预览'));
  locale = 'en';
  assert(find(draw(), node => node.props?.children === 'File Preview'));
  assert(find(draw(), node => node.props?.accessibilityLabel === 'Select an image or video'));
  storage.file = { kind: 'image', fileURL: 'file:///image.jpg', width: 32, height: 64, byteCount: 1024 };
  storage.busy = 'uploading';
  storage.safe = true;
  storage.progress = { fractionCompleted: 0.42 };
  assert(find(draw(), node => node.props?.children === 'Uploading 42%'));
  assert(find(draw(), node => node.props?.children === 'Includes a safety check'));
  assert(find(draw(), node => node.props?.children === 'Checking…'));
  locale = 'zh-Hans';
  assert(find(draw(), node => node.props?.children === '包含内容安全检查'));
  assert(find(draw(), node => node.props?.children === '正在检测上传'));
  locale = 'en';
  storage.safe = false;
  assert(find(draw(), node => node.props?.children === 'Uploading image'));
  assert(find(draw(), node => node.props?.children === 'Uploading'));
  storage.file = { ...storage.file, kind: 'video' };
  assert(find(draw(), node => node.props?.children === 'Uploading video'));
  locale = 'zh-Hans';
  assert(find(draw(), node => node.props?.children === '正在上传视频'));
  assert(find(draw(), node => node.props?.children === '正在上传'));
  locale = 'en';
  storage.busy = null;
  storage.error = { messageKey: 'storage.unsafe' };
  assert(find(draw(), node => node.props?.children === translateUI('storage.unsafe')));
  storage.result = { elapsed: 350, file: { url: 'https://example.com/result.jpg' } };
  assert(find(draw(), node => node.props?.children === 'Upload Result'));
  locale = 'zh-Hans';
  assert(find(draw(), node => node.props?.children === '上传结果'));
  assert(find(draw(), node => node.props?.children === translateUI('storage.unsafe')));
});


test('endpoint selection drives credentials and backend routing for every feature route', () => {
  const configuration = { keys: { china: 'cn-fixture', global: 'global-fixture' },
    endpoint: 'global', model: 'x2.1.1-preview-cn', language: 'en', loaded: true,
    minBitrate: '', maxBitrate: '', downMinBitrate: '', downMaxBitrate: '' };
  const writes = [], routes = [];
  const context = { configuration, store: { setKey: (...args) => writes.push(args),
    selectEndpoint: endpoint => { configuration.endpoint = endpoint; },
    selectLanguage() {}, selectModel: model => { configuration.model = model; } } };
  const react = { createContext: () => ({ Provider: 'Provider' }), useContext: () => context };
  const sdk = { XmaxEnvironment: { china: 'china', global: 'global' },
    RealtimeModel: require('../lib/commonjs/Service/Realtime/RealtimeTypes').RealtimeModel };
  const { XLabNavigator } = load('navigation/XLabNavigator.tsx', react, {
    '../configuration/ConfigurationStore': load('configuration/ConfigurationStore.ts', {}, { '@xmaxai/react-native-sdk': sdk }),
    '@react-navigation/native': { NavigationContainer: 'Navigation', DarkTheme: {} },
    '@react-navigation/native-stack': { createNativeStackNavigator: () => ({ Navigator: 'Navigator', Screen: 'Screen' }) },
    '../screens/FeedScreen': { FeedScreen: 'Feed' },
    '../screens/CameraScreen': { CameraScreen: 'Camera' },
    '../screens/RealtimeScreen': { RealtimeScreen: 'Realtime' },
    '../screens/StorageScreen': { StorageScreen: 'Storage' },
    './useRealtimeEntryReady': { useRealtimeEntryReady: () => false },
  });
  const tree = XLabNavigator(context);
  const routeComponent = name => find(tree, node => node.props?.name === name).props.component;
  const navigation = { isFocused: () => true, navigate: (...args) => routes.push(args) };
  const feed = routeComponent('Feed')({ navigation }).props;
  assert.equal(feed.configuration.endpoint, 'global');
  feed.onAPIKeyChange('new-global');
  assert.deepEqual(writes.at(-1), ['global', 'new-global']);
  feed.onModelChange('x2.1.1-preview-cn');
  assert.equal(configuration.model, 'x2.1.1-preview-cn');
  feed.onModelChange('x2.1.1-preview-cn');
  feed.onCamera('global-fixture', 'global');
  assert.deepEqual(routes.at(-1), ['Camera', { endpoint: 'global', model: 'x2.1.1-preview-cn', bitrate: null }]);
  for (const name of ['Camera', 'Image', 'Storage']) {
    const props = routeComponent(name)({ route: { params: { endpoint: 'global', model: 'x2.1.1-preview-cn', bitrate: null } }, navigation }).props;
    if (name !== 'Storage') {
      assert.equal(props.model, 'x2.1.1-preview-cn');
      assert.equal(props.entryReady, false, 'Media routes forward native transition readiness');
    }
    assert.equal(props.environment, 'global');
    assert.equal(props.baseURL, undefined, 'The SDK selects each service backend from environment');
    assert.equal(props.apiKey, 'global-fixture');
  }
  feed.onEndpointChange('china');
  assert.equal(configuration.endpoint, 'china');
  const china = routeComponent('Storage')({ route: { params: { endpoint: 'china' } }, navigation }).props;
  assert.equal(china.environment, 'china');
  assert.equal(china.baseURL, undefined);
  assert.equal(china.apiKey, 'cn-fixture');
  configuration.keys.global = '';
  feed.onEndpointChange('global');
  const empty = routeComponent('Feed')({ navigation }).props.configuration;
  assert.equal(empty.keys[empty.endpoint], '', 'A missing overseas key must never fall back to the China key');
});

test('the reference picker uses the iOS artwork for each resolved locale', t => {
  t.after(() => { locale = 'zh-Hans'; });
  const h = hooks();
  t.after(h.dispose);
  const { RealtimeReferenceList } = load('realtime/RealtimeReferenceList.tsx', h.react, {
    './ReferenceThumbnail': { ReferenceThumbnail: 'Thumbnail' },
    './ReferenceUploadOverlay': { ReferenceUploadOverlay: 'UploadOverlay' },
  });
  const draw = () => h.render(RealtimeReferenceList, { references: [], selectedID: null, visible: true, picking: false });
  assert.equal(find(draw(), node => node.type === 'Image').props.source, '../assets/realtime/realtime_add_reference.png');
  locale = 'en';
  assert.equal(find(draw(), node => node.type === 'Image').props.source, '../assets/realtime/realtime_add_reference_en.png');
});

test('all home feature entries require the current endpoint key before navigation or image picking', async t => {
  const h = hooks(), alerts = [], navigations = [];
  let picks = 0;
  const originalAlert = native.Alert;
  native.Alert = { alert: (...args) => alerts.push(args) };
  t.after(() => { native.Alert = originalAlert; locale = 'zh-Hans'; h.dispose(); });
  const sdk = { XmaxEnvironment: { china: 'china', global: 'global' }, RealtimeModel: require('../lib/commonjs/Service/Realtime/RealtimeTypes').RealtimeModel, XmaxSDKInfo: { version: '1.0.0' } };
  const { FeedScreen } = load('screens/FeedScreen.tsx', h.react, {
    'react-native-image-picker': { launchImageLibrary: async () => {
      picks++;
      return { assets: [{ uri: 'file:///fixture.jpg', type: 'image/jpeg' }] };
    } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeArea' },
    '@xmaxai/react-native-sdk': sdk,
    '../configuration/ConfigurationStore': load('configuration/ConfigurationStore.ts', {}, { '@xmaxai/react-native-sdk': sdk }),
    '../theme/tokens': { colors: {}, feedFont: value => value },
    '../components/FeedLanguageButton': { FeedLanguageButton: 'Language' },
    '../components/StorageFeatureCard': { StorageFeatureCard: 'Storage' },
    '../components/FeedPipelineCard': { FeedPipelineCard: 'Pipeline' },
    '../components/FeedFeatureCard': { FeedFeatureCard: 'Feature' },
  });
  const configuration = { keys: { china: 'cn-fixture', global: '' }, endpoint: 'global', language: 'en', loaded: true,
    minBitrate: '', maxBitrate: '', downMinBitrate: '', downMaxBitrate: '' };
  const props = { configuration, onCamera: (...args) => navigations.push(['camera', ...args]),
    onImage: (...args) => navigations.push(['image', ...args]), onStorage: (...args) => navigations.push(['storage', ...args]),
    onEndpointChange: endpoint => { configuration.endpoint = endpoint; },
    onBitrateChange: (field, value) => { configuration[field] = value; },
    onModelChange: model => { configuration.model = model; } };
  const draw = () => h.render(FeedScreen, props);
  for (const language of ['en', 'zh-Hans']) {
    locale = language;
    const preview = find(draw(), node => node.props?.accessibilityRole === 'radio' && node.props?.accessibilityLabel === 'X2.1.1-PREVIEW-CN');
    assert(preview, 'China preview must have its own model entry');
    assert(find(draw(), node => node.props?.children === 'RealtimeModel.x2_1_1_preview_cn'));
    assert(!find(draw(), node => node.props?.accessibilityLabel === 'X2.0-PRO'), 'X2.0 Pro must not appear in the model list');
    preview.props.onPress();
    assert.equal(configuration.model, 'x2.1.1-preview-cn');
    assert.equal(find(draw(), node => node.props?.accessibilityLabel === 'X2.1.1-PREVIEW-CN').props.accessibilityState.checked, true);
  }
  const press = target => {
    const tree = draw();
    find(tree, node => target === 'camera' || target === 'image'
      ? node.type === 'Pipeline' && node.props.sequence === (target === 'camera' ? '01' : '02')
      : node.type === target).props.onPress();
  };
  locale = 'en';
  for (const empty of ['', ' \n\t ']) {
    configuration.keys.global = empty;
    for (const target of ['camera', 'image', 'Feature', 'Storage']) press(target);
  }
  assert.equal(alerts.length, 8);
  assert.equal(alerts[0][1], 'Please enter your API Key first');
  assert.equal(picks, 0, 'Missing keys must be rejected before photo permissions or picker UI');
  assert.deepEqual(navigations, [], 'A saved China key cannot authorize overseas entry');
  locale = 'zh-Hans';
  configuration.endpoint = 'china';
  configuration.keys.china = '';
  press('camera');
  assert.equal(alerts.at(-1)[1], '请先输入 API Key');
  configuration.keys.china = '  cn-fixture  ';
  configuration.minBitrate = '2000';
  press('camera');
  assert.equal(alerts.at(-1)[1], '请同时填写整数最小/最大码率，且最小不大于最大。', 'A lone bitrate field must block entry');
  configuration.maxBitrate = '4000';
  press('camera');
  press('Storage');
  press('image');
  await tick();
  press('Feature');
  await tick();
  assert.equal(picks, 2);
  assert.deepEqual(navigations.map(value => value.slice(0, 3)), [
    ['camera', 'cn-fixture', 'china'], ['storage', 'cn-fixture', 'china'],
    ['image', 'cn-fixture', 'china'], ['image', 'cn-fixture', 'china'],
  ]);
  assert.equal(navigations[2][4], false);
  assert.equal(navigations[3][4], true);
});


test('image input opens on touch animation without automatically generating; camera keeps its default', async t => {
  const image = screenFixture(t, { fileURL: 'file:///fixture.jpg' });
  const camera = screenFixture(t);
  await tick();
  assert.equal(image.props('Panel').initialCategoryID, 'mox');
  assert.equal(camera.props('Panel').initialCategoryID, 'charx');
  const panel = panelFixture(t, image.props('Panel').initialCategoryID);
  assert(find(panel.draw(), node => node.props?.children === '点击开始生成'));
  assert.equal(panel.submitted.length, 0);
  assert.equal(image.counts().connects, 0);
  assert.equal(image.counts().starts, 0);
  assert.equal(camera.counts().starts, 0);
  const character = find(panel.draw(), node => node.props?.accessibilityState?.selected === false &&
    node.props?.children?.props?.children === '换形象');
  character.props.onPress();
  assert.equal(panel.list().visible, true, 'A manual tab choice persists across subsequent renders');
});


for (const model of ['x2.1.1-preview-cn', 'x2.1.1-preview-us']) {
test(`XLab initializes camera and image managers with the route-selected ${model}`, async t => {
  const camera = screenFixture(t, { model });
  const image = screenFixture(t, { model, fileURL: 'file:///image.jpg' });
  await tick();
  assert.deepEqual(camera.models, [model]);
  assert.deepEqual(image.models, [model]);
  camera.props('Panel');
  image.props('Panel');
  assert.equal(camera.models.length, 1);
  assert.equal(image.models.length, 1);
});
}

test('camera preview remains loading until Ready arrives through the state listener', async t => {
  const f = screenFixture(t, { preparing: true });
  await tick();
  assert.equal(f.props('Video').localTrack, f.localTrack, 'The canvas must mount while Preparing');
  assert.equal(f.props('Loading').loading, true);
  assert.equal(f.props('Panel').canSubmit, false);
  f.state({ connectionState: 'ready', sessionID: null, taskID: null, reason: null });
  assert.equal(f.props('Loading').loading, false);
  assert.equal(f.props('Panel').canSubmit, true);
});

test('background lifecycle failure shows a toast and retires tracks released by Idle', async t => {
  const f = screenFixture(t);
  await tick();
  f.state({ connectionState: 'idle', sessionID: 'session', taskID: null,
    reason: { type: 'failure', error: { code: 'RTC_ERROR', message: 'Camera unavailable' } } });
  assert.equal(f.props('Toast').notice.message, 'Camera unavailable');
  assert.equal(f.props('Video').localTrack, null);
  assert.equal(f.props('Video').remoteTrack, null);
  assert.equal(f.props('Loading').loading, false);
});

test('a failed context update keeps the current generated video and reference selection', async t => {
  const f = screenFixture(t, { failUpdate: true });
  let cleared = 0;
  await tick();
  f.connect.resolve({ videoTrack: f.remoteTrack });
  f.start.resolve();
  f.props('Panel').onSubmit({ prompt: 'first' });
  await tick();
  f.props('Panel').onSubmit({ prompt: 'second' }, () => cleared++);
  await tick();
  assert.equal(f.counts().stops, 0);
  assert.equal(f.props('Panel').generationRequested, true);
  assert.equal(f.props('Video').remoteTrack, f.remoteTrack);
  assert.equal(f.props('Toast').notice.message, 'Update failed');
  assert.equal(cleared, 0);
  assert.equal(f.props('Loading').loading, false);
});

test('unmount closes realtime promptly while cancelled touch preparation finishes independently', async t => {
  const uploaded = deferred();
  const f = screenFixture(t, { fileURL: 'file:///input.jpg', prepareTouch: () => uploaded.promise });
  await tick();
  f.props('Panel').onInstruction();
  await tick();
  f.dispose();
  await tick();
  assert.equal(f.counts().closes, 1);
  uploaded.resolve('late-upload.jpg');
  await tick();
  assert.equal(f.counts().connects, 0);
});

test('reference upload failure and retries use the latest language without recreating their tasks', async t => {
  const h = hooks(), alerts = [], tasks = [];
  const originalAlert = native.Alert;
  native.Alert = { alert: (...args) => alerts.push(args) };
  t.after(() => { h.dispose(); locale = 'zh-Hans'; native.Alert = originalAlert; });
  const { useReferenceUploads } = load('realtime/useReferenceUploads.ts', h.react, {
    'react-native-blob-util': {},
    '@xmaxai/react-native-sdk': {},
    './ReferenceUploadTask': { ReferenceUploadTask: class {
      constructor(_prepare, _upload, _update, failure) { this.failure = failure; tasks.push(this); }
      start() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
    } },
  });
  const draw = () => h.render(() => useReferenceUploads('fixture', 'global', () => {}), {});
  locale = 'zh-Hans';
  draw().start({ id: 'custom-photo' }, { uri: 'file:///photo.jpg', type: 'image/jpeg' });
  locale = 'en';
  draw();
  tasks[0].failure();
  assert.deepEqual(alerts.at(-1), ['Reference upload failed', 'Tap the image to retry.']);
  locale = 'zh-Hans';
  draw().retry('custom-photo');
  tasks[0].failure();
  assert.deepEqual(alerts.at(-1), ['参考图上传失败', '点击图片可重试。']);
  assert.equal(tasks.length, 1);
});

for (const language of ['zh-Hans', 'en']) {
  test(`${language}: API failures reach the rendered realtime toast without losing the server explanation`, async t => {
    locale = language;
    t.after(() => { locale = 'zh-Hans'; });
    const f = screenFixture(t);
    await tick();
    const failure = { code: 'API_ERROR', message: 'Invalid API key', apiCode: 4011, httpStatus: 401 };
    f.state({ connectionState: 'ready', sessionID: null, taskID: null,
      reason: { type: 'failure', error: failure } });
    const h = hooks();
    t.after(h.dispose);
    const oldAccessibility = native.AccessibilityInfo;
    native.AccessibilityInfo = { announceForAccessibility() {} };
    t.after(() => { native.AccessibilityInfo = oldAccessibility; });
    const { RealtimeErrorToast } = load('realtime/RealtimeErrorToast.tsx', h.react);
    const draw = () => h.render(RealtimeErrorToast, f.props('Toast'));
    assert.equal(find(draw(), node => node.type === 'Text').props.children, failure.message);

    f.state({ connectionState: 'ready', reason: { type: 'failure', error: { code: 'API_ERROR', message: ' ' } } });
    assert.equal(find(draw(), node => node.type === 'Text').props.children, translateUI('error.api'));
  });
}

test('a rejected generation request keeps its concrete error message in the toast', async t => {
  const f = screenFixture(t);
  await tick();
  f.props('Panel').onSubmit({ prompt: 'Transform' });
  await tick();
  f.disconnect.resolve();
  f.connect.reject({ code: 'API_ERROR', message: 'API key expired' });
  await tick();
  await tick();
  assert.equal(f.props('Toast').notice.message, 'API key expired');
  assert.equal(f.props('Toast').notice.messageKey, undefined);
});

function storageErrorFixture(t, kind = 'image') {
  const h = hooks(), page = hooks();
  t.after(() => { h.dispose(); page.dispose(); locale = 'zh-Hans'; });
  let uploadFailure, pickerFailure;
  const calls = [];
  const failUpload = route => async () => { calls.push(route); throw uploadFailure; };
  const { useStorage } = load('storage/useStorage.ts', h.react, {
    'react-native-image-picker': { launchImageLibrary: async () => {
      if (pickerFailure) throw pickerFailure;
      return { assets: [{ uri: 'file:///selected.jpg', type: `${kind}/test`, fileName: 'selected.jpg' }] };
    } },
    'react-native-blob-util': { fs: { dirs: { CacheDir: '/cache' },
      cp: async () => {}, stat: async () => ({ size: 12 }), unlink: async () => {} } },
    '@xmaxai/react-native-sdk': { XmaxLoggerOption: { all: 3 }, XmaxClient: class { createStorageManager() {
      return { uploadImage: failUpload('image'), uploadImageWithSafetyCheck: failUpload('safe'), uploadVideo: failUpload('video') };
    } } },
  });
  const draw = () => h.render(() => useStorage('fixture-key', 'global'), {});
  const { StorageScreen } = load('screens/StorageScreen.tsx', page.react, {
    'react-native-safe-area-context': { SafeAreaView: 'SafeArea' },
    '@xmaxai/react-native-sdk': { RealtimeModel: {}, XmaxSDKInfo: { version: '1.0.0' } },
    '@react-native-clipboard/clipboard': {}, 'react-native-video': 'Video',
    '../storage/useStorage': { useStorage: draw, formatFileSize: () => '12 B' },
  });
  const message = () => {
    const tree = page.render(StorageScreen, { apiKey: 'fixture-key', environment: 'global', onBack() {} });
    const alert = find(tree, node => node.props?.accessibilityRole === 'alert');
    return alert ? find(alert, node => typeof node.props?.children === 'string').props.children : null;
  };
  draw();
  return { draw, message, calls,
    failUpload: value => { uploadFailure = value; }, failPicker: value => { pickerFailure = value; } };
}

for (const route of ['image', 'safe', 'video']) {
  test(`storage ${route} renders the concrete SDK error and only translates an empty-message fallback`, async t => {
    const f = storageErrorFixture(t, route === 'video' ? 'video' : 'image');
    const { XmaxError } = require('../lib/commonjs/Foundation/Errors/XmaxError');
    f.failUpload(new XmaxError({ code: 'API_ERROR', message: '  API key expired  ', httpStatus: 401 }));
    await f.draw().pick();
    assert.ok(f.draw().file, JSON.stringify(f.draw().error));
    f.draw().upload(route === 'safe');
    await tick();
    assert.deepEqual(f.calls, [route]);
    for (const language of ['en', 'zh-Hans']) {
      locale = language;
      assert.equal(f.message(), 'API key expired');
    }
    f.failUpload(new XmaxError({ code: 'API_ERROR', message: ' ' }));
    f.draw().upload(route === 'safe');
    assert.equal(f.message(), null, 'Retry clears the previous failure immediately');
    await tick();
    for (const language of ['en', 'zh-Hans']) {
      locale = language;
      assert.equal(f.message(), translateUI('storage.upload.error'));
    }
  });
}

test('storage selection retains native error explanations and falls back only when absent', async t => {
  const f = storageErrorFixture(t);
  for (const failure of [new Error('File cannot be read'), { code: 'READ_ERROR', message: 'File cannot be read' }]) {
    f.failPicker(failure);
    await f.draw().pick();
    assert.equal(f.message(), 'File cannot be read');
  }
  f.failPicker(new Error(' '));
  await f.draw().pick();
  for (const language of ['en', 'zh-Hans']) {
    locale = language;
    assert.equal(f.message(), translateUI('storage.file.error'));
  }
});

test('XLab offers current model formats and updates preview without replacing its track', async t => {
  const screen = screenFixture(t);
  await tick();
  const menu = () => find(screen.draw(), node => node.props?.accessibilityLabel === '分辨率');
  screen.state({ connectionState: 'ready' });
  assert.equal(menu().props.disabled, false);
  menu().props.onPress();
  const landscape = find(screen.draw(), node => node.props?.children?.props?.children?.includes?.('1920 × 1024'));
  assert(landscape);
  assert(!find(screen.draw(), node => node.props?.children?.props?.children?.includes?.('1408 × 1408')));
  const track = screen.props('Video').localTrack, before = screen.counts();
  landscape.props.onPress();
  await tick();
  assert.deepEqual(screen.manager.currentCameraVideoFormat, { width: 1920, height: 1024, fps: 30 });
  assert.equal(screen.props('Video').videoContentMode, 'fit');
  assert.equal(screen.props('Video').localTrack, track);
  assert.deepEqual(screen.counts(), before);
  screen.state({ connectionState: 'connected' });
  assert.equal(menu().props.disabled, true);
});

test('XLab statistics forwards quality changes only during generation and refreshes acknowledged levels', async t => {
  const screen = screenFixture(t);
  await tick();
  find(screen.draw(), node => node.props?.accessibilityLabel === '统计').props.onPress();
  assert.equal(screen.props('RealtimeStatisticsPanel').canChange, false);
  screen.manager.uplinkQualityLevel = 2;
  screen.manager.downlinkQualityLevel = 2;
  screen.state({ connectionState: 'generating' });
  assert.equal(screen.props('RealtimeStatisticsPanel').canChange, true);
  screen.props('RealtimeStatisticsPanel').onUplinkChange(1);
  await tick();
  assert.equal(screen.props('RealtimeStatisticsPanel').uplinkLevel, 1);
  screen.props('RealtimeStatisticsPanel').onDownlinkChange(3);
  await tick();
  assert.equal(screen.props('RealtimeStatisticsPanel').downlinkLevel, 3);
  screen.state({ connectionState: 'ready' });
  assert.equal(screen.props('RealtimeStatisticsPanel').canChange, false);
});
