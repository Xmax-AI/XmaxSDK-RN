const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');

let rendering = null;
mock.module('react', { namedExports: {
  ...React,
  useRef: value => {
    const host = rendering, index = host.cursor++;
    return host.refs[index] ??= { current: value };
  },
  useLayoutEffect: (effect, dependencies) => {
    const host = rendering;
    if (host.dependencies?.every((value, index) => Object.is(value, dependencies[index]))) return;
    host.cleanup?.();
    host.dependencies = dependencies;
    host.commit = () => { host.cleanup = effect(); };
  },
} });
mock.module('react-native', { namedExports: {
  View: 'View', StyleSheet: { absoluteFill: {} },
  findNodeHandle: view => view?.tag ?? null,
} });
const calls = [], pending = [];
mock.module(require.resolve('../lib/commonjs/Foundation/Native/NativeXmaxRuntime'), {
  defaultExport: {
    registerVideoSurface: (...args) => {
      calls.push(['register', ...args]);
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    },
    unregisterVideoSurface: id => calls.push(['unregister', id]),
  },
});
mock.module(require.resolve('../lib/commonjs/Foundation/Logging/XmaxLogger'), {
  namedExports: { XmaxLogger: { render: { error() {} }, localized: (_zh, en) => en } },
});
const { RtcVideoSurface } = require('../lib/commonjs/Foundation/RTC/RtcVideoSurface');

function fixture(t) {
  calls.length = 0; pending.length = 0;
  const frames = new Map(), loaded = [], errors = [];
  let next = 0, now = 0;
  const oldRequest = globalThis.requestAnimationFrame, oldCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = callback => { frames.set(++next, callback); return next; };
  globalThis.cancelAnimationFrame = id => frames.delete(id);
  t.mock.method(performance, 'now', () => now);
  const host = { refs: [], cursor: 0, cleanup: null, dependencies: null, commit: null };
  const render = (viewID = 'canvas') => {
    rendering = host; host.cursor = 0;
    let view;
    try { view = RtcVideoSurface({ viewID, onLoad: () => loaded.push(viewID), onError: error => errors.push(error) }); }
    finally { rendering = null; }
    view.props.ref.current = { tag: viewID === 'canvas' ? 11 : 22 };
    host.commit?.(); host.commit = null;
    return view;
  };
  const unmount = () => { host.cleanup?.(); host.cleanup = null; };
  const frame = async (elapsed = 16) => {
    now += elapsed;
    const tasks = [...frames.values()]; frames.clear();
    for (const callback of tasks) callback(now);
    await Promise.resolve();
  };
  t.after(() => {
    unmount();
    if (oldRequest === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = oldRequest;
    if (oldCancel === undefined) delete globalThis.cancelAnimationFrame;
    else globalThis.cancelAnimationFrame = oldCancel;
  });
  return { render, unmount, frame, frames, loaded, errors, host };
}
const tick = () => Promise.resolve();
const unpublished = () => Object.assign(new Error('Video canvas is not mounted yet'), { code: 'VIEW_NOT_MOUNTED' });

test('preview waits across unpublished Fabric frames and loads only after native registration', async t => {
  const f = fixture(t);
  f.render();
  assert.deepEqual(calls, []);
  await f.frame();
  pending.shift().reject(unpublished());
  await tick();
  assert.deepEqual(f.errors, []);
  assert.deepEqual(f.loaded, []);
  assert.equal(f.frames.size, 1);
  await f.frame();
  pending.shift().reject(unpublished());
  await tick();
  await f.frame();
  pending.shift().resolve();
  await tick();
  assert.deepEqual(f.loaded, ['canvas']);
  assert.deepEqual(f.errors, []);
  assert.equal(f.frames.size, 0);
  assert.deepEqual(calls, Array.from({ length: 3 }, () => ['register', 11, 'canvas']));
});

test('a host without a native React tag waits for it rather than hanging preview', async t => {
  const f = fixture(t), view = f.render();
  view.props.ref.current = null;
  await f.frame();
  assert.deepEqual(calls, []);
  view.props.ref.current = { tag: 33 };
  await f.frame();
  assert.deepEqual(calls, [['register', 33, 'canvas']]);
  pending.shift().resolve();
  await tick();
  assert.deepEqual(f.loaded, ['canvas']);
});

for (const message of ['Video canvas mount identity does not match', 'React Native view registry is unavailable']) {
  test(`${message} fails without retry`, async t => {
    const f = fixture(t);
    f.render();
    await f.frame();
    const error = Object.assign(new Error(message), { code: 'MEDIA_ERROR' });
    pending.shift().reject(error);
    await tick();
    assert.deepEqual(f.errors, [error]);
    assert.equal(f.frames.size, 0);
    assert.deepEqual(f.loaded, []);
  });
}

test('an unpublished canvas fails once when the bounded mount wait expires', async t => {
  const f = fixture(t);
  f.render();
  await f.frame(2500);
  pending.shift().reject(unpublished());
  await tick();
  await f.frame(2500);
  pending.shift().reject(unpublished());
  await tick();
  assert.equal(f.errors.length, 1);
  assert.match(f.errors[0].message, /Timed out waiting/);
  assert.equal(f.frames.size, 0);
  await f.frame();
  assert.equal(calls.length, 2);
});

test('unmount cancels the next attempt and suppresses an in-flight registration failure', async t => {
  const f = fixture(t);
  f.render();
  await f.frame();
  f.unmount();
  pending.shift().reject(unpublished());
  await tick();
  assert.equal(f.frames.size, 0);
  assert.deepEqual(f.errors, []);
  assert.deepEqual(f.loaded, []);
  assert.deepEqual(calls, [['register', 11, 'canvas'], ['unregister', 'canvas']]);
  await f.frame();
  assert.equal(calls.length, 2);
});

test('replacing a view cancels pending work and registers only its current native identity', async t => {
  const f = fixture(t);
  f.render();
  await f.frame();
  pending.shift().reject(unpublished());
  await tick();
  f.render('replacement');
  await f.frame();
  pending.shift().resolve();
  await tick();
  assert.deepEqual(calls, [['register', 11, 'canvas'], ['unregister', 'canvas'], ['register', 22, 'replacement']]);
  assert.deepEqual(f.loaded, ['replacement']);
  assert.deepEqual(f.errors, []);
});

test('a late completion cannot unregister a newer effect using the same canvas identity', async t => {
  const f = fixture(t);
  f.render();
  await f.frame();
  const first = pending.shift();
  f.unmount();
  f.host.dependencies = null;
  f.render();
  await f.frame();
  pending.shift().resolve();
  await tick();
  first.resolve();
  await tick();
  assert.deepEqual(f.loaded, ['canvas']);
  assert.deepEqual(calls, [['register', 11, 'canvas'], ['unregister', 'canvas'], ['register', 11, 'canvas']]);
});
