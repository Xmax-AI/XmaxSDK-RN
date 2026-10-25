const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ApiService } = require('../lib/commonjs/Service/Network/ApiService');
const { makeAPIRequestURL, validateAPIBaseURL } = require('../lib/commonjs/Service/Network/ApiRequestURL');
const runtime = { platform: 'ios', os_version: '27', sdk_version: 'fixture', device_model: 'test' };

test('API requests normalize whitespace, leading slashes and HTTPS service roots before transport', async () => {
  const seen = [];
  const api = new ApiService(' key ', 'https://Example.invalid/api/v1/', runtime, async (url, options) => {
    seen.push({ url, options });
    return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
  });
  await api.request('GET', '  session/one  ');
  await api.request('GET', '/session/two?q=1');
  assert.deepEqual(seen.map(request => request.url), ['https://example.invalid/api/v1/session/one', 'https://example.invalid/api/v1/session/two?q=1']);
  assert.equal(seen[0].options.headers['X-Api-Key'], 'key');
  assert.equal(makeAPIRequestURL('https://example.invalid', '/session'), 'https://example.invalid/session');
});

test('invalid API roots and foreign or empty paths reject before exposing authentication to transport', async () => {
  let requests = 0;
  const transport = async () => { requests++; throw new Error('must not send'); };
  for (const root of ['http://example.invalid', 'file:///tmp/api', 'not-a-url', 'https://']) {
    assert.throws(() => validateAPIBaseURL(root), { code: 'INVALID_CONFIGURATION' });
    await assert.rejects(new ApiService('key', root, runtime, transport).request('GET', '/session'), { code: 'INVALID_CONFIGURATION' });
  }
  for (const path of ['', '   ', '//other.invalid/session', 'https://other.invalid/session', '/https://other.invalid']) {
    await assert.rejects(new ApiService('key', 'https://example.invalid/api', runtime, transport).request('GET', path), { code: 'INVALID_CONFIGURATION' });
  }
  assert.equal(requests, 0);
});
