const { test } = require('node:test');
const assert = require('node:assert/strict');
const { QualityController } = require('../lib/commonjs/Stream/Quality/QualityController');
const { QualityDirection } = require('../lib/commonjs/Stream/Quality/QualityDirection');
const { qualityFormat } = require('../lib/commonjs/Stream/Quality/QualityVideoFormat');
const { resolveBitrates } = require('../lib/commonjs/Stream/Encoding/EncodingBitratePolicy');
const baseline = { width: 1024, height: 1920, fps: 30 };

test('quality tiers preserve the media baseline while changing transport resolution and cadence', () => {
  const format = qualityFormat(baseline, 2);
  assert.deepEqual(format, { width: 816, height: 1530, fps: 24 });
  assert.equal(qualityFormat(baseline, 5).fps, 16);
  assert.equal(qualityFormat(baseline, 5, true).fps, 24);
  assert.deepEqual(baseline, { width: 1024, height: 1920, fps: 30 });
});

test('three consecutive bad samples downgrade; stale and interrupted samples never accumulate', () => {
  const direction = new QualityDirection(baseline, 2, false);
  assert.equal(direction.propose('Bad', 1, 1), null);
  assert.equal(direction.propose('Bad', 2, 2), null);
  assert.equal(direction.propose('Bad', 3, 3), 3);
  direction.complete(3, true, 3);
  assert.equal(direction.level, 3);
  assert.equal(direction.propose('Good', 4, 4), null);
  assert.equal(direction.propose('Bad', 2, 9), null);
  assert.equal(direction.propose('Bad', 20, 20), null);
});

test('upgrades require five good samples and failed probes impose the 60-second upgrade cooldown', () => {
  const direction = new QualityDirection(baseline, 2, true);
  for (let time = 1; time <= 4; time++) assert.equal(direction.propose('Good', time, time), null);
  assert.equal(direction.propose('Good', 5, 5), 1);
  direction.complete(1, true, 5);
  for (let time = 9; time <= 10; time++) assert.equal(direction.propose('Bad', time, time), null);
  assert.equal(direction.propose('Bad', 11, 11), 2);
  direction.complete(2, true, 11);
  for (let time = 15; time < 71; time++) assert.equal(direction.propose('Good', time, time), null);
  assert.equal(direction.propose('Good', 71, 71), 1);
});

test('failed changes retain their previous level and apply the stability window', () => {
  const direction = new QualityDirection(baseline, 2, false);
  direction.complete(3, false, 1);
  assert.equal(direction.level, 2);
  for (let time = 2; time < 5; time++) assert.equal(direction.propose('Bad', time, time), null);
});

test('per-model history expires after one hour and saves only successfully applied tiers', async () => {
  const values = new Map(), writes = [];
  const quality = new QualityController({
    readPreference: async key => values.get(key) ?? 'null',
    writePreference: async (key, value) => { writes.push(key); values.set(key, value); },
  });
  await quality.prepare(baseline, 'cn');
  assert.equal(quality.uplink.width, 816);
  quality.complete(3, false, false);
  assert.equal(writes.length, 0);
  quality.complete(3, false, true);
  await quality.prepare(baseline, 'cn');
  assert.equal(quality.uplink.fps, 24);
  assert.equal(quality.uplink.width, qualityFormat(baseline, 3).width);
  await quality.prepare(baseline, 'us');
  assert.equal(quality.uplink.width, 816);
  values.set('quality.cn.up', JSON.stringify({ level: 5, time: Date.now() - 3600001 }));
  await quality.prepare(baseline, 'cn');
  assert.equal(quality.uplink.width, 816);
});

test('default encoder limits match the iOS 100 kbps floor and 60 percent maximum budget', () => {
  assert.deepEqual(resolveBitrates(baseline), { minimum: 100, maximum: 3619 });
  assert.deepEqual(resolveBitrates({ ...baseline, minimumBitrate: 0, maximumBitrate: 5000 }), { minimum: 0, maximum: 5000 });
});

test('applied upload encoding uses a 500 kbps floor capped by the maximum and preserves explicit zero', async () => {
  const { EncodingController } = require('../lib/commonjs/Stream/Encoding/EncodingController');
  const applied = [];
  const controller = new EncodingController({ configureEncoding: async (...args) => applied.push(args) });
  await controller.configure(baseline);
  assert.deepEqual(applied.at(-1), [baseline, 500, 3619]);
  const capped = { ...baseline, maximumBitrate: 200 };
  await controller.configure(capped);
  assert.deepEqual(applied.at(-1), [capped, 200, 200]);
  const unlimited = { ...baseline, minimumBitrate: 0 };
  await controller.configure(unlimited);
  assert.equal(applied.at(-1)[1], 0);
  assert.equal(resolveBitrates(baseline).minimum, 100, 'Signal budgets retain their separate policy');
});

test('manual quality selection resets samples without disabling subsequent network adaptation', () => {
  const direction = new QualityDirection(baseline, 2, false);
  direction.propose('Bad', 1, 1);
  direction.propose('Bad', 2, 2);
  direction.complete(1, true, 3);
  assert.equal(direction.level, 1);
  for (const time of [7, 8]) assert.equal(direction.propose('Bad', time, time), null);
  assert.equal(direction.propose('Bad', 9, 9), 2);
});
