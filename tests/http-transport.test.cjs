const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { Module } = require('node:module');
const { getEventListeners } = require('node:events');
const babel = require('@babel/core');
const { ApiService } = require('../lib/commonjs/Service/Network/ApiService');
const { XmaxLogger } = require('../lib/commonjs/Foundation/Logging/XmaxLogger');

// Run the installed RN XHR implementation; replace only native networking and DOM event plumbing.
const filename = resolve('node_modules/react-native/Libraries/Network/XMLHttpRequest.js');
const source = babel.transformSync(readFileSync(filename, 'utf8'), {
  filename, babelrc: false, configFile: false,
  presets: [require.resolve('@react-native/babel-preset')],
}).code;

function fixture(t) {
  let nextID = 0;
  const listeners = new Map(), requests = [], aborted = [], instances = [];
  const native = {
    addListener(name, listener) {
      const group = listeners.get(name) ?? new Set();
      listeners.set(name, group);
      group.add(listener);
      return { remove: () => group.delete(listener) };
    },
    sendRequest(method, _name, url, headers, body, responseType, incremental, timeout, callback, credentials) {
      const id = ++nextID;
      requests.push({ id, method, url, headers, body, responseType, incremental, timeout, credentials });
      callback(id);
    },
    abortRequest(id) { aborted.push(id); },
  };
  const handlers = new WeakMap();
  const eventAttributes = {
    getEventHandlerAttribute(target, name) { return handlers.get(target)?.get(name) ?? null; },
    setEventHandlerAttribute(target, name, callback) {
      let group = handlers.get(target);
      if (!group) { group = new Map(); handlers.set(target, group); }
      const old = group.get(name);
      if (old) target.removeEventListener(name, old);
      group.set(name, callback);
      if (callback) target.addEventListener(name, callback);
    },
  };
  const loaded = new Module(filename);
  loaded.require = name => {
    if (name.endsWith('/Event')) return { __esModule: true, default: Event };
    if (name.endsWith('/EventTarget')) return { __esModule: true, default: EventTarget };
    if (name.endsWith('/EventHandlerAttributes')) return eventAttributes;
    if (name.endsWith('/EventTargetInternals')) return { dispatchTrustedEvent: (target, event) => target.dispatchEvent(event) };
    if (name.endsWith('/ProgressEvent')) return { __esModule: true, default: class extends Event {} };
    if (name === '../Blob/BlobManager') return { default: { isAvailable: false } };
    if (name === './RCTNetworking') return { default: native };
    return require(name);
  };
  loaded._compile(source, filename);
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'XMLHttpRequest');
  globalThis.XMLHttpRequest = class extends loaded.exports.default {
    constructor() { super(); instances.push(this); }
  };
  t.after(() => {
    if (saved) Object.defineProperty(globalThis, 'XMLHttpRequest', saved);
    else delete globalThis.XMLHttpRequest;
  });
  t.mock.method(globalThis, 'fetch', () => { throw new Error('The lossy fetch polyfill must not be used'); });
  const emit = (name, ...args) => [...(listeners.get(name) ?? [])].forEach(listener => listener(args));
  const finish = (id, data, status = 200) => {
    emit('didReceiveNetworkResponse', id, status, {});
    emit('didReceiveNetworkData', id, JSON.stringify(data));
    emit('didCompleteNetworkResponse', id, null, false);
  };
  const api = new ApiService('test-key', 'https://example.invalid', {
    platform: 'ios', os_version: '26', sdk_version: '1.0.0', device_model: 'fixture',
  });
  return { api, requests, aborted, instances, emit, finish,
    subscriptions: () => [...listeners.values()].reduce((sum, group) => sum + group.size, 0) };
}

test('installed RN XHR preserves HTTP envelopes, auth headers and request body without using fetch', async t => {
  const f = fixture(t);
  const caller = new AbortController();
  const pending = f.api.request('POST', '/session', { model: 'x2.1' }, caller.signal);
  const request = f.requests[0];
  assert.equal(request.method, 'POST');
  assert.equal(request.headers['x-api-key'], 'test-key');
  assert.equal(request.headers['x-platform'], 'ios');
  assert.equal(request.headers['content-type'], 'application/json');
  assert.equal(request.body, '{"model":"x2.1"}');
  assert.equal(request.responseType, 'text');
  assert.equal(request.incremental, false);
  assert.equal(request.credentials, false);
  f.finish(request.id, { success: true, data: { sessionUid: 'session-1' } });
  assert.deepEqual(await pending, { sessionUid: 'session-1' });
  assert.equal(f.subscriptions(), 0);
  assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
  caller.abort();
  assert.deepEqual(f.aborted, []);
  const denied = f.api.request('GET', '/cos/sts');
  f.finish(f.requests.at(-1).id, { success: false, code: 4011, message: 'Invalid API key' }, 401);
  await assert.rejects(denied, { code: 'API_ERROR', apiCode: 4011, httpStatus: 401, message: 'Invalid API key' });
  assert.equal(f.subscriptions(), 0);
});

for (const [description, timedOut] of [
  ['A server with the specified hostname could not be found.', false],
  ['java.net.UnknownHostException: Unable to resolve host', false],
  ['The certificate for this server is invalid.', false],
  ['The request timed out.', true],
]) {
  test(`installed RN XHR exposes native failure: ${description}`, async t => {
    const f = fixture(t), logs = [];
    XmaxLogger.configure(1, (_level, message) => logs.push(message));
    t.after(() => XmaxLogger.configure(0));
    const pending = f.api.request('GET', '/cos/sts');
    f.emit('didCompleteNetworkResponse', f.requests[0].id, description, timedOut);
    await assert.rejects(pending, { code: 'NETWORK_ERROR', message: `HTTP request failed: ${description}` });
    assert.equal(f.instances[0].response, '', 'RN hides the failure from response but retains responseText');
    assert.equal(f.subscriptions(), 0);
    assert(!logs.join('\n').includes(description));
  });
}

for (const cause of ['caller', 'timeout']) {
  test(`installed RN XHR ${cause} abort reaches the native request and releases subscriptions`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = fixture(t), caller = new AbortController();
    const pending = f.api.request('POST', '/session', {}, caller.signal);
    const rejected = assert.rejects(pending, { code: cause === 'caller' ? 'CANCELLED' : 'NETWORK_ERROR' });
    if (cause === 'caller') caller.abort();
    else t.mock.timers.tick(15000);
    await rejected;
    assert.deepEqual(f.aborted, [f.requests[0].id]);
    assert.equal(f.subscriptions(), 0);
    assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
    // A native completion delivered after abort cannot settle or contaminate a new request.
    const replacement = f.api.request('GET', '/cos/sts');
    f.finish(f.requests[0].id, { success: true, data: { stale: true } });
    f.finish(f.requests[1].id, { success: true, data: { current: true } });
    assert.deepEqual(await replacement, { current: true });
    assert.equal(f.subscriptions(), 0);
  });
}
