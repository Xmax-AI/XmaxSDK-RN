const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate: nextTurn } = require('node:timers/promises');
const { XmaxRealtimeConnectionManager } = require('../lib/commonjs/Core/Realtime/XmaxRealtimeConnectionManager');
const { RealtimeSessionService } = require('../lib/commonjs/Service/Realtime/RealtimeSessionService');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(t, options = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const requests = [], failures = [];
  let time = 100, sequence = 0;
  const api = { async request(method, path, body, signal) {
    requests.push({ method, path, body, signal });
    if (method === 'POST') {
      await options.create?.();
      return { sessionUid: `session-${++sequence}`, modelExtra: {
        room_id: 'room', room_token: 'token', user_id: 'user', bot_name: 'bot',
      } };
    }
    if (method === 'PUT') {
      if (options.heartbeat) return options.heartbeat(requests.at(-1));
      return { sessionUid: path.split('/')[2], status: 'ACTIVE' };
    }
    return {};
  } };
  const service = new RealtimeSessionService(api);
  const manager = new XmaxRealtimeConnectionManager(service,
    { async join() { await options.join?.(); }, async leave() {} },
    { create: () => ({ id: 'remote' }), invalidate() {} }, undefined, () => time);
  t.after(() => manager.disconnect());
  return {
    manager, service, requests, failures,
    setTime(value) { time = value; },
    beats: () => requests.filter(request => request.method === 'PUT'),
    connect: (signal = new AbortController().signal) => manager.connect(
      'x2.1', { width: 1080, height: 1920, fps: 30 }, false, signal, error => failures.push(error)),
  };
}

test('no HTTP heartbeat during allocation, RTC join or Connected; first allowance includes all startup time', async t => {
  const creation = deferred(), join = deferred();
  const f = fixture(t, { create: () => creation.promise, join: () => join.promise });
  const connection = f.connect();
  f.setTime(102);
  t.mock.timers.tick(10000);
  await nextTurn();
  assert.equal(f.beats().length, 0);
  creation.resolve();
  await nextTurn();
  f.setTime(104);
  t.mock.timers.tick(10000);
  assert.equal(f.beats().length, 0);
  join.resolve();
  await connection;
  t.mock.timers.tick(10000);
  await nextTurn();
  assert.equal(f.beats().length, 0);
  f.setTime(106.01);
  f.manager.startHeartbeat('wrong-session');
  f.manager.startHeartbeat('session-1');
  await nextTurn();
  assert.equal(f.beats().length, 1);
  assert.deepEqual(f.beats()[0].body, { firstHeartbeatGraceSeconds: 7 });
});

test('later heartbeats have no body; duplicate starts and task changes do not resend the allowance', async t => {
  const f = fixture(t);
  await f.connect();
  f.manager.startHeartbeat('session-1');
  f.manager.startHeartbeat('session-1');
  await nextTurn();
  assert.deepEqual(f.beats()[0].body, { firstHeartbeatGraceSeconds: 0 });
  t.mock.timers.tick(9999);
  await nextTurn();
  assert.equal(f.beats().length, 1);
  t.mock.timers.tick(1);
  await nextTurn();
  assert.equal(f.beats().length, 2);
  assert.equal(f.beats()[1].body, undefined);
  f.manager.startHeartbeat('session-1');
  t.mock.timers.tick(10000);
  await nextTurn();
  assert.equal(f.beats().length, 3);
  assert.equal(f.beats()[2].body, undefined);
});

test('first heartbeat requests do not overlap and the next interval starts after completion', async t => {
  const pending = deferred();
  const f = fixture(t, { heartbeat: () => pending.promise });
  await f.connect();
  f.manager.startHeartbeat('session-1');
  await nextTurn();
  t.mock.timers.tick(30000);
  await nextTurn();
  assert.equal(f.beats().length, 1);
  pending.resolve({ sessionUid: 'session-1', status: 'ACTIVE' });
  await nextTurn();
  t.mock.timers.tick(10000);
  await nextTurn();
  assert.equal(f.beats().length, 2);
  assert.equal(f.beats()[1].body, undefined);
});

test('disconnect cancels a queued first heartbeat before it can be sent', async t => {
  const f = fixture(t);
  await f.connect();
  f.manager.startHeartbeat('session-1');
  await f.manager.disconnect();
  await nextTurn();
  t.mock.timers.tick(30000);
  assert.equal(f.beats().length, 0);
});

test('disconnect aborts an active heartbeat and ignores its late failure after reconnection', async t => {
  const old = deferred();
  const f = fixture(t, { heartbeat: request => request.path.includes('session-1')
    ? old.promise : { sessionUid: 'session-2', status: 'ACTIVE' } });
  await f.connect();
  f.manager.startHeartbeat('session-1');
  await nextTurn();
  const signal = f.beats()[0].signal;
  await f.manager.disconnect();
  assert.equal(signal.aborted, true);
  f.setTime(200);
  await f.connect();
  f.setTime(203.1);
  f.manager.startHeartbeat('session-1');
  f.manager.startHeartbeat('session-2');
  await nextTurn();
  old.reject(new Error('Old session failure'));
  await nextTurn();
  assert.deepEqual(f.failures, []);
  assert.deepEqual(f.beats()[1].body, { firstHeartbeatGraceSeconds: 4 });
  t.mock.timers.tick(10000);
  await nextTurn();
  assert.equal(f.beats().length, 3);
  assert.equal(f.beats()[2].body, undefined);
});

test('heartbeat failure is delivered once and does not restart on later Generating updates', async t => {
  const f = fixture(t, { heartbeat: () => { throw new Error('failure'); } });
  await f.connect();
  f.manager.startHeartbeat('session-1');
  await nextTurn();
  assert.equal(f.failures.length, 1);
  f.manager.startHeartbeat('session-1');
  t.mock.timers.tick(30000);
  await nextTurn();
  assert.equal(f.beats().length, 1);
});

test('failed or cancelled startup sends no HTTP heartbeat', async t => {
  const f = fixture(t);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(f.connect(abort.signal), { code: 'CANCELLED' });
  f.manager.startHeartbeat('session-1');
  t.mock.timers.tick(30000);
  await nextTurn();
  assert.equal(f.beats().length, 0);
  assert(f.requests.some(request => request.method === 'DELETE'));
});

test('session service rejects invalid startup allowances before transport', async t => {
  const f = fixture(t);
  for (const value of [-1, 0.25, NaN, Infinity, '1', Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(f.service.heartbeat('session-1', undefined, value), { code: 'INVALID_CONFIGURATION' });
  }
  assert.equal(f.requests.length, 0);
});
