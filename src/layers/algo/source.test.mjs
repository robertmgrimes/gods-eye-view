import test from 'node:test';
import assert from 'node:assert/strict';
import { createAlgoSource } from './source.js';

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test('the client asks the proxy by view and never sends an upstream snapshot URL', async () => {
  const calls = [];
  const source = createAlgoSource({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse(200, {
        cameras: [],
        count: 0,
        coverage: 'outside',
      });
    },
  });
  await source.cameras({
    west: -88.4,
    south: 30.4,
    east: -88.1,
    north: 30.7,
  });
  await source.cameras({
    kind: 'nearby',
    lat: 30.5351,
    lon: -88.2395,
    radiusKm: 20,
  });
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      '/api/algo/webcams?west=-88.4&south=30.4&east=-88.1&north=30.7',
      '/api/algo/webcams?lat=30.5351&lon=-88.2395&radiusKm=20',
    ],
  );
  for (const call of calls) {
    assert.equal(call.options.cache, 'no-store');
    assert.equal(call.options.headers, undefined);
    assert.equal(String(call.url).includes('algotraffic'), false);
    assert.equal(String(call.url).includes('m3u8'), false);
  }
});

test('warm posts only the visible camera ids', async () => {
  const calls = [];
  const source = createAlgoSource({
    fetchImpl: async (url) => {
      calls.push(String(url));
      return jsonResponse(200, { refreshed: 1, cached: 0, kept: 0, failed: 0 });
    },
  });
  await source.warm(['1845', '1845', 'nope', '1844']);
  assert.deepEqual(calls, ['/api/algo/webcams/warm?ids=1845%2C1844']);
});

test('a disabled proxy stays on the disabled error code', async () => {
  const source = createAlgoSource({
    fetchImpl: async () => jsonResponse(404, { error: 'disabled' }),
  });
  await assert.rejects(
    source.cameras({ west: -88.4, south: 30.4, east: -88.1, north: 30.7 }),
    (error) => error.code === 'disabled',
  );
});
