const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { Module } = require('node:module');
const { setImmediate: nextTurn } = require('node:timers/promises');
const ts = require('typescript');
const filename = resolve(__dirname, '../Example/XLab/src/configuration/ConfigurationStore.ts');
const compiled = new Module(filename, module);
compiled.require = name => name === '@xmaxai/react-native-sdk'
  ? { XmaxEnvironment: { china: 'china', global: 'global' }, RealtimeModel: require('../lib/commonjs/Service/Realtime/RealtimeTypes').RealtimeModel }
  : require(name);
compiled._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { ConfigurationStore, parseBitrateOverride, apiBaseURLForEndpoint, environmentForEndpoint } = compiled.exports;

// Model the pinned iOS helper: any present cloudSync NSNumber enables sync,
// including @NO. This is the native boundary the in-memory store tests omit.
function iosSecureStorage() {
  const entries = new Map();
  const slot = options => `${options.service}:${options.cloudSync !== undefined}`;
  const keychain = {
    ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only' },
    STORAGE_TYPE: { AES_GCM_NO_AUTH: 'aes-gcm' },
    async getGenericPassword(options) {
      const password = entries.get(slot(options));
      return password === undefined ? false : { password };
    },
    async setGenericPassword(username, password, options) {
      if (options.cloudSync !== undefined && options.accessible === 'device-only') {
        throw new Error('Synchronizable entries cannot use device-only accessibility');
      }
      entries.set(slot(options), password);
      return { service: options.service };
    },
    async resetGenericPassword(options) {
      entries.delete(slot(options));
      return true;
    },
  };
  const adapterPath = resolve(__dirname, '../Example/XLab/src/configuration/SecureConfigurationStorage.ts');
  const adapter = new Module(adapterPath, module);
  adapter.require = name => name === 'react-native-keychain' ? keychain : require(name);
  adapter._compile(ts.transpileModule(readFileSync(adapterPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, adapterPath);
  return adapter.exports.secureConfigurationStorage;
}

test('secure adapter saves, restores and deletes local iOS keys with the pinned cloudSync semantics', async () => {
  const secure = iosSecureStorage(), store = new ConfigurationStore(secure);
  await store.load();
  store.setKey('china', 'china-fixture');
  store.selectEndpoint('global');
  store.setKey('global', 'global-fixture');
  await nextTurn();
  assert.equal(store.getSnapshot().error, null);

  const reloaded = new ConfigurationStore(secure);
  await reloaded.load();
  assert.equal(reloaded.getSnapshot().endpoint, 'global');
  assert.deepEqual(reloaded.getSnapshot().keys, { china: 'china-fixture', global: 'global-fixture' });

  reloaded.setKey('global', '');
  await nextTurn();
  const afterDeletion = new ConfigurationStore(secure);
  await afterDeletion.load();
  assert.deepEqual(afterDeletion.getSnapshot().keys, { china: 'china-fixture', global: '' });
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    async read(field) { return values.get(field) ?? null; },
    async write(field, value) { if (value) values.set(field, value); else values.delete(field); },
  };
}

test('keys and last endpoint survive reload without cross-endpoint fallback', async () => {
  const disk = storage(), store = new ConfigurationStore(disk);
  await store.load();
  store.setKey('china', 'china-fixture');
  store.selectEndpoint('global');
  assert.equal(store.getSnapshot().keys.global, '');
  store.setKey('global', 'global-fixture');
  await nextTurn();
  const reloaded = new ConfigurationStore(disk);
  await reloaded.load();
  assert.equal(reloaded.getSnapshot().endpoint, 'global');
  assert.deepEqual(reloaded.getSnapshot().keys, { china: 'china-fixture', global: 'global-fixture' });
  reloaded.setKey('global', '  ');
  await nextTurn();
  assert.equal(disk.values.get('china'), 'china-fixture');
  assert.equal(disk.values.has('global'), false);
});

test('rapid edits during a slow write preserve the latest value in each slot', async () => {
  const disk = storage(), first = deferred(), calls = [];
  const originalWrite = disk.write;
  disk.write = async (field, value) => {
    calls.push([field, value]);
    if (calls.length === 1) await first.promise;
    await originalWrite(field, value);
  };
  const store = new ConfigurationStore(disk);
  await store.load();
  store.setKey('china', 'old');
  store.setKey('china', 'newer');
  store.selectEndpoint('global');
  store.setKey('global', 'other');
  store.setKey('china', 'latest');
  assert.equal(store.getSnapshot().saving, true);
  first.resolve();
  await nextTurn();
  assert.equal(disk.values.get('china'), 'latest');
  assert.equal(disk.values.get('global'), 'other');
  assert.equal(disk.values.get('environment'), 'global');
  assert.equal(calls.some(([, value]) => value === 'newer'), false);
  assert.equal(store.getSnapshot().saving, false);
});

test('read failure blocks editing and can retry without overwriting saved keys', async () => {
  const disk = storage({ china: 'saved' });
  let fail = true;
  const read = disk.read;
  disk.read = async field => { if (fail) throw new Error('fixture'); return read(field); };
  const store = new ConfigurationStore(disk);
  await store.load();
  store.setKey('china', '');
  assert.equal(store.getSnapshot().loaded, false);
  assert(store.getSnapshot().error);
  assert.equal(disk.values.get('china'), 'saved');
  fail = false;
  await store.load();
  assert.equal(store.getSnapshot().keys.china, 'saved');
  assert.equal(store.getSnapshot().error, null);
});

test('failed write retains newer edits and deletion for explicit retry', async () => {
  const disk = storage({ china: 'previous' }), failure = deferred();
  let fail = true;
  const write = disk.write;
  disk.write = async (field, value) => { if (fail) await failure.promise; await write(field, value); };
  const store = new ConfigurationStore(disk);
  await store.load();
  store.setKey('china', 'intermediate');
  store.setKey('china', '');
  store.setKey('global', 'other');
  failure.reject(new Error('do not echo credentials'));
  await nextTurn();
  assert.equal(store.getSnapshot().error, 'configuration.saveError');
  fail = false;
  await store.flush();
  assert.equal(disk.values.has('china'), false);
  assert.equal(disk.values.get('global'), 'other');
  assert.equal(store.getSnapshot().error, null);
});

test('initial read is coalesced and input cannot race hydration', async () => {
  const gate = deferred(), disk = storage({ china: 'stored', environment: 'global' });
  let reads = 0;
  const read = disk.read;
  disk.read = async field => { reads++; await gate.promise; return read(field); };
  const store = new ConfigurationStore(disk);
  const loading = store.load();
  assert.equal(store.load(), loading);
  store.setKey('china', 'ignored');
  store.selectEndpoint('china');
  gate.resolve();
  await loading;
  assert.equal(reads, 7);
  assert.equal(store.getSnapshot().endpoint, 'global');
  assert.equal(store.getSnapshot().keys.china, 'stored');
});

test('language changes survive reload independently of API endpoint and credentials', async () => {
  const disk = iosSecureStorage(), store = new ConfigurationStore(disk);
  await store.load();
  assert.equal(store.getSnapshot().language, 'system');
  store.setKey('china', 'china-fixture');
  store.selectEndpoint('global');
  store.setKey('global', 'global-fixture');
  store.selectLanguage('zh-Hans');
  store.selectLanguage('en');
  assert.equal(store.getSnapshot().language, 'en');
  await nextTurn();

  const reloaded = new ConfigurationStore(disk);
  await reloaded.load();
  assert.equal(reloaded.getSnapshot().language, 'en');
  assert.equal(reloaded.getSnapshot().endpoint, 'global');
  assert.deepEqual(reloaded.getSnapshot().keys, { china: 'china-fixture', global: 'global-fixture' });

  reloaded.selectLanguage('system');
  await nextTurn();
  const followSystem = new ConfigurationStore(disk);
  await followSystem.load();
  assert.equal(followSystem.getSnapshot().language, 'system');
});

test('missing and obsolete language preferences fall back without overwriting existing keys', async () => {
  for (const language of [undefined, 'fr', 'zh-Hans']) {
    const disk = storage({ china: 'saved', ...(language ? { language } : {}) });
    const store = new ConfigurationStore(disk);
    const loading = store.load();
    store.selectLanguage('en');
    await loading;
    assert.equal(store.getSnapshot().language, language === 'zh-Hans' ? 'zh-Hans' : 'system');
    assert.equal(store.getSnapshot().keys.china, 'saved');
    assert.equal(disk.values.get('language'), language);
  }
});

test('failed language writes keep the newest preference for retry', async () => {
  const disk = storage(), gate = deferred();
  const write = disk.write;
  let fail = true;
  disk.write = async (field, value) => {
    if (field === 'language' && fail) await gate.promise;
    await write(field, value);
  };
  const store = new ConfigurationStore(disk);
  await store.load();
  store.selectLanguage('zh-Hans');
  store.selectLanguage('en');
  store.setKey('china', 'saved-key');
  gate.reject(new Error('fixture'));
  await nextTurn();
  assert.equal(store.getSnapshot().language, 'en');
  assert.equal(store.getSnapshot().error, 'configuration.saveError');

  fail = false;
  await store.flush();
  const reloaded = new ConfigurationStore(disk);
  await reloaded.load();
  assert.equal(reloaded.getSnapshot().language, 'en');
  assert.equal(reloaded.getSnapshot().keys.china, 'saved-key');
});


test('X2.1 model selection keeps the service environment and credentials independent', async () => {
  const disk = storage({ china: 'cn-fixture', global: 'global-fixture', environment: 'global' });
  const store = new ConfigurationStore(disk);
  await store.load();
  assert.equal(store.getSnapshot().model, 'x2.1');
  store.selectModel('x2.1');
  assert.equal(store.getSnapshot().endpoint, 'global');
  store.selectEndpoint('china');
  assert.equal(store.getSnapshot().model, 'x2.1');
  store.selectModel('obsolete-model');
  await nextTurn();
  const reloaded = new ConfigurationStore(disk);
  await reloaded.load();
  assert.equal(reloaded.getSnapshot().model, 'x2.1');
  assert.equal(reloaded.getSnapshot().endpoint, 'china');
  assert.deepEqual(reloaded.getSnapshot().keys, { china: 'cn-fixture', global: 'global-fixture' });
});

test('legacy regional models migrate to X2.1 and only supply a missing environment', async () => {
  for (const [model, environment, expected] of [
    ['x2.1.1-preview-us', undefined, 'global'],
    ['x2.1.1-preview-cn', undefined, 'china'],
    ['x2.1.1-preview-us', 'china', 'china'],
    ['x2.1.1-preview-cn', 'global', 'global'],
    ['obsolete-model', 'global', 'global'],
  ]) {
    const disk = storage({ model, ...(environment ? { environment } : {}), global: 'saved' });
    const store = new ConfigurationStore(disk);
    await store.load();
    assert.equal(store.getSnapshot().model, 'x2.1');
    assert.equal(store.getSnapshot().endpoint, expected);
    assert.equal(store.getSnapshot().keys.global, 'saved');
  }
});

test('endpoint selection persists with its own key slot and obsolete values fall back to China', async () => {
  const disk = storage({ environment: 'obsolete-endpoint' });
  const fallback = new ConfigurationStore(disk);
  await fallback.load();
  assert.equal(fallback.getSnapshot().endpoint, 'china');

  const store = new ConfigurationStore(disk);
  await store.load();
  store.selectEndpoint('global');
  store.setKey('global', 'global-fixture');
  await nextTurn();
  const reloaded = new ConfigurationStore(disk);
  await reloaded.load();
  assert.equal(reloaded.getSnapshot().endpoint, 'global');
  assert.deepEqual(reloaded.getSnapshot().keys, { china: '', global: 'global-fixture' });
});

test('endpoints resolve their API base URL and SDK environment', () => {
  assert.equal(apiBaseURLForEndpoint('china'), 'https://cloud.xmax.22duck.cn/open/api/v1');
  assert.equal(apiBaseURLForEndpoint('global'), 'https://api.xmax.ai/open/api/v1');
  assert.equal(environmentForEndpoint('global'), 'global');
  assert.equal(environmentForEndpoint('china'), 'china');
});

test('bitrate inputs persist across reloads and empty values delete their slots', async () => {
  const disk = storage(), store = new ConfigurationStore(disk);
  await store.load();
  assert.equal(store.getSnapshot().minBitrate, '');
  assert.equal(store.getSnapshot().maxBitrate, '');
  store.setBitrate('minBitrate', ' 2000 ');
  store.setBitrate('maxBitrate', '4000');
  assert.equal(store.getSnapshot().minBitrate, ' 2000 ');
  await nextTurn();
  const reloaded = new ConfigurationStore(disk);
  await reloaded.load();
  assert.equal(reloaded.getSnapshot().minBitrate, '2000');
  assert.equal(reloaded.getSnapshot().maxBitrate, '4000');
  reloaded.setBitrate('minBitrate', '');
  await nextTurn();
  const cleared = new ConfigurationStore(disk);
  await cleared.load();
  assert.equal(cleared.getSnapshot().minBitrate, '');
  assert.equal(cleared.getSnapshot().maxBitrate, '4000');
  assert.equal(disk.values.has('minBitrate'), false);
});

test('bitrate override parsing requires a complete valid range or empty input', () => {
  assert.equal(parseBitrateOverride('', ''), null);
  assert.equal(parseBitrateOverride('  ', ' '), null);
  assert.deepEqual(parseBitrateOverride('2000', '4000'), { minimum: 2000, maximum: 4000 });
  assert.deepEqual(parseBitrateOverride(' 0 ', ' 4000 '), { minimum: 0, maximum: 4000 });
  assert.equal(parseBitrateOverride('2000', ''), 'invalid');
  assert.equal(parseBitrateOverride('', '4000'), 'invalid');
  assert.equal(parseBitrateOverride('abc', '4000'), 'invalid');
  assert.equal(parseBitrateOverride('20.5', '4000'), 'invalid');
  assert.equal(parseBitrateOverride('4000', '2000'), 'invalid');
  assert.equal(parseBitrateOverride('0', '0'), 'invalid');
});


test('hydration preserves the explicit service environment when a legacy model disagrees', async () => {
  const disk = storage({ model: 'x2.1.1-preview-us', environment: 'china', china: 'cn', global: 'us' });
  const store = new ConfigurationStore(disk);
  await store.load();
  assert.equal(store.getSnapshot().endpoint, 'china');
  assert.equal(store.getSnapshot().keys.global, 'us');
});
