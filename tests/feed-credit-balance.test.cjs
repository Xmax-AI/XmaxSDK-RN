const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { Module } = require('node:module');
const ts = require('typescript');
const { setImmediate: tick } = require('node:timers/promises');

function load(path, mocks = {}) {
  const filename = resolve(__dirname, '../Example/XLab/src', path);
  const compiled = new Module(filename);
  compiled.require = name => {
    if (name in mocks) return mocks[name];
    throw new Error(`Unexpected dependency: ${name}`);
  };
  compiled._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, filename);
  return compiled.exports;
}
const balanceModule = load('feed/FeedCreditBalance.ts', { '@xmaxai/react-native-sdk': {} });
const { FeedCreditBalancePoller, formatFeedCreditBalance } = balanceModule;
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const requests = [], changes = [];
  const poller = new FeedCreditBalancePoller((key, environment) => signal => {
    const result = deferred();
    requests.push({ key, environment, signal, ...result });
    return result.promise;
  });
  const unsubscribe = poller.subscribe(() => changes.push(poller.getSnapshot()));
  t.after(() => { poller.pause(); unsubscribe(); });
  return { poller, requests, changes, snapshot: poller.getSnapshot };
}

test('empty credentials and hidden homepage never request; key editing is debounced for 250ms', async t => {
  const f = fixture(t);
  f.poller.update(' ', 'china', true);
  t.mock.timers.tick(5000);
  f.poller.update('key', 'china', false);
  t.mock.timers.tick(5000);
  assert.equal(f.requests.length, 0);
  f.poller.update('k', 'china', true);
  t.mock.timers.tick(249);
  f.poller.update(' key ', 'china', true);
  t.mock.timers.tick(249);
  assert.equal(f.requests.length, 0);
  t.mock.timers.tick(1);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].key, 'key');
  assert.equal(f.snapshot().isLoading, true);
  f.poller.update('key', 'china', true);
  assert.equal(f.requests[0].signal.aborted, false, 'Whitespace-only edits preserve the current request');
});

test('polling waits five seconds after completion and never overlaps slow requests', async t => {
  const f = fixture(t);
  f.poller.update('key', 'global', true);
  t.mock.timers.tick(250);
  t.mock.timers.tick(30000);
  assert.equal(f.requests.length, 1);
  f.requests[0].resolve(1250.75);
  await tick();
  assert.deepEqual(f.snapshot(), { balance: 1250.75, isLoading: false, refreshFailed: false });
  t.mock.timers.tick(4999);
  assert.equal(f.requests.length, 1);
  t.mock.timers.tick(1);
  assert.equal(f.requests.length, 2);
  assert.equal(f.snapshot().balance, 1250.75);
  f.requests[1].resolve(0);
  await tick();
  assert.equal(f.snapshot().balance, 0);
});

test('refresh failure keeps the last balance and retries on the normal interval', async t => {
  const f = fixture(t);
  f.poller.update('key', 'china', true);
  t.mock.timers.tick(250);
  f.requests[0].resolve(7.25);
  await tick();
  t.mock.timers.tick(5000);
  f.requests[1].reject(new Error('offline'));
  await tick();
  assert.deepEqual(f.snapshot(), { balance: 7.25, isLoading: false, refreshFailed: true });
  t.mock.timers.tick(5000);
  f.requests[2].resolve(2);
  await tick();
  assert.deepEqual(f.snapshot(), { balance: 2, isLoading: false, refreshFailed: false });
});

test('initial failure remains unavailable rather than reporting zero', async t => {
  const f = fixture(t);
  f.poller.update('key', 'china', true);
  t.mock.timers.tick(250);
  f.requests[0].reject(new Error('invalid key'));
  await tick();
  assert.deepEqual(f.snapshot(), { balance: null, isLoading: false, refreshFailed: true });
});

for (const change of ['key', 'environment']) {
  test(`${change} changes clear old credits, cancel transport and reject stale results`, async t => {
    const f = fixture(t);
    f.poller.update('old', 'china', true);
    t.mock.timers.tick(250);
    f.requests[0].resolve(999);
    await tick();
    t.mock.timers.tick(5000);
    f.poller.update(change === 'key' ? 'new' : 'old', change === 'environment' ? 'global' : 'china', true);
    assert.equal(f.snapshot().balance, null);
    assert.equal(f.requests[1].signal.aborted, true);
    t.mock.timers.tick(250);
    f.requests[2].resolve(42.5);
    await tick();
    f.requests[1].resolve(888);
    await tick();
    assert.equal(f.snapshot().balance, 42.5);
    f.poller.update('', 'global', true);
    assert.deepEqual(f.snapshot(), { balance: null, isLoading: false, refreshFailed: false });
  });
}

test('pausing cancels requests and timers, preserves balance, and resuming refreshes after 250ms', async t => {
  const f = fixture(t);
  f.poller.update('key', 'china', true);
  t.mock.timers.tick(250);
  f.requests[0].resolve(5);
  await tick();
  t.mock.timers.tick(5000);
  f.poller.update('key', 'china', false);
  assert.equal(f.requests[1].signal.aborted, true);
  assert.deepEqual(f.snapshot(), { balance: 5, isLoading: false, refreshFailed: false });
  f.requests[1].reject(new Error('late error'));
  await tick();
  t.mock.timers.tick(10000);
  assert.equal(f.requests.length, 2);
  f.poller.update('key', 'china', true);
  t.mock.timers.tick(250);
  assert.equal(f.requests.length, 3);
});

test('balance formatting preserves fractions, zero and grouped digits', () => {
  assert.equal(formatFeedCreditBalance(null), '—');
  assert.equal(formatFeedCreditBalance(0), '0');
  assert.equal(formatFeedCreditBalance(1250.75), '1,250.75');
  assert.equal(formatFeedCreditBalance(0.1234567), '0.123457');
});

// Exercise hook lifecycle wiring with real polling logic and native/navigation event boundaries.
function hookFixture(t, platform) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const requests = [], appEvents = new Map(), navEvents = new Map();
  const add = (map, name, listener) => {
    const list = map.get(name) ?? new Set(); map.set(name, list); list.add(listener);
    return () => list.delete(listener);
  };
  const emit = (map, name, value) => { for (const listener of map.get(name) ?? []) listener(value); };
  const AppState = { currentState: 'active', addEventListener: (name, cb) => ({ remove: add(appEvents, name, cb) }) };
  let focused = true;
  const navigation = { isFocused: () => focused, addListener: (name, cb) => add(navEvents, name, cb) };
  const sdk = { XmaxClient: class {
    constructor(config) { this.config = config; }
    getCreditBalance({ signal }) {
      const result = deferred(); requests.push({ ...result, signal, config: this.config }); return result.promise;
    }
  } };
  const actual = load('feed/FeedCreditBalance.ts', { '@xmaxai/react-native-sdk': sdk });
  let instance, deps, cleanup, effect, snapshot;
  const react = {
    useState: create => [instance ??= create()],
    useSyncExternalStore: (_subscribe, getSnapshot) => { snapshot = getSnapshot; return getSnapshot(); },
    useLayoutEffect: (next, nextDeps) => {
      if (!deps || nextDeps.some((value, i) => value !== deps[i])) { deps = nextDeps; effect = next; }
    },
  };
  const { useFeedCreditBalance } = load('feed/useFeedCreditBalance.ts', {
    react, 'react-native': { AppState, Platform: { OS: platform } },
    '@react-navigation/native': { useNavigation: () => navigation }, './FeedCreditBalance': actual,
  });
  const render = (key = 'key', env = 'china') => {
    useFeedCreditBalance(key, env);
    if (effect) { cleanup?.(); cleanup = effect(); effect = null; }
  };
  t.after(() => cleanup?.());
  return {
    requests, render, snapshot: () => snapshot(),
    focus(value) { focused = value; emit(navEvents, value ? 'focus' : 'blur'); },
    app(value) { AppState.currentState = value; emit(appEvents, 'change', value); },
    window: value => emit(appEvents, value ? 'focus' : 'blur'),
    dispose() { cleanup?.(); cleanup = null; },
    listeners: () => [...appEvents.values(), ...navEvents.values()].reduce((n, set) => n + set.size, 0),
  };
}

for (const platform of ['ios', 'android']) {
  test(`${platform} homepage visibility, app state, account updates and unmount own polling`, async t => {
    const f = hookFixture(t, platform);
    f.render();
    t.mock.timers.tick(250);
    assert.deepEqual(f.requests[0].config, { apiKey: 'key', environment: 'china' });
    f.requests[0].resolve({ currentBalance: 20 });
    await tick();
    f.focus(false);
    t.mock.timers.tick(10000);
    assert.equal(f.requests.length, 1);
    f.focus(true);
    t.mock.timers.tick(250);
    assert.equal(f.requests.length, 2);
    f.app('inactive');
    assert.equal(f.requests[1].signal.aborted, true);
    f.app('background');
    t.mock.timers.tick(10000);
    assert.equal(f.requests.length, 2);
    f.app('active');
    t.mock.timers.tick(250);
    assert.equal(f.requests.length, 3);
    f.render('other-key', 'global');
    assert.equal(f.requests[2].signal.aborted, true);
    assert.equal(f.snapshot().balance, null);
    t.mock.timers.tick(250);
    assert.deepEqual(f.requests[3].config, { apiKey: 'other-key', environment: 'global' });
    if (platform === 'android') {
      f.window(false);
      assert.equal(f.requests[3].signal.aborted, true);
      t.mock.timers.tick(10000);
      assert.equal(f.requests.length, 4);
      f.window(true);
      t.mock.timers.tick(250);
      assert.equal(f.requests.length, 5);
    }
    f.dispose();
    assert.equal(f.requests.at(-1).signal.aborted, true);
    assert.equal(f.listeners(), 0);
    const count = f.requests.length;
    t.mock.timers.tick(10000);
    assert.equal(f.requests.length, count);
  });
}

test('credit pill displays loading, retained balance, failure, and localized accessibility text', () => {
  const messages = load('localization/messages.ts');
  let locale = 'en';
  const catalog = load('localization/Localization.ts', { './messages': messages });
  const jsx = (type, props) => ({ type, props });
  const { FeedCreditBalancePill } = load('components/FeedCreditBalancePill.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { ActivityIndicator: 'Spinner', Text: 'Text', View: 'View', StyleSheet: { create: value => value } },
    '../feed/FeedCreditBalance': balanceModule,
    '../localization/LocalizationProvider': { useLocalization: () => ({ t: key => catalog.translate(locale, key) }) },
    '../theme/tokens': { colors: { accent: 'mint', secondary: 'gray', storage: 'orange' }, feedFont: value => value },
  });
  for (locale of ['en', 'zh-Hans']) {
    const render = (balance, isLoading = false, refreshFailed = false) => FeedCreditBalancePill({ state: { balance, isLoading, refreshFailed } });
    assert.equal(render(null).props.testID, 'feed.creditBalance');
    assert.equal(render(null).props.accessibilityValue.text, '—');
    assert.equal(render(null, true).props.accessibilityValue.text, catalog.translate(locale, 'feed.credits.loading'));
    assert.equal(render(null, true).props.accessibilityState.busy, true);
    assert.equal(render(1250.75, true).props.accessibilityValue.text, '1,250.75');
    const failed = render(1250.75, false, true);
    assert.equal(failed.props.accessibilityValue.text, '1,250.75');
    assert.equal(failed.props.children[1].props.style[1].color, 'orange');
    assert.equal(failed.props.accessibilityHint, catalog.translate(locale, 'feed.credits.refreshFailed'));
    assert.equal(render(null, false, true).props.accessibilityValue.text, catalog.translate(locale, 'feed.credits.unavailable'));
    assert.equal(render(0).props.accessibilityValue.text, '0');
  }
});
