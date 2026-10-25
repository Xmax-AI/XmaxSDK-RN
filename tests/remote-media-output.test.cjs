const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RemoteMediaFrameController } = require('../lib/commonjs/Render/Video/RemoteMediaFrameController');
const { RenderController } = require('../lib/commonjs/Render/RenderController');

function fixture() {
  const calls = [];
  let next = 0, configure = async () => {};
  const rtc = {
    randomUUID: () => `identity-${++next}`,
    async setRemoteMediaFrameListener(...args) { calls.push(args); return configure(...args); },
    async waitUntilRemoteFrameReady(stream) { calls.push(['ready', stream]); },
  };
  return { calls, rtc, output: new RemoteMediaFrameController(rtc), setConfigure(value) { configure = value; } };
}
const remote = { roomID: 'room', userID: 'result' };
const tick = () => Promise.resolve();
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('unused media output does not configure native observation during preview or generation', async () => {
  const f = fixture();
  await f.output.bind(remote);
  await f.output.clear();
  await f.output.setListener(null);
  assert.deepEqual(f.calls, []);
});

test('registration before generation snapshots the native handle without acquiring resources', async () => {
  const f = fixture(), consumer = { nativeHandle: 'consumer' };
  await f.output.setListener(consumer);
  consumer.nativeHandle = 'mutated';
  assert.deepEqual(f.calls, []);
  await f.output.bind(remote);
  assert.deepEqual(f.calls[0], [{ nativeHandle: 'consumer' }, remote, 'identity-1']);
  await f.output.setListener({ nativeHandle: 'replacement' });
  assert.deepEqual(f.calls[1], [{ nativeHandle: 'replacement' }, remote, 'identity-1']);
  await f.output.setListener(null);
  assert.deepEqual(f.calls[2], [null, null, null]);
});

test('output removal and a replacement result binding remain ordered behind in-flight setup', async () => {
  const f = fixture(), gate = deferred();
  await f.output.setListener({ nativeHandle: 'consumer' });
  f.setConfigure(() => f.calls.length === 1 ? gate.promise : Promise.resolve());
  const first = f.output.bind(remote);
  await tick();
  const removal = f.output.clear();
  const replacement = f.output.bind(remote);
  assert.equal(f.calls.length, 1);
  gate.resolve();
  await Promise.all([first, removal, replacement]);
  assert.deepEqual(f.calls, [
    [{ nativeHandle: 'consumer' }, remote, 'identity-1'],
    [null, null, null],
    [{ nativeHandle: 'consumer' }, remote, 'identity-2'],
  ]);
});

test('failed listener replacement retains the previous receiver for later connections', async () => {
  const f = fixture();
  await f.output.setListener({ nativeHandle: 'original' });
  await f.output.bind(remote);
  f.setConfigure(listener => listener?.nativeHandle === 'invalid' ? Promise.reject(new Error('expired native handle')) : Promise.resolve());
  await assert.rejects(f.output.setListener({ nativeHandle: 'invalid' }), /expired native handle/);
  await f.output.clear();
  await f.output.bind(remote);
  assert.equal(f.calls.at(-1)[0].nativeHandle, 'original');
});

test('an obsolete failed setter cannot overwrite a newer receiver', async () => {
  const f = fixture(), gate = deferred();
  await f.output.bind(remote);
  f.setConfigure(listener => listener?.nativeHandle === 'first' ? gate.promise : Promise.resolve());
  const first = f.output.setListener({ nativeHandle: 'first' });
  await tick();
  const second = f.output.setListener({ nativeHandle: 'second' });
  gate.reject(new Error('obsolete setter'));
  await assert.rejects(first, /obsolete setter/);
  await second;
  await f.output.clear();
  await f.output.bind(remote);
  assert.equal(f.calls.at(-1)[0].nativeHandle, 'second');
});

test('invalid consumer descriptors reject before configuring RTC', async () => {
  const f = fixture();
  for (const listener of [undefined, {}, () => {}, { nativeHandle: '' }, { nativeHandle: '  ' }, { nativeHandle: 1 }]) {
    await assert.rejects(f.output.setListener(listener), { code: 'INVALID_CONFIGURATION' });
  }
  assert.deepEqual(f.calls, []);
});

test('rendering configures headless output before first-frame readiness and retires it when generation stops', async () => {
  const f = fixture(), render = new RenderController({}, f.rtc);
  const format = { width: 1024, height: 1920, fps: 30 };
  const stream = render.create(false, format, null, remote);
  await render.setRemoteMediaFrameListener({ nativeHandle: 'consumer' });
  await render.waitUntilRemoteFrameReady(remote, new AbortController().signal);
  assert.equal(f.calls[0][0].nativeHandle, 'consumer');
  assert.deepEqual(f.calls[1], ['ready', remote]);
  await render.setRemoteStream(stream, null);
  await tick(); await tick();
  assert.deepEqual(f.calls.at(-1), [null, null, null]);
  f.calls.length = 0;
  await render.waitUntilRemoteFrameReady(remote, new AbortController().signal);
  assert.equal(f.calls[0][0].nativeHandle, 'consumer');
});

test('clearing a result waits for native output removal before completing stop coordination', async () => {
  const f = fixture(), render = new RenderController({}, f.rtc), gate = deferred();
  const stream = render.create(false, { width: 1024, height: 1920, fps: 30 }, null, remote);
  await render.setRemoteMediaFrameListener({ nativeHandle: 'consumer' });
  await render.waitUntilRemoteFrameReady(remote, new AbortController().signal);
  f.setConfigure(listener => listener === null ? gate.promise : Promise.resolve());
  let done = false;
  const removal = render.setRemoteStream(stream, null).then(() => { done = true; });
  await tick(); await tick();
  assert.equal(done, false);
  assert.deepEqual(f.calls.at(-1), [null, null, null]);
  gate.resolve();
  await removal;
  assert.equal(done, true);
});
