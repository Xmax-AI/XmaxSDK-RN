const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate: tick } = require('node:timers/promises');
const { XmaxRealtimeLifecycleManager } = require('../lib/commonjs/Core/Realtime/XmaxRealtimeLifecycleManager');
const { waitFor } = require('../lib/commonjs/Foundation/Runtime/Async');

function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}
function fixture(cleaning) {
  const cleanups = [], states = [];
  const lifecycle = new XmaxRealtimeLifecycleManager(async scope => { cleanups.push(scope); await cleaning?.(scope); }, () => true);
  lifecycle.setStateListener(state => states.push(state));
  const commit = (token, state, taskID = null) => lifecycle.commit({ connectionState: state, taskID, sessionID: 'session', reason: null }, token);
  return { lifecycle, cleanups, states, commit };
}
const cancelled = promise => assert.rejects(promise, { code: 'CANCELLED' });

for (const state of ['Connecting', 'Connected']) {
  test(`latest generation waits for predecessor cleanup from ${state}`, async () => {
    const cleaning = deferred(), entered = [];
    const f = fixture(() => cleaning.promise);
    const first = f.lifecycle.run('generation', async token => {
      token.setFailureScope('connection');
      f.commit(token, state);
      await waitFor(() => () => {}, token.signal, 10000, 'test generation');
    });
    const firstRejected = cancelled(first);
    await tick();
    const middle = f.lifecycle.run('generation', async () => { entered.push('B'); });
    const middleRejected = cancelled(middle);
    const latest = f.lifecycle.run('generation', async token => { entered.push('C'); f.commit(token, 'Generating', 'latest'); return 'latest-result'; });
    await tick();
    assert.deepEqual(f.cleanups, [state === 'Connected' ? 'generation' : 'connection']);
    assert.deepEqual(entered, []);
    cleaning.resolve();
    assert.equal(await latest, 'latest-result');
    await Promise.all([firstRejected, middleRejected]);
    assert.deepEqual(entered, ['C']);
    assert.equal(f.lifecycle.currentState.taskID, 'latest');
    assert.equal(f.lifecycle.currentState.reason, null);
    if (state === 'Connected') assert(!f.states.some(value => value.connectionState === 'Disconnecting'));
  });
}

for (const scope of ['connection', 'all']) {
  test(`${scope} termination cancels the queued successor and never restarts it`, async () => {
    const cleaning = deferred(), f = fixture(() => cleaning.promise);
    const first = f.lifecycle.run('generation', async token => {
      token.setFailureScope('connection'); f.commit(token, 'Connected');
      await waitFor(() => () => {}, token.signal, 10000, 'test generation');
    });
    const firstRejected = cancelled(first);
    await tick();
    let starts = 0;
    const successor = f.lifecycle.run('generation', async () => { starts++; });
    const successorRejected = cancelled(successor);
    await tick();
    const stopped = scope === 'all' ? f.lifecycle.terminate('all') : f.lifecycle.disconnect();
    cleaning.resolve();
    await Promise.all([firstRejected, successorRejected, stopped]);
    assert.equal(starts, 0);
    assert.equal(f.lifecycle.currentState.connectionState, scope === 'all' ? 'Idle' : 'Ready');
    assert.equal(f.lifecycle.isBusy, false);
  });
}

test('replacing an active condition update retains generation and waits for the old submission', async () => {
  const gate = deferred(), f = fixture(), submitted = [];
  await f.lifecycle.run('connection', async token => f.commit(token, 'Generating', 'stable-task'));
  const first = f.lifecycle.run('generation', async token => { submitted.push('A'); await gate.promise; token.ensureCurrent(); submitted.push('old-commit'); });
  const firstRejected = cancelled(first);
  await tick();
  const latest = f.lifecycle.run('generation', async token => { submitted.push('B'); f.commit(token, 'Generating', 'stable-task'); });
  await tick();
  assert.deepEqual(submitted, ['A']);
  gate.resolve();
  await Promise.all([firstRejected, latest]);
  assert.deepEqual(submitted, ['A', 'B']);
  assert.deepEqual(f.cleanups, []);
  assert.equal(f.lifecycle.currentState.taskID, 'stable-task');
});

test('pre-aborted generation cannot replace the current request; media conflicts still reject', async () => {
  const gate = deferred(), f = fixture();
  const first = f.lifecycle.run('generation', async token => { await gate.promise; token.ensureCurrent(); return 1; });
  await tick();
  const controller = new AbortController(); controller.abort();
  await cancelled(f.lifecycle.run('generation', async () => assert.fail('cancelled request ran'), controller.signal));
  await assert.rejects(f.lifecycle.run('media', async () => assert.fail('conflicting media ran')), { code: 'INVALID_CONFIGURATION' });
  gate.resolve();
  assert.equal(await first, 1);
  assert.deepEqual(f.cleanups, []);
});

test('generation requests conflicting with media preparation reject without cancelling media', async () => {
  const f = fixture(), gate = deferred();
  const media = f.lifecycle.run('media', async token => { await gate.promise; token.ensureCurrent(); return 'stream'; });
  await tick();
  await assert.rejects(f.lifecycle.run('generation', async () => {}), { code: 'INVALID_CONFIGURATION' });
  gate.resolve(); assert.equal(await media, 'stream');
});

test('foreground generation waits for an acknowledged background quality change', async () => {
  const f = fixture(), gate = deferred(), events = [];
  const background = f.lifecycle.runBackground(async token => { events.push('quality-start'); await gate.promise; token.ensureCurrent(); events.push('quality-commit'); });
  await tick();
  const generation = f.lifecycle.run('generation', async () => { events.push('generation'); });
  assert.equal(await f.lifecycle.runBackground(async () => assert.fail('second background update ran')), false);
  await tick();
  assert.deepEqual(events, ['quality-start']);
  gate.resolve();
  assert.equal(await background, true);
  await generation;
  assert.deepEqual(events, ['quality-start', 'quality-commit', 'generation']);
});

for (const kind of ['generation', 'configuration']) {
  test(`close cancels ${kind} waiting behind a background quality update`, async () => {
    const f = fixture(), gate = deferred();
    const background = f.lifecycle.runBackground(async token => { await gate.promise; token.ensureCurrent(); });
    const backgroundRejected = cancelled(background);
    await tick();
    const foreground = f.lifecycle.run(kind, async () => assert.fail('foreground request survived close'));
    const foregroundRejected = cancelled(foreground);
    const close = f.lifecycle.terminate('all');
    gate.resolve();
    await Promise.all([backgroundRejected, foregroundRejected, close]);
    assert.equal(f.lifecycle.currentState.connectionState, 'Idle');
    assert.equal(f.lifecycle.isBusy, false);
  });
}
