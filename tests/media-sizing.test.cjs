const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MediaService } = require('../lib/commonjs/Service/Media/MediaService');
const { RealtimeModel, realtimeModelSpecifications } = require('../lib/commonjs/Service/Realtime/RealtimeModel');

for (const model of Object.values(RealtimeModel)) {
  test(`${model}: media sizing matches the current fixed-canvas model limits`, () => {
    const service = new MediaService(model), spec = realtimeModelSpecifications[model];
    assert.equal(spec.minimumInputPixels, 200000);
    assert.equal(spec.maximumInputPixels, 2100000);
    assert.equal(spec.inputSizeAlignment, 32);
    for (const [source, expected] of [
      [[400, 752], [400, 752]], [[512, 960], [512, 960]],
      [[256, 480], [352, 660]], [[200, 200], [448, 448]], [[1, 1], [448, 448]],
      [[3840, 2160], [1920, 1080]], [[8000, 6000], [1664, 1248]],
      [[1001, 1000], [1000, 1000]], [[1001, 600], [1000, 600]],
      [[1280, 1707], [1252, 1672]],
    ]) {
      for (const swap of [false, true]) {
        const [width, height] = swap ? [...source].reverse() : source;
        const [outWidth, outHeight] = swap ? [...expected].reverse() : expected;
        assert.deepEqual(service.resolveMediaSize({ width, height }, 'image'), { width: outWidth, height: outHeight });
      }
    }
    for (const format of spec.supportedVideoFormats)
      assert.deepEqual(service.resolveMediaSize(format, 'camera'), { width: format.width, height: format.height });
    assert.throws(() => service.resolveMediaSize({ width: 1024, height: 1920 }, 'camera'), { code: 'INVALID_CONFIGURATION' });
  });
}

test('X2.1 selects each generation canvas by source aspect ratio without resizing the source', () => {
  const service = new MediaService();
  for (const [source, canvas] of [
    [[1280, 720], [1920, 1080]],
    [[720, 1280], [1080, 1920]],
    [[1000, 1000], [1408, 1408]],
    [[1200, 1600], [1152, 1536]],
    [[1600, 1200], [1536, 1152]],
  ]) {
    const media = service.resolveMediaSize({ width: source[0], height: source[1] }, 'image');
    assert.deepEqual(service.resolveGenerationSize(media), { width: canvas[0], height: canvas[1] });
    assert.deepEqual(media, { width: source[0], height: source[1] });
  }
});

test('alignment boundaries and extreme source aspect ratios stay within the model area', () => {
  const service = new MediaService();
  for (const pair of [[1001, 199], [999, 200], [1000, 200], [1, 200001], [447, 448], [999, 501], [1449, 1450], [65535, 65537]]) {
    for (const [width, height] of [pair, [...pair].reverse()]) {
      const size = service.resolveMediaSize({ width, height }, 'image');
      assert.equal(size.width % 4, 0);
      assert.equal(size.height % 4, 0);
      assert(size.width * size.height >= 200000 && size.width * size.height <= 2100000);
    }
  }
});

test('source, canvas and return dimensions follow separate constraints', () => {
  const service = new MediaService();
  const media = service.resolveMediaSize({ width: 200, height: 200 }, 'image');
  assert.deepEqual(media, { width: 448, height: 448 });
  assert.deepEqual(service.resolveTargetSize(media, { width: 224, height: 224 }), { width: 224, height: 224 });
  assert.deepEqual(service.resolveTargetSize(media, { width: 1000, height: 1000 }), media);
  assert.deepEqual(service.resolveGenerationSize({ width: 1200, height: 1600 }), { width: 1152, height: 1536 });
  assert.deepEqual(service.resolveGenerationSize({ width: 1280, height: 720 }), { width: 1920, height: 1080 });
  assert.deepEqual(service.resolveTargetSize({ width: 1024, height: 1920 }, { width: 921.6, height: 1728 }), { width: 896, height: 1680 });
  for (const invalid of [NaN, Infinity, 0, -1, 100.5, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => service.resolveMediaSize({ width: invalid, height: 600 }, 'image'), { code: 'INVALID_CONFIGURATION' });
  assert.throws(() => service.resolveTargetSize({ width: 448, height: 448 }, { width: 2, height: 2 }), { code: 'INVALID_CONFIGURATION' });
});
