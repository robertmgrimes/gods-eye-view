import test from 'node:test';
import assert from 'node:assert/strict';
import { createCwwpSource } from './source.js';

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test('the client asks the proxy by view and never sends an upstream snapshot URL', async () => {
  const calls = [];
  const source = createCwwpSource({
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
    west: -118.5,
    south: 33.9,
    east: -118.1,
    north: 34.2,
  });
  await source.cameras({
    kind: 'nearby',
    lat: 34.05,
    lon: -118.25,
    radiusKm: 40,
  });
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      '/api/cwwp/webcams?west=-118.5&south=33.9&east=-118.1&north=34.2',
      '/api/cwwp/webcams?lat=34.05&lon=-118.25&radiusKm=40',
    ],
  );
  for (const call of calls) {
    assert.equal(call.options.cache, 'no-store');
    assert.equal(call.options.headers, undefined);
    assert.equal(String(call.url).includes('cwwp2'), false);
  }
});

test('warm posts only the visible camera ids', async () => {
  const calls = [];
  const source = createCwwpSource({
    fetchImpl: async (url) => {
      calls.push(String(url));
      return jsonResponse(200, { refreshed: 1, cached: 0, kept: 0, failed: 0 });
    },
  });
  await source.warm(['d07-1', 'd07-1', 'nope', 'd07-16']);
  assert.deepEqual(calls, ['/api/cwwp/webcams/warm?ids=d07-1%2Cd07-16']);
});

test('upstream failures stay on the proxy error code', async () => {
  const source = createCwwpSource({
    fetchImpl: async () => jsonResponse(502, { error: 'upstream' }),
  });
  await assert.rejects(
    source.cameras({ west: -118.5, south: 33.9, east: -118.1, north: 34.2 }),
    (error) => error.code === 'upstream',
  );
});
