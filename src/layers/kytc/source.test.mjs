import test from 'node:test';
import assert from 'node:assert/strict';
import { createKytcSource } from './source.js';

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test('the client asks the proxy by view and never sends an upstream snapshot URL', async () => {
  const calls = [];
  const source = createKytcSource({
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
    west: -85.9,
    south: 38.1,
    east: -85.6,
    north: 38.4,
  });
  await source.cameras({ kind: 'nearby', lat: 38.2, lon: -85.7, radiusKm: 40 });
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      '/api/kytc/webcams?west=-85.9&south=38.1&east=-85.6&north=38.4',
      '/api/kytc/webcams?lat=38.2&lon=-85.7&radiusKm=40',
    ],
  );
  for (const call of calls) {
    assert.equal(call.options.cache, 'no-store');
    assert.equal(call.options.headers, undefined);
    assert.equal(String(call.url).includes('trimarc'), false);
  }
});

test('warm posts only the visible camera ids', async () => {
  const calls = [];
  const source = createKytcSource({
    fetchImpl: async (url) => {
      calls.push(String(url));
      return jsonResponse(200, { refreshed: 1, cached: 0, kept: 0, failed: 0 });
    },
  });
  await source.warm([2, '2', 'nope', 16]);
  assert.deepEqual(calls, ['/api/kytc/webcams/warm?ids=2%2C16']);
});

test('upstream failures stay on the proxy error code', async () => {
  const source = createKytcSource({
    fetchImpl: async () => jsonResponse(502, { error: 'upstream' }),
  });
  await assert.rejects(
    source.cameras({ west: -86, south: 37, east: -85, north: 38 }),
    (error) => error.code === 'upstream',
  );
});
