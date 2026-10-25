const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { Module } = require('node:module');
const ts = require('typescript');

function load(native) {
  const filename = resolve(__dirname, '../Example/XLab/src/external/RealtimeFileVideoSource.ts');
  const compiled = new Module(filename);
  compiled.require = name => {
    assert.equal(name, 'react-native');
    return { NativeModules: { XLabExternalCapture: native } };
  };
  compiled._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
  return compiled.exports.makeRealtimeFileVideoSource;
}

test('XLab file source preserves selected encoding options and passes only native source and sink identities', async () => {
  const calls = [];
  const make = load({
    async prepare(...args) { calls.push(['prepare', ...args]); return { sourceID: 'source', width: 720, height: 1280, fps: 30, hasAudio: true }; },
    async start(...args) { calls.push(['start', ...args]); },
    async stop(...args) { calls.push(['stop', ...args]); },
  });
  const source = await make('file:///selected.mp4', { width: 1024, height: 1920, fps: 30, minimumBitrate: 500, maximumBitrate: 1500 });
  assert.deepEqual(source.videoFormat, { width: 720, height: 1280, fps: 30, minimumBitrate: 500, maximumBitrate: 1500 });
  assert.equal(source.hasAudio, true);
  await source.start({ nativeHandle: 'sink' });
  await Promise.all([source.stop(), source.stop()]);
  await assert.rejects(source.start({ nativeHandle: 'late-sink' }), /stopped/);
  assert.deepEqual(calls, [['prepare', 'file:///selected.mp4', 30], ['start', 'source', 'sink'], ['stop', 'source']]);
});

test('XLab reports the required native rebuild when its decoder module is missing', async () => {
  await assert.rejects(load(undefined)('file:///selected.mp4', { width: 1280, height: 720, fps: 30 }), /Rebuild XLab/);
});
