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
    async startRecording(handle) { events.push(['record', handle]); },
    async stopRecording(handle) { events.push(['save', handle]); return 'content://saved.mp4'; },
    async getRecordingError() { return null; },
    async releaseConsumer(handle) { events.push(['release', handle]); },
  };
  return { events, realtime, native };
}

test('XLab registers once, records and saves native media and unregisters before releasing its consumer', async () => {
  const { events, realtime, native } = fixture();
  const receiver = new RemoteMediaFrameReception(realtime, native);
  const opening = receiver.start();
  assert.equal(receiver.start(), opening);
  await opening;
  await receiver.startRecording();
  assert.equal(await receiver.stopRecording(), 'content://saved.mp4');
  const closing = receiver.close();
  assert.equal(receiver.close(), closing);
  await closing;
  assert.deepEqual(events, [
    ['create'], ['listener', { nativeHandle: 'receiver' }], ['record', 'receiver'], ['save', 'receiver'],
    ['listener', null], ['release', 'receiver'],
  ]);
  assert.equal(await receiver.getRecordingError(), null);
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

test('closing during album permission waits for recording completion, saves once, then releases', async () => {
  const { events, realtime, native } = fixture(), permission = deferred();
  native.startRecording = async handle => { events.push(['record', handle]); await permission.promise; };
  const receiver = new RemoteMediaFrameReception(realtime, native);
  const recording = receiver.startRecording();
  await nextTurn();
  const closing = receiver.close();
  assert.equal(events.some(([event]) => event === 'release'), false);
  permission.resolve();
  await Promise.all([recording, closing]);
  assert.deepEqual(events.slice(-3), [['save', 'receiver'], ['listener', null], ['release', 'receiver']]);
});

test('simultaneous manual stop and route exit share one save even when saving fails', async () => {
  const { events, realtime, native } = fixture(), saving = deferred();
  native.stopRecording = async handle => { events.push(['save', handle]); return saving.promise; };
  const receiver = new RemoteMediaFrameReception(realtime, native);
  await receiver.startRecording();
  const stop = receiver.stopRecording();
  assert.equal(receiver.stopRecording(), stop);
  const closing = receiver.close();
  saving.reject(new Error('record.saveFailed'));
  await assert.rejects(stop, /saveFailed/);
  await assert.rejects(closing, /saveFailed/);
  assert.equal(events.filter(([event]) => event === 'save').length, 1);
  assert.deepEqual(events.slice(-2), [['listener', null], ['release', 'receiver']]);
});

test('encoder failures reset recording so stopping does not try to save discarded media', async () => {
  const { events, realtime, native } = fixture();
  native.getRecordingError = async () => 'record.sizeChanged';
  const receiver = new RemoteMediaFrameReception(realtime, native);
  await receiver.startRecording();
  assert.equal(await receiver.getRecordingError(), 'record.sizeChanged');
  assert.equal(await receiver.stopRecording(), null);
  await receiver.close();
  assert.equal(events.some(([event]) => event === 'save'), false);
});

test('missing native modules fail explicitly without registering an invalid handle', async () => {
  const { events, realtime } = fixture();
  const receiver = new RemoteMediaFrameReception(realtime);
  await assert.rejects(receiver.start(), /Rebuild XLab/);
  await receiver.close();
  assert.deepEqual(events, []);
});
