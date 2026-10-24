const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  VideoSurfaceBinding,
} = require('../lib/commonjs/Render/Video/VideoSurfaceBinding');

function fixture() {
  const listeners = new Set();
  const calls = [];
  const displayed = [];
  const stream = { roomID: 'room', userID: 'bot' };
  const record = {
    valid: true,
    confirmed: false,
    rtc: {
      bind: (...args) => { calls.push(['bind', ...args]); },
      unbind: (...args) => calls.push(['unbind', ...args]),
      onEvent: listener => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
  const surface = new VideoSurfaceBinding(record, 'view', stream, ready => {
    displayed.push(ready);
  });
  const emit = (type = 'rendered', source = stream) => {
    for (const listener of [...listeners]) {
      listener({ type, stream: source, width: 640, height: 480 });
    }
  };
  return { record, surface, calls, displayed, emit, listeners };
}

test('mount and the content-mode effect bind a canvas only once', () => {
  const { surface, calls } = fixture();
  surface.start('fill');
  surface.setContentMode('fill');
  surface.start('fill');
  assert.equal(calls.length, 1);

  surface.setContentMode('fit');
  surface.setContentMode('fit');
  assert.equal(calls.length, 2);
  assert.equal(calls[1][3], 'fit');
  surface.dispose();
  surface.dispose();
  assert.equal(calls.length, 3);
  assert.equal(calls[2][0], 'unbind');
});

for (const first of ['rendered', 'confirmed']) {
  test(`remote display waits for both signals when ${first} arrives first`, () => {
    const { surface, record, displayed, emit, calls } = fixture();
    surface.start('fill');
    if (first === 'rendered') emit();
    else {
      record.confirmed = true;
      surface.refresh();
    }
    assert.deepEqual(displayed, []);

    record.confirmed = true;
    emit();
    surface.refresh();
    emit();
    surface.refresh();
    assert.deepEqual(displayed, [true]);
    assert.equal(calls.length, 1);

    record.confirmed = false;
    surface.refresh();
    assert.deepEqual(displayed, [true, false]);
    surface.dispose();
  });
}

test('decoded frames and unrelated streams cannot reveal a remote layer', () => {
  const { surface, record, displayed, emit } = fixture();
  record.confirmed = true;
  surface.start('fill');
  emit('decoded');
  emit('rendered', { roomID: 'old-room', userID: 'bot' });
  emit('rendered', { roomID: 'room', userID: 'other-bot' });
  assert.deepEqual(displayed, []);
  emit();
  assert.deepEqual(displayed, [true]);
  surface.dispose();
});

test('late events after unmount cannot reveal a replacement layer', () => {
  const { surface, record, listeners, displayed } = fixture();
  record.confirmed = true;
  surface.start('fill');
  const queued = [...listeners][0];
  surface.dispose();
  queued({ type: 'rendered', stream: { roomID: 'room', userID: 'bot' } });
  surface.refresh();
  assert.equal(listeners.size, 0);
  assert.deepEqual(displayed, []);
});

test('a failed canvas bind cannot reveal even a synchronously reported frame', () => {
  const { surface, record, emit, displayed } = fixture();
  record.confirmed = true;
  record.rtc.bind = () => {
    emit();
    throw new Error('canvas unavailable');
  };
  surface.start('fill');
  surface.refresh();
  assert.deepEqual(displayed, []);
  surface.dispose();
});


test('native binding acknowledgment gates preview and ignores retired completions', async () => {
  const { surface, record, emit, displayed } = fixture();
  let resolve, previews = 0;
  record.onPreviewReady = () => { previews++; };
  record.confirmed = true;
  record.rtc.bind = () => new Promise(ready => { resolve = ready; });
  surface.start('fit');
  emit();
  assert.deepEqual(displayed, []);
  assert.equal(previews, 0);
  resolve();
  await Promise.resolve();
  assert.equal(previews, 1);
  assert.deepEqual(displayed, [true]);
  surface.setContentMode('fill');
  surface.dispose();
  resolve();
  await Promise.resolve();
  assert.equal(previews, 1);
});

test('async native binding failures reach the owner without revealing the result', async () => {
  const { surface, record, emit, displayed } = fixture();
  const failures = [];
  record.confirmed = true;
  record.onBindingFailure = error => failures.push(error);
  record.rtc.bind = () => Promise.reject(new Error('native canvas missing'));
  surface.start('fit');
  emit();
  await Promise.resolve();
  assert.equal(failures.length, 1);
  assert.deepEqual(displayed, []);
  surface.dispose();
});
