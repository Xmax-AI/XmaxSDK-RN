const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate: tick } = require('node:timers/promises');
const { RoomCommandController } = require('../lib/commonjs/Stream/Room/RoomCommandController');
const { RoomMessageDecoder } = require('../lib/commonjs/Stream/Room/RoomMessageDecoder');
const { RoomController } = require('../lib/commonjs/Stream/Room/RoomController');
const { RtcMessageQueue, encodeRoomMessage } = require('../lib/commonjs/Foundation/RTC/RtcMessageQueue');
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(t, auto = true) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let id = 0;
  const attempts = [];
  const commands = new RoomCommandController((message, signal) => {
    const d = deferred(); attempts.push({ message, signal, ...d });
    if (auto) d.resolve();
    return d.promise;
  }, () => `xid-${++id}`);
  t.after(() => commands.close());
  const send = (kind = 'start', task = 'task', prompt = 'original', signal) => commands.send(
    kind, task, xid => JSON.stringify({ event: kind, uid: task, xid, params: { prompt } }), undefined, signal);
  return { commands, attempts, send };
}
for (const kind of ['start', 'change_condition', 'change_target_size']) {
  test(`${kind}: six attempts retain identical xid and payload at native schedule offsets`, async t => {
    const f = fixture(t);
    await f.send(kind);
    for (const delay of [300, 700, 2000, 300, 700]) {
      const count = f.attempts.length;
      t.mock.timers.tick(delay - 1); await tick();
      assert.equal(f.attempts.length, count);
      t.mock.timers.tick(1); await tick();
      assert.equal(f.attempts.length, count + 1);
    }
    assert.equal(new Set(f.attempts.map(a => a.message)).size, 1);
    t.mock.timers.tick(10000); await tick();
    assert.equal(f.attempts.length, 6);
  });
}
test('valid ack stops retries; malformed, unknown and nonpositive counts do not', async t => {
  const f = fixture(t); await f.send();
  for (const count of [0, -1, 1.1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, '1', true]) f.commands.acknowledge('xid-1', count);
  f.commands.acknowledge('unrelated', 1);
  t.mock.timers.tick(300); await tick(); assert.equal(f.attempts.length, 2);
  f.commands.acknowledge('xid-1', 2);
  t.mock.timers.tick(10000); await tick(); assert.equal(f.attempts.length, 2);
});
for (const boundary of ['ack', 'deadline']) {
  test(`${boundary} cancels redundant attempts but preserves unresolved original send`, async t => {
    const f = fixture(t, false); let complete = false;
    const sent = f.send().then(() => { complete = true; }); await tick();
    t.mock.timers.tick(300); await tick();
    if (boundary === 'ack') f.commands.acknowledge('xid-1', 1);
    t.mock.timers.tick(6000); await tick();
    assert.equal(complete, false); assert.equal(f.attempts[0].signal.aborted, false);
    assert(f.attempts.slice(1).every(a => a.signal.aborted));
    f.attempts[0].resolve(); await sent;
    assert.equal(complete, true);
  });
}
test('retry success can complete original wait; a late original failure cannot fail it', async t => {
  const f = fixture(t, false); const sent = f.send(); await tick();
  t.mock.timers.tick(300); await tick(); f.attempts[1].resolve(); await sent;
  f.attempts[0].reject(new Error('late failure')); await tick();
  t.mock.timers.tick(700); await tick(); assert.equal(f.attempts.length, 3);
});
test('initial send failure cancels retries and dependent queued updates', async t => {
  const f = fixture(t, false); const initial = f.send(); await tick();
  const failed = assert.rejects(initial, /transport/);
  const update = assert.rejects(f.send('change_condition'), { code: 'CANCELLED' });
  f.attempts[0].reject(new Error('transport'));
  await Promise.all([failed, update]);
  t.mock.timers.tick(10000); await tick(); assert.equal(f.attempts.length, 1);
});
test('replacing queued conditions preserves the earlier start ordering barrier', async t => {
  const f = fixture(t, false); const initial = f.send(); await tick();
  const old = assert.rejects(f.send('change_condition', 'task', 'old'), { code: 'CANCELLED' });
  const latest = f.send('change_condition', 'task', 'latest');
  await old; await tick(); assert.equal(f.attempts.length, 1);
  // Receipts cannot acknowledge a command whose first send has not begun.
  f.commands.acknowledge('xid-3', 1);
  f.attempts[0].resolve(); await initial; await tick();
  assert.equal(JSON.parse(f.attempts[1].message).params.prompt, 'latest');
  f.attempts[1].resolve(); await latest;
  f.commands.acknowledge('xid-1', 1);
  t.mock.timers.tick(300); await tick(); assert.equal(f.attempts.length, 3);
});
test('a new start replaces all prior task commands; old receipts cannot stop it', async t => {
  const f = fixture(t); await f.send(); await f.send('change_target_size');
  await f.send('start', 'new-task'); f.commands.acknowledge('xid-1', 1);
  t.mock.timers.tick(300); await tick();
  assert.equal(f.attempts.length, 4);
  assert.equal(JSON.parse(f.attempts.at(-1).message).uid, 'new-task');
  f.commands.cancel('new-task'); t.mock.timers.tick(10000); await tick();
  assert.equal(f.attempts.length, 4);
});
test('caller cancellation rejects promptly and aborts unsent attempts; closed rooms reject new commands', async t => {
  const f = fixture(t, false); const abort = new AbortController();
  const rejected = assert.rejects(f.send('start', 'task', '', abort.signal), { code: 'CANCELLED' });
  await tick(); abort.abort(); await rejected;
  assert(f.attempts[0].signal.aborted);
  f.commands.close(); assert.throws(() => f.send(), { code: 'CANCELLED' });
  t.mock.timers.tick(10000); await tick(); assert.equal(f.attempts.length, 1);
});
test('queued retry failures do not fail a previously successful send', async t => {
  const f = fixture(t, false); const initial = f.send(); await tick();
  f.attempts[0].resolve(); await initial;
  t.mock.timers.tick(300); await tick(); f.attempts[1].reject(new Error('retry')); await tick();
  t.mock.timers.tick(700); await tick(); assert.equal(f.attempts.length, 3);
});
test('cancelling one transport interrupts remaining fragments without dropping unrelated messages', async () => {
  let release; let id = 0; const packets = [];
  const queue = new RtcMessageQueue(async packet => {
    packets.push(packet);
    if (packets.length === 1) await new Promise(resolve => { release = resolve; });
  }, () => `packet-${++id}`);
  const abort = new AbortController();
  const failed = assert.rejects(queue.enqueue('x'.repeat(2000), undefined, abort.signal), { code: 'CANCELLED' });
  await tick(); const unrelated = queue.enqueue('keep'); abort.abort(); await failed; release(); await unrelated;
  assert.equal(packets.length, 2); assert.equal(packets[1], 'keep'); queue.close();
});

test('decoder accepts plain and out-of-order fragments, isolates senders, and resets on leave', () => {
  const decoder = new RoomMessageDecoder();
  const message = { event: 'xid_ack', xid: 'x', count: 1, user_id: 'local', extra: '中'.repeat(900) };
  const pieces = encodeRoomMessage(JSON.stringify(message), 'event');
  assert.equal(decoder.decode('bot', '{'), null);
  assert.equal(decoder.decode('bot', '[]'), null);
  assert.deepEqual(decoder.decode('bot', JSON.stringify({ event: 'xid_ack', xid: 'x', count: 1 })), { event: 'xid_ack', xid: 'x', count: 1 });
  decoder.decode('other', pieces[0]);
  for (const piece of pieces.slice(1).reverse()) assert.equal(decoder.decode('bot', piece), null);
  assert.deepEqual(decoder.decode('bot', pieces[0]), message);
  decoder.reset();
  assert.equal(decoder.decode('other', pieces.at(-1)), null);
});
test('decoder bounds fragment counts, per-message size, and retained records', () => {
  const decoder = new RoomMessageDecoder();
  const packet = (eventId, index, count, data) => JSON.stringify({ event: '__agora_chunk__', eventId, index, count, data });
  for (const [i, n] of [[-1, 2], [2, 2], [0, 513], [0, 0], [0.1, 2]]) assert.equal(decoder.decode('bot', packet('e', i, n, 'x')), null);
  assert.equal(decoder.decode('bot', 'x'.repeat(262145)), null);
  decoder.decode('bot', packet('large', 0, 2, 'x'.repeat(140000)));
  assert.equal(decoder.decode('bot', packet('large', 1, 2, 'x'.repeat(140000))), null);
  assert.equal(decoder.records.size, 0);
  for (let i = 0; i < 1001; i++) decoder.decode('bot', packet(String(i), 0, 2, '{'));
  assert.equal(decoder.records.size, 1000);
  assert.equal(decoder.decode('bot', packet('0', 1, 2, '}')), null, 'Oldest partial message was evicted');
});

async function roomFixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const messages = []; let listener, id = 0;
  const rtc = { runtime: { platform: 'ios' }, randomUUID: () => `room-${++id}`, join: async () => {}, leave: async () => {},
    send: async message => { messages.push(message); }, discardPendingMessages() {},
    onEvent(fn) { listener = fn; return () => { listener = null; }; } };
  const room = new RoomController(rtc);
  const connection = { roomID: 'room', userID: 'local', botName: 'bot' };
  await room.join(connection, false, new AbortController().signal); t.after(() => room.leave());
  const ack = (body, userID = 'bot', roomID = 'room') => listener?.({ type: 'message', stream: { roomID, userID }, message: typeof body === 'string' ? body : JSON.stringify(body) });
  return { room, messages, ack, rtc, connection };
}
test('room accepts only expected sender, room, recipient, event, xid and positive safe count', async t => {
  const f = await roomFixture(t); await f.room.send('start', 'task');
  const xid = JSON.parse(f.messages[0]).xid;
  const valid = { event: 'xid_ack', xid, count: 1 };
  f.ack(valid, 'other'); f.ack(valid, 'local'); f.ack(valid, 'bot', 'stale');
  f.ack({ ...valid, user_id: 'other' }); f.ack({ ...valid, event: 'ack' }); f.ack({ ...valid, count: '1' }); f.ack({ ...valid, count: true });
  t.mock.timers.tick(300); await tick(); assert.equal(f.messages.length, 2);
  const chunks = encodeRoomMessage(JSON.stringify({ ...valid, user_id: 'local', padding: 'x'.repeat(1000) }), 'ack');
  chunks.reverse().forEach(piece => f.ack(piece));
  t.mock.timers.tick(6000); await tick(); assert.equal(f.messages.length, 2);
});
test('stop and leave cancel pending retries, and rejoin ignores prior receipts', async t => {
  const f = await roomFixture(t); await f.room.send('start', 'task'); const old = JSON.parse(f.messages[0]).xid;
  await f.room.send('stop', 'task'); t.mock.timers.tick(6000); await tick(); assert.equal(f.messages.length, 2);
  assert.equal('xid' in JSON.parse(f.messages[1]), false);
  await f.room.leave(); await f.room.join(f.connection, false, new AbortController().signal);
  await f.room.send('start', 'new'); f.ack({ event: 'xid_ack', xid: old, count: 1 });
  t.mock.timers.tick(300); await tick(); assert.equal(f.messages.length, 4);
  await f.room.leave(); t.mock.timers.tick(6000); await tick(); assert.equal(f.messages.length, 4);
});

test('serialization is frozen before queueing and retries cannot observe caller mutations', async t => {
  const f = await roomFixture(t);
  const format = { width: 736, height: 1280, fps: 24 };
  const context = { prompt: 'original' };
  const send = f.room.send('start', 'task', format, context);
  context.prompt = 'mutated'; format.width = 999;
  await send;
  t.mock.timers.tick(300); await tick();
  assert.equal(f.messages[0], f.messages[1]);
  assert.equal(JSON.parse(f.messages[1]).params.prompt, 'original');
  assert.equal(JSON.parse(f.messages[1]).params.size[0], 736);
});
test('room errors terminate pending retries without reusing the invalidated scheduler', async t => {
  const f = await roomFixture(t); await f.room.send('start', 'task');
  // The callback captures the same room lifetime as its command scheduler.
  const callbacks = []; const original = f.rtc.onEvent;
  await f.room.leave();
  f.rtc.onEvent = fn => { callbacks.push(fn); return original(fn); };
  await f.room.join(f.connection, false, new AbortController().signal);
  await f.room.send('start', 'new');
  callbacks[0]({ type: 'error', error: new Error('connection lost') });
  t.mock.timers.tick(6000); await tick(); assert.equal(f.messages.length, 2);
  assert.throws(() => f.room.send('change_condition', 'new'), { code: 'CANCELLED' });
});
test('cancelling generation precedes an asynchronous audio cleanup', async t => {
  const { StreamController } = require('../lib/commonjs/Stream/StreamController');
  const f = await roomFixture(t);
  await f.room.send('start', 'task');
  const audio = deferred();
  const stream = new StreamController({ setRemoteAudioSubscription: () => audio.promise }, f.room, {}, {});
  stream.audioStream = { roomID: 'room', userID: 'bot' };
  const stopping = stream.stopGeneration('task');
  t.mock.timers.tick(6000); await tick(); assert.equal(f.messages.length, 1);
  audio.resolve(); await stopping;
  assert.equal(JSON.parse(f.messages[1]).event, 'stop');
});

test('an empty transport rejection remains a failed send rather than a successful submission', async t => {
  const f = fixture(t, false); const sending = f.send(); const failed = assert.rejects(sending);
  await tick(); f.attempts[0].reject(); await failed;
  t.mock.timers.tick(10000); await tick(); assert.equal(f.attempts.length, 1);
});
