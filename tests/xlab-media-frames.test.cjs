const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { Module } = require('node:module');
const { setImmediate: nextTurn } = require('node:timers/promises');
const ts = require('typescript');

const filename = resolve(__dirname, '../Example/XLab/src/realtime/RemoteMediaFrameReception.ts');
const compiled = new Module(filename, module);
compiled.require = name => name === 'react-native' ? { NativeModules: {} } : require(name);
compiled._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { RemoteMediaFrameReception } = compiled.exports;

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  const events = [];
  const realtime = {
    async setRemoteMediaFrameListener(value) { events.push(['listener', value]); },
  };
  const native = {
    async createConsumer() { events.push(['create']); return 'receiver'; },
    async getStatistics(handle) { events.push(['statistics', handle]); return { videoFrames: 30, audioPackets: 100 }; },
    async releaseConsumer(handle) { events.push(['release', handle]); },
  };
  return { events, realtime, native };
}

test('XLab registers once, reads scalar counters and unregisters before releasing its consumer', async () => {
  const { events, realtime, native } = fixture();
  const receiver = new RemoteMediaFrameReception(realtime, native);
  const opening = receiver.start();
  assert.equal(receiver.start(), opening);
  await opening;
  assert.deepEqual(await receiver.getStatistics(), { videoFrames: 30, audioPackets: 100 });
  const closing = receiver.close();
  assert.equal(receiver.close(), closing);
  await closing;
  assert.deepEqual(events, [
    ['create'], ['listener', { nativeHandle: 'receiver' }], ['statistics', 'receiver'],
    ['listener', null], ['release', 'receiver'],
  ]);
  assert.equal(await receiver.getStatistics(), null);
  await assert.rejects(receiver.start(), /closed/);
});

test('leaving while native creation is pending releases the late receiver without registering it', async () => {
  const { events, realtime, native } = fixture(), creating = deferred();
  native.createConsumer = () => creating.promise;
  const receiver = new RemoteMediaFrameReception(realtime, native);
  const opening = receiver.start(), closing = receiver.close();
  creating.resolve('late');
  await Promise.all([opening, closing]);
  assert.deepEqual(events, [['release', 'late']]);
});

test('leaving while registration is pending waits before unregistering and releasing the consumer', async () => {
  const { events, realtime, native } = fixture(), registration = deferred();
  realtime.setRemoteMediaFrameListener = async value => {
    events.push(['listener', value]);
    if (value) await registration.promise;
  };
  const receiver = new RemoteMediaFrameReception(realtime, native);
  const opening = receiver.start();
  await nextTurn();
  const closing = receiver.close();
  assert.deepEqual(events, [['create'], ['listener', { nativeHandle: 'receiver' }]]);
  registration.resolve();
  await Promise.all([opening, closing]);
  assert.deepEqual(events.slice(-2), [['listener', null], ['release', 'receiver']]);
});

test('failed registration still permits native receiver cleanup', async () => {
  const { events, realtime, native } = fixture();
  realtime.setRemoteMediaFrameListener = async () => { throw new Error('registration fixture'); };
  const receiver = new RemoteMediaFrameReception(realtime, native);
  await assert.rejects(receiver.start(), /registration fixture/);
  await receiver.close();
  assert.deepEqual(events, [['create'], ['release', 'receiver']]);
});

test('failed unregistration still releases the native consumer', async () => {
  const { events, realtime, native } = fixture();
  const receiver = new RemoteMediaFrameReception(realtime, native);
  await receiver.start();
  realtime.setRemoteMediaFrameListener = async () => { throw new Error('cleanup fixture'); };
  await assert.rejects(receiver.close(), /cleanup fixture/);
  assert.deepEqual(events.at(-1), ['release', 'receiver']);
});

test('late statistics never restore a released receiver snapshot', async () => {
  const { realtime, native } = fixture(), statistics = deferred();
  native.getStatistics = () => statistics.promise;
  const receiver = new RemoteMediaFrameReception(realtime, native);
  assert.equal(await receiver.getStatistics(), null);
  await receiver.start();
  const reading = receiver.getStatistics();
  await receiver.close();
  statistics.resolve({ videoFrames: 30, audioPackets: 100 });
  assert.equal(await reading, null);
});

test('missing native modules fail explicitly without registering an invalid handle', async () => {
  const { events, realtime } = fixture();
  const receiver = new RemoteMediaFrameReception(realtime);
  await assert.rejects(receiver.start(), /Rebuild XLab/);
  await receiver.close();
  assert.deepEqual(events, []);
});
