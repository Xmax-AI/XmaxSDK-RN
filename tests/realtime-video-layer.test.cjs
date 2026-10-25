const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');

// Render the actual component while deliberately withholding child effects. This
// reproduces the interval where the canvas is gone but its readiness callback is stale.
let displayed = false, dirty = false;
const subscriptions = [];
mock.module('react', { namedExports: {
  ...React,
  useRef: () => ({ current: {} }),
  useLayoutEffect: effect => { const cleanup = effect(); if (cleanup) subscriptions.push(cleanup); },
  useState: () => [displayed, value => { displayed = value; dirty = true; }],
  useCallback: callback => callback,
  useSyncExternalStore: (subscribe, getSnapshot) => {
    subscriptions.push(subscribe(() => { dirty = true; }));
    return getSnapshot();
  },
} });
mock.module('react-native', { namedExports: {
  View: 'View', findNodeHandle: () => 17, StyleSheet: { create: styles => styles, absoluteFill: {} },
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
  displayed = false; dirty = false;
  let nextID = 0;
  const render = new RenderController({}, { randomUUID: () => `binding-${++nextID}` });
  const format = { width: 736, height: 1664, fps: 24 };
  const local = render.create(true, format, null, null, 'file:///preview.jpg');
  const remote = render.create(false, format, null, { roomID: 'room', userID: 'bot' });
  const props = { localTrack: local.videoTrack, remoteTrack: remote.videoTrack };
  const container = () => XmaxRealtimeDualVideo(props);
  const layer = container().props.children[1];
  const draw = () => {
    subscriptions.splice(0).forEach(unsubscribe => unsubscribe());
    dirty = false;
    return layer.type(layer.props);
  };
  const cleanup = () => subscriptions.splice(0).forEach(unsubscribe => unsubscribe());
  const hidden = view => view.props.style.some(style => style?.opacity === 0);
  return { render, local, remote, props, container, draw, cleanup, hidden };
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

    f.props.isInteractionEnabled = true;
    assert.equal(f.container().props.children[0].props.isInteractionEnabled, false);
    assert.equal(f.container().props.children[1].props.isInteractionEnabled, true);
  } finally { f.cleanup(); }
});

test('invalidating remote hides its black container before a delayed child effect, preserving preview', () => {
  const f = fixture();
  try {
    const record = videoBinding(f.remote.videoTrack);
    record.confirmed = true;
    const waiting = f.draw();
    assert.equal(f.hidden(waiting), true);
    waiting.props.children.props.onDisplayed(true);
    assert.equal(f.hidden(f.draw()), false);

    f.render.invalidate(false);
    assert.equal(dirty, true, 'The outer layer subscribes to track invalidation itself');
    const stopped = f.draw();
    assert.equal(f.hidden(stopped), true, 'Hide before receiving onDisplayed(false)');
    assert.equal(stopped.props.pointerEvents, 'none');
    assert.equal(videoBinding(f.local.videoTrack).valid, true);
    assert.equal(f.container().props.children[0].props.track, f.local.videoTrack);

    // A queued callback from a detached canvas cannot reveal its empty container.
    stopped.props.children.props.onDisplayed(true);
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
    f.draw().props.children.props.onDisplayed(true);
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
    f.draw().props.children.props.onDisplayed(true);
    f.draw();
    const count = nativeHides.length;
    await f.render.hideRemote();
    assert.deepEqual(nativeHides[count], [17, `xmax-remote-${record.id}`]);
    assert.equal(record.valid, true, 'RTC pixels remain bound until native hiding finishes');
    assert.equal(f.hidden(f.draw()), true);
    assert.equal(f.draw().props.pointerEvents, 'none');
    await f.render.hideRemote();
    assert.equal(nativeHides.length, count + 1, 'Repeated teardown shares the native acknowledgement');
  } finally { f.cleanup(); }
});
