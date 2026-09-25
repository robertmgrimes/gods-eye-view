import test from 'node:test';
import assert from 'node:assert/strict';
import { createWindySource } from './source.js';

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test('the client asks the proxy and never puts a key on the request', async () => {
  const calls = [];
  const source = createWindySource({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (String(url).includes('/point-forecast')) {
        return jsonResponse(503, { error: 'no_key' });
      }
      return jsonResponse(200, { webcams: [], count: 0 });
    },
  });
  await source.nearby({ lat: 33.75, lon: -84.39, radiusKm: 50 });
  await source.detail('42');
  await assert.rejects(source.forecast({ lat: 1, lon: 2 }), /KEY REQUIRED/);
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      '/api/windy/webcams?lat=33.75&lon=-84.39&radiusKm=50',
      '/api/windy/webcams/42',
      '/api/windy/point-forecast?lat=1&lon=2',
    ],
  );
  for (const call of calls) {
    assert.equal(call.options.cache, 'no-store');
    assert.equal(JSON.stringify(call).includes('WINDY_'), false);
    assert.equal(call.options.headers, undefined);
  }
});
