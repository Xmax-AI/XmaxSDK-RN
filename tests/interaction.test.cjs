const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mapInteractionPoint, displayedFrame } = require('../lib/commonjs/Media/Interaction/InteractionCoordinateMapper');
const { InteractionController } = require('../lib/commonjs/Media/Interaction/InteractionController');
const { TrajectorySampler } = require('../lib/commonjs/Render/Trajectory/TrajectorySampler');
const { tracksEvent } = require('../lib/commonjs/Stream/Room/RoomEvent');
const { XmaxRealtimeGenerationManager } = require('../lib/commonjs/Core/Realtime/XmaxRealtimeGenerationManager');
const tick = () => new Promise(resolve => setImmediate(resolve));
const size = { width: 100, height: 100 };
const format = { ...size, fps: 24 };
const frame = (x, y = 50) => ({ points: [{ x, y }], viewportSize: size, contentMode: 'fit' });

// Coordinates taken from the iOS centered fit/fill mapping, including cropped and black-bar regions.
test('maps fit/fill, portrait/landscape and mirrored published pixels without a second transform', () => {
  assert.deepEqual(displayedFrame(size, { width: 200, height: 100 }, 'fit'), { x: 0, y: 25, width: 100, height: 50 });
  assert.equal(mapInteractionPoint({ x: 50, y: 20 }, size, { width: 200, height: 100 }, 'fit'), null);
  assert.deepEqual(mapInteractionPoint({ x: 100, y: 75 }, size, { width: 200, height: 100 }, 'fit'), { x: 1, y: 1 });
  assert.deepEqual(mapInteractionPoint({ x: 0, y: 50 }, size, { width: 200, height: 100 }, 'fill'), { x: 0.25, y: 0.5 });
  assert.deepEqual(mapInteractionPoint({ x: 50, y: 0 }, size, { width: 100, height: 200 }, 'fill'), { x: 0.5, y: 0.25 });
  assert.deepEqual(mapInteractionPoint({ x: 20, y: 40 }, size, size, 'fit'), { x: 0.2, y: 0.4 });
  for (const bad of [NaN, Infinity, -Infinity]) assert.equal(mapInteractionPoint({ x: bad, y: 1 }, size, size, 'fit'), null);
  assert.equal(displayedFrame({ width: 0, height: 100 }, size, 'fill'), null);
});

test('tracks payload matches iOS and has no runtime or OS suffix', () => {
  assert.deepEqual(JSON.parse(tracksEvent('user', 'task-123', [{ x: 0.2, y: 0.3 }, { x: 0.99, y: 0 }])), {
    event: 'tracks', tracks: [[0.2, 0.3], [0.99, 0]], user_id: 'user', uid: 'task-123', session_uid: 'task-123',
  });
});

test('interaction coalesces slow delivery and discards old tasks and cancelled view samples', async () => {
  const sends = [];
  let release;
  const controller = new InteractionController((task, points) => {
    sends.push({ task, points });
    if (sends.length === 1) return new Promise(resolve => { release = resolve; });
  });
  controller.startInteraction('a', format);
  let generation = controller.generation;
  controller.submitInteraction(frame(1), generation);
  await tick();
  controller.submitInteraction(frame(2), generation);
  controller.submitInteraction(frame(3), generation);
  release();
  await tick();
  assert.deepEqual(sends.map(send => send.points[0].x), [0.01, 0.03]);
  controller.submitInteraction(frame(4), generation);
  controller.stopInteraction();
  controller.startInteraction('b', format);
  controller.submitInteraction(frame(5), generation);
  generation = controller.generation;
  controller.submitInteraction({ ...frame(6), isCurrent: () => false }, generation);
  await tick();
  assert.equal(sends.length, 2);
  controller.submitInteraction(frame(7), generation);
  await tick();
  assert.deepEqual(sends.at(-1), { task: 'b', points: [{ x: 0.07, y: 0.5 }] });
});

test('failed sample is dropped without disabling the active task', async () => {
  let attempts = 0;
  const controller = new InteractionController(() => { if (++attempts === 1) throw Error('delivery'); });
  controller.startInteraction('a', format);
  controller.submitInteraction(frame(1), controller.generation);
  await tick();
  controller.submitInteraction(frame(2), controller.generation);
  await tick();
  assert.equal(attempts, 2);
  assert.equal(controller.isActive, true);
});

test('sampling tracks stable multi-touch IDs at 30 Hz, clamps drags and cleans up cancellation', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const samples = [], began = [], moved = [], ended = [];
  let resets = 0;
  const renderer = {
    renderBegan: points => began.push(...points), renderMoved: points => moved.push(...points),
    renderEnded: ids => ended.push(...ids), reset: () => resets++,
  };
  const sampler = new TrajectorySampler(size, { width: 200, height: 100 }, 'fit', renderer, sample => samples.push(sample));
  const touch = (identifier, x, y) => ({ identifier, x, y });
  try {
    sampler.begin([touch('bar', 50, 0)]);
    assert.equal(began.length, 0);
    sampler.begin([touch('1', 10, 30), touch('2', 90, 70)]);
    assert.equal(new Set(began.map(point => point.id)).size, 2);
    assert.deepEqual(began[0].normalizedLocation, { x: 0.1, y: 0.1 });
    assert.equal(samples.length, 1);
    t.mock.timers.tick(32);
    assert.equal(samples.length, 1);
    t.mock.timers.tick(2);
    assert.equal(samples.length, 2);
    sampler.move([touch('1', -40, 200)]);
    assert.equal(moved[0].id, began[0].id);
    assert.deepEqual(moved[0].location, { x: 0, y: 75 });
    sampler.end(['1']);
    t.mock.timers.tick(34);
    assert.equal(samples.at(-1).points.length, 1);
    sampler.cancel();
    assert.equal(samples.at(-1).isCurrent(), false);
    const count = samples.length;
    t.mock.timers.tick(1000);
    assert.equal(samples.length, count);
    sampler.begin([touch('3', 20, 50)]);
    assert.equal(samples.length, count + 1);
    assert.notEqual(began.at(-1).id, began[0].id);
  } finally { sampler.dispose(); }
  assert.equal(resets, 2);
  assert.equal(ended.length, 3);
  assert.equal(sampler.contains({ x: 50, y: 50 }), false);
});

test('custom renderer failures do not change sampling or prevent timer cleanup', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let samples = 0;
  const fail = () => { throw Error('custom drawing'); };
  const sampler = new TrajectorySampler(size, size, 'fit', { renderBegan: fail, renderMoved: fail, renderEnded: fail, reset: fail }, () => samples++);
  sampler.begin([{ identifier: '1', x: 50, y: 50 }]);
  t.mock.timers.tick(34);
  sampler.dispose();
  t.mock.timers.tick(1000);
  assert.equal(samples, 2);
});

test('generation activates interaction only after result-stream confirmation and stops it before network teardown', async () => {
  let confirm;
  const events = [];
  const interaction = new InteractionController(() => {});
  const generation = new XmaxRealtimeGenerationManager({ runtime: { platform: 'ios' }, randomUUID: () => '00112233-4455-4677-8899-aabbccddeeff' }, {
    beginGeneration: () => new Promise(resolve => { confirm = resolve; }),
    updateGeneration: () => events.push('update'),
    stopGeneration: () => { assert.equal(interaction.isActive, false); events.push('stop'); },
  }, interaction);
  const started = generation.start(format, { prompt: 'move' }, new AbortController().signal);
  assert.equal(interaction.isActive, false);
  confirm({ roomID: 'room', userID: 'bot' });
  await started;
  assert.equal(interaction.isActive, true);
  const first = interaction.generation;
  await generation.start(format, { prompt: 'move again' }, new AbortController().signal);
  assert(interaction.generation > first);
  generation.stop();
  assert.equal(interaction.isActive, false);
  assert.deepEqual(events, ['update', 'stop']);
});

test('touch coordinates use the overlay page origin, including navigation/safe-area offsets and density-independent sizes', () => {
  const { trajectoryTouchPoint } = require('../lib/commonjs/Render/Trajectory/TrajectoryTouchCoordinates');
  const viewport = { width: 320, height: 480 };
  for (const rect of [
    { x: 0, y: 0, width: 320, height: 480 },
    { x: 24, y: 180, width: 320, height: 480 },
    { x: 45, y: 96, width: 640, height: 960 },
  ]) {
    const touch = { pageX: rect.x + rect.width * 0.25, pageY: rect.y + rect.height * 0.75, locationX: 999, locationY: 999 };
    assert.deepEqual(trajectoryTouchPoint(touch, rect, viewport), { x: 80, y: 360 });
  }
  const rect = { x: 24, y: 180, width: 320, height: 480 };
  assert.deepEqual(trajectoryTouchPoint({ pageX: 14, pageY: 170 }, rect, viewport), { x: -10, y: -10 }, 'Clamping remains the sampler responsibility');
  assert.equal(trajectoryTouchPoint({ pageX: 10, pageY: 10 }, { ...rect, width: 0 }, viewport), null);
  assert.equal(trajectoryTouchPoint({ pageX: NaN, pageY: 10 }, rect, viewport), null);
});
