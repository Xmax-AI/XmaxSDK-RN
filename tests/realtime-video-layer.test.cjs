const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');

// Render parent layout effects while deliberately withholding child effects to
// exercise the interval between resource retirement and child canvas cleanup.
let activeHost = null, dirty = false;
const animations = [];
function host() {
  const state = { slots: [], pending: [], cursor: 0, mounted: true };
  return {
    draw(callback) {
      state.cursor = 0;
      activeHost = state;
      let element;
      try { element = callback(); } finally { activeHost = null; }
      for (const effect of state.pending.splice(0)) effect();
      return element;
    },
    cleanup() {
      state.mounted = false;
      for (const slot of state.slots) slot.cleanup?.();
    },
  };
}
function layoutEffect(effect, dependencies) {
  const owner = activeHost, index = owner.cursor++, previous = owner.slots[index];
  if (previous && dependencies.every((value, i) => Object.is(value, previous.dependencies[i]))) return;
  const slot = { dependencies, cleanup: previous?.cleanup };
  owner.slots[index] = slot;
  owner.pending.push(() => { slot.cleanup?.(); slot.cleanup = effect(); });
}
mock.module('react', { namedExports: {
  ...React,
  useRef: initial => {
    const owner = activeHost, index = owner.cursor++;
    return owner.slots[index] ??= { current: initial };
  },
  useLayoutEffect: layoutEffect,
  useState: initial => {
    const owner = activeHost, index = owner.cursor++;
    const slot = owner.slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
    return [slot.value, value => { if (owner.mounted) { slot.value = value; dirty = true; } }];
  },
  useCallback: callback => callback,
  useSyncExternalStore: (subscribe, getSnapshot) => {
    layoutEffect(() => subscribe(() => { dirty = true; }), [subscribe]);
    return getSnapshot();
  },
} });
class AnimatedValue {
  constructor(value) { this.value = value; this.animation = null; }
  setValue(value) { this.stopAnimation(); this.value = value; }
  stopAnimation() { this.animation?.stop(); }
}
mock.module('react-native', { namedExports: {
  View: 'View', findNodeHandle: () => 17, StyleSheet: { create: styles => styles, absoluteFill: {} },
  Easing: { ease: value => value, inOut: easing => easing },
  Animated: {
    View: 'AnimatedView', Value: AnimatedValue,
    timing(value, config) {
      const animation = {
        config, stopped: false,
        start() { value.animation = animation; animations.push(animation); },
        stop() { animation.stopped = true; if (value.animation === animation) value.animation = null; },
        finish() { if (!animation.stopped) { value.value = config.toValue; value.animation = null; } },
      };
      return animation;
    },
  },
} });
mock.module(require.resolve('../lib/commonjs/Render/Video/XmaxRealtimeVideo'), {
  namedExports: { VideoSurface: () => null },
});
const nativeHides = [];
mock.module(require.resolve('../lib/commonjs/Foundation/Native/NativeXmaxRuntime'), {
  defaultExport: { hideVideoContainer: async (...args) => { nativeHides.push(args); } },
});
const { XmaxRealtimeDualVideo } = require('../lib/commonjs/Render/Video/XmaxRealtimeDualVideo');
const { RenderController } = require('../lib/commonjs/Render/RenderController');
const { videoBinding, refreshBinding } = require('../lib/commonjs/Render/Video/VideoRenderRegistry');

function fixture() {
  dirty = false; animations.length = 0;
  let nextID = 0;
  const render = new RenderController({}, { randomUUID: () => `binding-${++nextID}` });
  const format = { width: 736, height: 1664, fps: 24 };
  const local = render.create(true, format, null, null, 'file:///preview.jpg');
  const remote = render.create(false, format, null, { roomID: 'room', userID: 'bot' });
  const props = { localTrack: local.videoTrack, remoteTrack: remote.videoTrack };
  const container = () => XmaxRealtimeDualVideo(props);
  let current = host(), key = container().props.children[1].key;
  const draw = () => {
    const layer = container().props.children[1];
    if (key !== layer.key) { current.cleanup(); current = host(); key = layer.key; }
    dirty = false;
    return current.draw(() => layer.type(layer.props));
  };
  const cleanup = () => current.cleanup();
  const hidden = view => view.props.style.some(style => style?.opacity === 0);
  const surface = view => view.props.children.props.children;
  const opacity = view => view.props.children.props.style[1].opacity;
  return { render, local, remote, props, container, draw, cleanup, hidden, surface, opacity };
}

test('dual-track views keep interaction on the remote layer and apply content mode to both layers', () => {
  const f = fixture();
  try {
    const renderer = {};
    Object.assign(f.props, { videoContentMode: 'fit', isInteractionEnabled: false, trajectoryRenderer: renderer });
    const [local, remote] = f.container().props.children;
    assert.equal(local.props.track, f.local.videoTrack);
    assert.equal(local.props.isInteractionEnabled, false);
    assert.equal(local.props.videoContentMode, 'fit');
    assert.equal(remote.props.track, f.remote.videoTrack);
    assert.equal(remote.props.isInteractionEnabled, false);
    assert.equal(remote.props.videoContentMode, 'fit');
    assert.equal(remote.props.trajectoryRenderer, renderer);
    assert.equal(remote.props.remoteVideoFadeInDuration, 0.3);

    f.props.isInteractionEnabled = true;
    assert.equal(f.container().props.children[0].props.isInteractionEnabled, false);
    assert.equal(f.container().props.children[1].props.isInteractionEnabled, true);
  } finally { f.cleanup(); }
});

test('remote output fades in for 300 ms only after confirmation and its first rendered frame', () => {
  const f = fixture();
  try {
    const waiting = f.draw();
    assert.equal(f.opacity(waiting).value, 0);
    assert.equal(animations.length, 0);
    f.surface(waiting).props.onDisplayed(true);
    assert.equal(f.hidden(f.draw()), true);
    assert.equal(animations.length, 0);

    videoBinding(f.remote.videoTrack).confirmed = true;
    const ready = f.draw();
    assert.equal(f.hidden(ready), false);
    assert.equal(f.opacity(ready).value, 0);
    assert.equal(animations.length, 1);
    assert.equal(animations[0].config.duration, 300);
    assert.equal(animations[0].config.useNativeDriver, true);
    assert.equal(animations[0].config.isInteraction, false);
    animations[0].finish();
    assert.equal(f.opacity(f.draw()).value, 1);
    assert.equal(animations.length, 1);
  } finally { f.cleanup(); }
});

for (const duration of [0, -0.5, NaN, Infinity, -Infinity]) {
  test(`nonpositive or nonfinite fade duration shows ready output immediately (${duration})`, () => {
    const f = fixture();
    try {
      f.props.remoteVideoFadeInDuration = duration;
      videoBinding(f.remote.videoTrack).confirmed = true;
      const waiting = f.draw();
      assert.equal(f.hidden(waiting), true);
      f.surface(waiting).props.onDisplayed(true);
      const ready = f.draw();
      assert.equal(f.hidden(ready), false);
      assert.equal(f.opacity(ready).value, 1);
      assert.equal(animations.length, 0);
    } finally { f.cleanup(); }
  });
}

test('duration updates affect the next fade without restarting the active animation', () => {
  const f = fixture();
  try {
    f.props.remoteVideoFadeInDuration = 0.8;
    const record = videoBinding(f.remote.videoTrack);
    record.confirmed = true;
    f.surface(f.draw()).props.onDisplayed(true);
    f.draw();
    const first = animations[0];
    assert.equal(first.config.duration, 800);
    f.props.remoteVideoFadeInDuration = 0.1;
    f.draw();
    assert.equal(animations.length, 1);
    assert.equal(first.stopped, false);
    record.confirmed = false;
    f.draw();
    assert.equal(first.stopped, true);
    record.confirmed = true;
    f.draw();
    assert.equal(animations.length, 2);
    assert.equal(animations[1].config.duration, 100);
  } finally { f.cleanup(); }
});

test('a replacement track starts hidden and cannot inherit the old track animation or callbacks', () => {
  const f = fixture();
  try {
    videoBinding(f.remote.videoTrack).confirmed = true;
    const oldSurface = f.surface(f.draw());
    oldSurface.props.onDisplayed(true);
    f.draw();
    const oldAnimation = animations[0];
    const replacement = f.render.create(false, { width: 736, height: 1664, fps: 24 }, null, { roomID: 'room', userID: 'bot' });
    f.props.remoteTrack = replacement.videoTrack;
    const waiting = f.draw();
    assert.equal(oldAnimation.stopped, true);
    assert.equal(f.hidden(waiting), true);
    assert.equal(f.opacity(waiting).value, 0);
    oldSurface.props.onDisplayed(true);
    oldAnimation.finish();
    assert.equal(f.hidden(f.draw()), true);
    assert.equal(animations.length, 1);
    assert.equal(videoBinding(f.remote.videoTrack).hideBeforeRelease.size, 0);
    assert.equal(f.container().props.children[0].props.track, f.local.videoTrack);

    videoBinding(replacement.videoTrack).confirmed = true;
    f.surface(f.draw()).props.onDisplayed(true);
    f.draw();
    assert.equal(animations.length, 2);
  } finally { f.cleanup(); }
});

test('unmount stops the active fade and releases its retirement callback', () => {
  const f = fixture();
  try {
    const record = videoBinding(f.remote.videoTrack);
    record.confirmed = true;
    f.surface(f.draw()).props.onDisplayed(true);
    const ready = f.draw(), opacity = f.opacity(ready), animation = animations[0];
    f.cleanup();
    animation.finish();
    assert.equal(animation.stopped, true);
    assert.equal(opacity.value, 0);
    assert.equal(record.hideBeforeRelease.size, 0);
    assert.equal(record.listeners.size, 0);
  } finally { f.cleanup(); }
});

test('invalidating remote hides its black container before a delayed child effect, preserving preview', () => {
  const f = fixture();
  try {
    const record = videoBinding(f.remote.videoTrack);
    record.confirmed = true;
    const waiting = f.draw();
    assert.equal(f.hidden(waiting), true);
    f.surface(waiting).props.onDisplayed(true);
    assert.equal(f.hidden(f.draw()), false);

    f.render.invalidate(false);
    assert.equal(dirty, true, 'The outer layer subscribes to track invalidation itself');
    const stopped = f.draw();
    assert.equal(f.hidden(stopped), true, 'Hide before receiving onDisplayed(false)');
    assert.equal(stopped.props.pointerEvents, 'none');
    assert.equal(videoBinding(f.local.videoTrack).valid, true);
    assert.equal(f.container().props.children[0].props.track, f.local.videoTrack);

    // A queued callback from a detached canvas cannot reveal its empty container.
    f.surface(stopped).props.onDisplayed(true);
    assert.equal(f.hidden(f.draw()), true);
    f.props.remoteTrack = null;
    assert.equal(f.container().props.children[1], null);
  } finally { f.cleanup(); }
  assert.equal(videoBinding(f.remote.videoTrack).listeners.size, 0);
});

test('clearing task confirmation hides the remote layer without waiting for its child effect', () => {
  const f = fixture();
  try {
    const record = videoBinding(f.remote.videoTrack);
    record.confirmed = true;
    f.surface(f.draw()).props.onDisplayed(true);
    assert.equal(f.hidden(f.draw()), false);
    record.confirmed = false;
    refreshBinding(record);
    assert.equal(dirty, true);
    assert.equal(f.hidden(f.draw()), true);
    assert.equal(videoBinding(f.local.videoTrack).valid, true);
  } finally { f.cleanup(); }
});


test('retirement uses the native container identity and hides without invalidating the canvas first', async () => {
  const f = fixture();
  try {
    const record = videoBinding(f.remote.videoTrack);
    record.confirmed = true;
    f.surface(f.draw()).props.onDisplayed(true);
    const ready = f.draw(), opacity = f.opacity(ready), animation = animations[0];
    const count = nativeHides.length;
    await f.render.hideRemote();
    assert.equal(animation.stopped, true);
    animation.finish();
    assert.equal(opacity.value, 0);
    assert.deepEqual(nativeHides[count], [17, `xmax-remote-${record.id}`]);
    assert.equal(record.valid, true, 'RTC pixels remain bound until native hiding finishes');
    assert.equal(f.hidden(f.draw()), true);
    assert.equal(f.draw().props.pointerEvents, 'none');
    await f.render.hideRemote();
    assert.equal(nativeHides.length, count + 1, 'Repeated teardown shares the native acknowledgement');
  } finally { f.cleanup(); }
});
