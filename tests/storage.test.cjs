const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  StorageService,
} = require('../lib/commonjs/Service/Storage/StorageService');
const {
  uploadMetadata,
  parseStorageConfiguration,
  objectURL,
  filePath,
} = require('../lib/commonjs/Service/Storage/StorageValidation');
const payload = {
  bucket: 'fixture-123',
  region: 'ap-nanjing',
  endpoint: '',
  prefix: 'open/',
  credentials: {
    accessKeyId: 'fixture-id',
    secretAccessKey: 'fixture-secret',
    sessionToken: 'fixture-token',
  },
};
const result = {
  url: 'https://fixture.example/a.png',
  objectKey: 'key',
  etag: 'etag',
};
function fixture(overrides = {}) {
  const calls = [];
  const api = {
    request: async (method, path, body) => {
      calls.push({ method, path, body });
      return path === '/cos/sts'
        ? payload
        : { safe: true, url: 'https://checked.example/a.png' };
    },
  };
  const storage = {
    fileSize: async () => 12,
    upload: async options => {
      calls.push({ upload: options });
      options.progress({
        completedUnitCount: 12,
        totalUnitCount: 12,
        fractionCompleted: 1,
      });
      return result;
    },
    download: async options => ({
      fileURL: options.destinationURL,
      byteCount: 12,
    }),
    ...overrides,
  };
  return {
    service: new StorageService(
      api,
      storage,
      () => 'UUID',
      () => 123,
    ),
    calls,
    api,
  };
}
test('storage validates file URLs, media types, filenames and endpoint encoding', () => {
  assert.deepEqual(uploadMetadata('file:///tmp/a%20b.PNG', 'image'), {
    fileName: 'a_b.PNG',
    contentType: 'image/png',
  });
  assert.throws(() => uploadMetadata('content://media/1', 'image'), {
    code: 'INVALID_CONFIGURATION',
  });
  assert.throws(() => uploadMetadata('file:///tmp/a.txt', 'image'), {
    code: 'INVALID_CONFIGURATION',
  });
  assert.throws(
    () => uploadMetadata('file:///tmp/a.png', 'image', 'video/mp4'),
    { code: 'INVALID_CONFIGURATION' },
  );
  assert.throws(() => filePath('file://remote/tmp/a.png'), {
    code: 'INVALID_CONFIGURATION',
  });
  const config = parseStorageConfiguration({
    ...payload,
    endpoint: 'cos.ap-nanjing.myqcloud.com/base',
  });
  assert.equal(
    objectURL(config, 'open/a b#?.png'),
    'https://fixture-123.cos.ap-nanjing.myqcloud.com/base/open/a%20b%23%3F.png',
  );
  assert.throws(
    () => parseStorageConfiguration({ ...payload, credentials: {} }),
    { code: 'API_ERROR' },
  );
});
test('ordinary upload obtains STS, preserves prefix and never calls image safety endpoint', async () => {
  const { service, calls } = fixture();
  assert.deepEqual(
    await service.upload({ fileURL: 'file:///tmp/a.png' }, 'image', false),
    result,
  );
  assert.deepEqual(calls[0], {
    method: 'GET',
    path: '/cos/sts',
    body: undefined,
  });
  assert.equal(calls[1].upload.objectKey, 'open/123_uuid_a.png');
  assert.equal(calls.length, 2);
});
test('safe image upload uses checked URL and rejects unsafe or malformed results', async () => {
  for (const [checked, expected] of [
    [{ safe: true, url: 'https://checked.example/a.png' }, null],
    [{ safe: false }, 'UNSAFE_IMAGE'],
    [{}, 'API_ERROR'],
    [{ safe: true }, 'API_ERROR'],
  ]) {
    const { service, api, calls } = fixture();
    api.request = async (method, path, body) => {
      calls.push({ method, path, body });
      return path === '/cos/sts' ? payload : checked;
    };
    const task = service.upload(
      { fileURL: 'file:///tmp/a.png' },
      'image',
      true,
    );
    if (expected) await assert.rejects(task, { code: expected });
    else assert.equal((await task).url, checked.url);
    assert.deepEqual(calls.at(-1), {
      method: 'POST',
      path: '/cos/image/check',
      body: { url: result.url },
    });
  }
});
test('cancellation during STS prevents upload after late credentials and operations stay independent', async () => {
  const { service, api, calls } = fixture();
  let resolveSTS;
  api.request = () =>
    new Promise(resolve => {
      resolveSTS = resolve;
    });
  const controller = new AbortController();
  const task = service.upload(
    { fileURL: 'file:///tmp/a.png', signal: controller.signal },
    'image',
    false,
  );
  await new Promise(setImmediate);
  controller.abort();
  await assert.rejects(task, { code: 'CANCELLED' });
  resolveSTS(payload);
  await new Promise(setImmediate);
  assert.equal(calls.length, 0);
  api.request = async () => payload;
  assert.deepEqual(
    await service.upload({ fileURL: 'file:///tmp/b.mp4' }, 'video', false),
    result,
  );
});
test('finished storage operations ignore late progress and throwing listeners do not fail upload', async () => {
  let emit,
    count = 0;
  const { service } = fixture({
    upload: async options => {
      emit = options.progress;
      options.progress({
        completedUnitCount: 1,
        totalUnitCount: 2,
        fractionCompleted: 0.5,
      });
      return result;
    },
  });
  assert.deepEqual(
    await service.upload(
      {
        fileURL: 'file:///tmp/a.png',
        progress: () => {
          count++;
          throw Error('host');
        },
      },
      'image',
      false,
    ),
    result,
  );
  emit({ completedUnitCount: 2, totalUnitCount: 2, fractionCompleted: 1 });
  assert.equal(count, 1);
});
test('download validates destinations independently of upload credentials', async () => {
  const { service, calls } = fixture();
  assert.deepEqual(
    await service.download({
      remoteURL: 'https://fixture.example/a.png',
      destinationURL: 'file:///tmp/a.png',
    }),
    { fileURL: 'file:///tmp/a.png', byteCount: 12 },
  );
  assert.equal(calls.length, 0);
  await assert.rejects(
    service.download({
      remoteURL: 'ftp://fixture/a',
      destinationURL: 'file:///tmp/a',
    }),
    { code: 'INVALID_CONFIGURATION' },
  );
});

test('long-running transfers remain under transport timeout and explicit cancellation control', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let complete, signal, settled = false;
  const { service } = fixture({ download: async options => {
    signal = options.signal;
    return new Promise(resolve => { complete = resolve; });
  } });
  const transfer = service.download({ remoteURL: 'https://example.invalid/file', destinationURL: 'file:///tmp/file' }).then(value => { settled = true; return value; });
  t.mock.timers.tick(20 * 60 * 1000);
  await Promise.resolve();
  assert.equal(signal.aborted, false);
  assert.equal(settled, false);
  complete({ fileURL: 'file:///tmp/file', byteCount: 1 });
  assert.equal((await transfer).byteCount, 1);
});
