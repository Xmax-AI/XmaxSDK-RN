const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, readFile, unlink, rm, readdir } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { setImmediate: tick } = require('node:timers/promises');
const { DataFileManager } = require('../lib/commonjs/Foundation/Storage/DataFileManager');
const { StorageService } = require('../lib/commonjs/Service/Storage/StorageService');
const { ImageController } = require('../lib/commonjs/Media/Image/ImageController');
const { MediaService } = require('../lib/commonjs/Service/Media/MediaService');
const { roomEvent } = require('../lib/commonjs/Stream/Room/RoomEvent');
const { resolveBitrates } = require('../lib/commonjs/Stream/Encoding/EncodingBitratePolicy');

async function files(t, override = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'xmax-memory-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const transport = {
    dirs: { CacheDir: directory },
    writeFile: async (path, data, encoding) => {
      assert.equal(encoding, 'ascii');
      await writeFile(path, new Uint8Array(data));
    },
    unlink,
    ...override,
  };
  let id = 0;
  return { manager: new DataFileManager(() => transport, () => `test-${++id}`), directory, transport };
}
const payload = { bucket: 'fixture-123', region: 'ap-nanjing', endpoint: '', prefix: 'open/', credentials: { accessKeyId: 'id', secretAccessKey: 'secret', sessionToken: 'token' } };
const stored = { url: 'https://fixture.example/result.png', objectKey: 'key', etag: null };

test('encoded staging preserves binary subarray bytes and snapshots before asynchronous writes', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { manager, directory } = await files(t, {
    writeFile: async (path, data) => { await gate; await writeFile(path, new Uint8Array(data)); },
  });
  const original = new Uint8Array([99, 0, 128, 255, 88]);
  const pending = manager.create(original.subarray(1, 4));
  original.fill(42); release();
  const url = await pending;
  assert.deepEqual([...await readFile(new URL(url))], [0, 128, 255]);
  await manager.remove('file:///caller-owned.png');
  await manager.remove(url);
  await manager.remove(url);
  assert.deepEqual(await readdir(directory), []);
  for (const value of [new Uint8Array(), 'base64', [], null]) await assert.rejects(manager.create(value), { code: 'INVALID_CONFIGURATION' });
});

test('failed encoded writes remove partial files', async t => {
  const { manager, directory } = await files(t, {
    writeFile: async path => { await writeFile(path, 'partial'); throw new Error('disk full'); },
  });
  await assert.rejects(manager.create(new Uint8Array([1])), /disk full/);
  assert.deepEqual(await readdir(directory), []);
});

function storage(dataFiles, overrides = {}) {
  const calls = [];
  const service = new StorageService({
    async request(method, path, body) { calls.push({ path, body }); return path === '/cos/sts' ? payload : { safe: true, url: stored.url }; },
  }, {
    fileSize: async url => (await readFile(new URL(url))).length,
    upload: async options => { calls.push({ upload: options, bytes: [...await readFile(new URL(options.fileURL))] }); return stored; },
    ...overrides,
  }, () => 'UUID', () => 1, dataFiles);
  return { service, calls };
}

test('memory image and video uploads preserve filenames, MIME, snapshots and safety checks', async t => {
  const { manager, directory } = await files(t);
  for (const [media, fileName, contentType, safe] of [['image', 'photo.png', 'image/png', true], ['video', 'clip.mp4', 'video/mp4', false]]) {
    const { service, calls } = storage(manager);
    const data = new Uint8Array([0, 128, 255]);
    const upload = service.upload({ data, fileName, contentType }, media, safe);
    data.fill(20);
    assert.deepEqual(await upload, stored);
    const request = calls.find(call => call.upload);
    assert.deepEqual(request.bytes, [0, 128, 255]);
    assert.equal(request.upload.objectKey, `open/1_uuid_${fileName}`);
    assert.equal(request.upload.contentType, contentType);
    assert.equal(calls.some(call => call.path === '/cos/image/check'), safe);
    assert.deepEqual(await readdir(directory), []);
  }
});

test('memory uploads reject invalid source combinations and metadata before staging or requesting credentials', async t => {
  const { manager } = await files(t), { service, calls } = storage(manager);
  for (const options of [
    {}, { data: new Uint8Array() },
    { data: new Uint8Array([1]), fileURL: 'file:///tmp/a.png', fileName: 'a.png', contentType: 'image/png' },
    ...['../a.png', '/a.png', 'a\\b.png', 'a\0b.png', ''].map(fileName => ({ data: new Uint8Array([1]), fileName, contentType: 'image/png' })),
    { data: new Uint8Array([1]), fileName: 'a.png' },
    { data: new Uint8Array([1]), fileName: 'a.png', contentType: 'video/mp4' },
  ]) await assert.rejects(service.upload(options, 'image', false), { code: 'INVALID_CONFIGURATION' });
  assert.deepEqual(calls, []);
});

test('cancellation during memory staging removes the late file without starting upload', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { manager, directory } = await files(t, { writeFile: async (path, data) => { await gate; await writeFile(path, new Uint8Array(data)); } });
  const { service, calls } = storage(manager), cancellation = new AbortController();
  const upload = service.upload({ data: new Uint8Array([1]), fileName: 'a.png', contentType: 'image/png', signal: cancellation.signal }, 'image', false);
  const rejected = assert.rejects(upload, { code: 'CANCELLED' });
  cancellation.abort(); release(); await rejected;
  assert.deepEqual(calls, []);
  assert.deepEqual(await readdir(directory), []);
});

test('upload, credential and safety failures reclaim memory sources without affecting other uploads', async t => {
  const { manager, directory } = await files(t);
  for (const stage of ['credentials', 'upload', 'safety']) {
    const { service, calls } = storage(manager, { upload: async options => { calls.push({ upload: options }); if (stage === 'upload') throw new Error('rejected'); return stored; } });
    service.api.request = async (_method, path) => { if (stage === 'credentials' || path === '/cos/image/check') throw new Error(stage); return payload; };
    await assert.rejects(service.upload({ data: new Uint8Array([1]), fileName: 'a.png', contentType: 'image/png' }, 'image', stage === 'safety'));
    assert.deepEqual(await readdir(directory), []);
  }
  const { service } = storage(manager);
  await Promise.all([1, 2].map(byte => service.upload({ data: new Uint8Array([byte]), fileName: 'a.png', contentType: 'image/png' }, 'image', false)));
  assert.deepEqual(await readdir(directory), []);
});

function image(dataFiles, overrides = {}) {
  const sources = [], events = [];
  const rtc = { open: async () => events.push('open'), configureImageSource: async () => {}, configureEncoding: async () => {}, startImage: async path => events.push(path), close: async () => events.push('close') };
  const render = { create: () => ({ id: 'local', videoTrack: {} }), invalidate() {} };
  const images = {
    size: async url => { sources.push([...await readFile(new URL(url))]); return { width: 800, height: 1200 }; },
    prepare: async () => 'file:///cache/prepared.jpg',
    remove: async path => events.push(`remove:${path}`),
    ...overrides,
  };
  return { controller: new ImageController(rtc, render, new MediaService(), images, dataFiles), sources, events };
}

test('memory image input uses native preparation, removes staging, and retains only the prepared image until close', async t => {
  const { manager, directory } = await files(t), { controller, sources, events } = image(manager);
  const local = await controller.create({ imageData: new Uint8Array([1, 128, 255]) }, new AbortController().signal);
  assert.equal(local.id, 'local');
  assert.deepEqual(sources, [[1, 128, 255]]);
  assert.deepEqual(await readdir(directory), []);
  assert(events.includes('/cache/prepared.jpg'));
  await controller.close();
  assert.equal(events.at(-1), 'remove:file:///cache/prepared.jpg');
});

test('cancelled and failed image preparation remove encoded staging and late prepared copies', async t => {
  const { manager, directory } = await files(t);
  for (const mode of ['failure', 'cancel']) {
    const abort = new AbortController();
    const { controller, events } = image(manager, { prepare: async () => { if (mode === 'failure') throw new Error('decode'); abort.abort(); return 'file:///cache/prepared.jpg'; } });
    await assert.rejects(controller.create({ imageData: new Uint8Array([1]) }, abort.signal));
    assert.deepEqual(await readdir(directory), []);
    assert.equal(controller.stream, null);
    if (mode === 'cancel') assert(events.includes('remove:file:///cache/prepared.jpg'));
  }
});

test('downlink start and target-size changes keep bitrate bounds ordered at small and large sizes', () => {
  for (const size of [{ width: 4, height: 4 }, { width: 224, height: 224 }, { width: 676, height: 1196 }, { width: 3840, height: 2160 }]) {
    for (const event of ['start', 'change_target_size']) {
      const result = JSON.parse(roomEvent(event, 'user', {}, 'task', { width: 1024, height: 1920, fps: 30 }, { prompt: 'test' }, { targetSize: size }));
      assert.equal(result.params.min_bitrate, 500);
      assert.equal(result.params.max_bitrate, Math.min(10000, Math.max(500, resolveBitrates({ ...size, fps: 24 }).maximum)));
      assert(result.params.max_bitrate >= result.params.min_bitrate);
    }
  }
});
