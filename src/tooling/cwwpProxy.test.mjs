import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cwwpProxy } from '../../server/providers/cwwp.js';
import { LIST_CACHE_TTL_MS, stillRefreshMs } from '../layers/cwwp/policy.js';

function install(plugin) {
  const routes = new Map();
  plugin.configureServer({
    middlewares: {
      use(route, handler) {
        routes.set(route, handler);
      },
    },
  });
  return async (url = '/', method = 'GET') => {
    const res = {
      headersSent: false,
      writeHead(status, headers) {
        Object.assign(this, { status, headers, headersSent: true });
      },
      end(body) {
        this.body = body;
      },
    };
    await [...routes.values()][0]({ url, method }, res);
    return res;
  };
}

const json = (res) => JSON.parse(res.body || 'null');

function record({
  index = '1',
  lat = '34.0837',
  lon = '-118.2215',
  inService = 'true',
  still = 'https://cwwp2.dot.ca.gov/data/d7/cctv/image/cam/cam.jpg',
  hls = 'https://wzmedia.dot.ca.gov/D7/CCTV-1.stream/playlist.m3u8',
  frequency = '2',
  name = `Cam ${index}`,
} = {}) {
  return {
    cctv: {
      index: String(index),
      recordTimestamp: { recordEpoch: '1715124427' },
      location: {
        district: '7',
        locationName: name,
        nearbyPlace: 'Cypress Park',
        longitude: String(lon),
        latitude: String(lat),
        direction: 'South',
        county: 'Los Angeles',
        route: 'I-110',
      },
      inService,
      imageData: {
        streamingVideoURL: hls,
        static: {
          currentImageUpdateFrequency: frequency,
          currentImageURL: still,
        },
      },
    },
  };
}

function districts(handler) {
  return async (url, options) => {
    const href = String(url);
    const match = href.match(/cctvStatusD(\d+)\.json/);
    if (match) return handler(Number(match[1]), href, options);
    return handler(0, href, options);
  };
}

const LA = '/webcams?west=-118.5&south=33.9&east=-118.1&north=34.2';

test('the proxy has no key and does not read the environment', () => {
  const source = readFileSync(
    new URL('../../server/providers/cwwp.js', import.meta.url),
    'utf8',
  );
  assert.equal(source.includes('process.env'), false);
  assert.equal(/API_KEY|SECRET|PASSWORD/i.test(source), false);
  assert.equal(source.includes('wzmedia.dot.ca.gov'), false);
});

test('a view outside California is empty and does not call Caltrans', async (t) => {
  t.mock.method(globalThis, 'fetch', () => {
    throw new Error('upstream must not be called');
  });
  const request = install(cwwpProxy());
  const res = await request(
    '/webcams?west=-74.1&south=40.6&east=-73.9&north=40.9',
  );
  assert.equal(res.status, 200);
  assert.equal(json(res).coverage, 'outside');
  assert.equal(json(res).count, 0);
  const bad = await request('/webcams?lat=34');
  assert.equal(bad.status, 400);
  assert.deepEqual(json(bad), { error: 'bad_request' });
  assert.equal((await request(LA, 'POST')).status, 405);
});

test('district files are cached, filtered, and hide still and HLS urls', async (t) => {
  const calls = [];
  t.mock.method(
    globalThis,
    'fetch',
    districts((district, href) => {
      calls.push(href);
      if (district === 7) {
        return Response.json({
          data: [
            record({ index: 1 }),
            record({
              index: 2,
              inService: 'false',
              name: 'closed',
            }),
            record({
              index: 9,
              lat: '40.71',
              lon: '-74',
              still: 'http://127.0.0.1/secret.jpg',
            }),
            record({
              index: 4,
              still: 'https://cwwp2.dot.ca.gov/live.m3u8',
            }),
          ],
        });
      }
      if (district === 8) {
        return Response.json({
          data: [
            record({
              index: 1,
              lat: '34.05',
              lon: '-117.6',
              name: 'Inland',
            }),
          ],
        });
      }
      return Response.json({ data: [] });
    }),
  );
  const request = install(cwwpProxy());
  const first = await request(LA);
  const second = await request(
    '/webcams?west=-118.6&south=33.8&east=-118.0&north=34.3',
  );
  assert.equal(first.status, 200);
  assert.deepEqual(
    calls.map((href) => href.match(/cctvStatusD(\d+)\.json/)?.[1]).sort(),
    ['07', '12'],
  );
  assert.equal(calls.filter((href) => href.includes('wzmedia')).length, 0);
  assert.ok(
    calls.some((href) => href.endsWith('/data/d7/cctv/cctvStatusD07.json')),
  );
  assert.equal(
    calls.some((href) => href.endsWith('/data/d10/cctv/cctvStatusD10.json')),
    false,
  );
  const body = json(first);
  assert.equal(body.coverage, 'view');
  assert.deepEqual(body.cameras.map((camera) => camera.id).sort(), [
    'd07-1',
    'd07-4',
  ]);
  assert.equal(
    body.cameras.find((camera) => camera.id === 'd07-1').stillUrl,
    '/api/cwwp/webcams/d07-1/still',
  );
  assert.equal(
    body.cameras.find((camera) => camera.id === 'd07-4').stillUrl,
    null,
  );
  assert.equal(first.body.includes('wzmedia'), false);
  assert.equal(first.body.includes('cwwp2.dot.ca.gov'), false);
  assert.equal(first.body.includes('127.0.0.1'), false);
  assert.equal(json(second).count, 2);
  assert.equal(calls.length, 2);
  const missing = await request('/webcams/d07-9/still');
  assert.equal(missing.status, 404);
  assert.equal(
    calls.some((href) => href.includes('127.0.0.1')),
    false,
  );
});

test('a still is proxied from the catalog snapshot and ignores a client URL', async (t) => {
  const calls = [];
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
  t.mock.method(
    globalThis,
    'fetch',
    districts((district, href) => {
      calls.push(href);
      if (district === 7) {
        return Response.json({
          data: [
            record({
              still: 'https://cwwp2.dot.ca.gov/data/d7/cctv/image/cam/cam.jpg',
            }),
          ],
        });
      }
      if (
        href.startsWith(
          'https://cwwp2.dot.ca.gov/data/d7/cctv/image/cam/cam.jpg',
        )
      ) {
        return new Response('moved', {
          status: 301,
          headers: {
            location:
              'https://cwwp2.dot.ca.gov/data/d7/cctv/image/cam/final.jpg',
          },
        });
      }
      if (
        href.startsWith(
          'https://cwwp2.dot.ca.gov/data/d7/cctv/image/cam/final.jpg',
        )
      ) {
        return new Response(jpeg, {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        });
      }
      if (district) return Response.json({ data: [] });
      throw new Error(`unexpected upstream ${href}`);
    }),
  );
  const request = install(cwwpProxy());
  const image = await request(
    '/webcams/d07-1/still?url=https://evil.example/secret.jpg',
  );
  assert.equal(image.status, 200);
  assert.equal(image.headers['Content-Type'], 'image/jpeg');
  assert.equal(image.headers['Cache-Control'], 'no-store');
  assert.deepEqual(Buffer.from(image.body), Buffer.from(jpeg));
  assert.equal(
    calls.some((href) => href.includes('evil.example')),
    false,
  );
  assert.equal(
    calls.some((href) => href.includes('wzmedia')),
    false,
  );
  assert.equal(
    calls.at(-1),
    'https://cwwp2.dot.ca.gov/data/d7/cctv/image/cam/final.jpg',
  );
  assert.match(
    calls.at(-2),
    /^https:\/\/cwwp2\.dot\.ca\.gov\/data\/d7\/cctv\/image\/cam\/cam\.jpg\?t=\d+$/,
  );
});

test('a TLS failure is retried and then succeeds', async (t) => {
  const attempts = new Map();
  t.mock.method(
    globalThis,
    'fetch',
    districts((district) => {
      attempts.set(district, (attempts.get(district) || 0) + 1);
      if (district === 7 && attempts.get(district) < 3) {
        throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
      }
      if (district === 7) {
        return Response.json({ data: [record()] });
      }
      return Response.json({ data: [] });
    }),
  );
  const request = install(cwwpProxy());
  const body = json(await request(LA));
  assert.equal(body.count, 1);
  assert.equal(body.cameras[0].id, 'd07-1');
  assert.equal(attempts.get(7), 3);
});

test('a failed district is omitted and the rest of the catalog is stale', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    districts((district) => {
      if (district === 12) throw new TypeError('fetch failed');
      if (district === 7) return Response.json({ data: [record()] });
      return Response.json({ data: [] });
    }),
  );
  const request = install(cwwpProxy());
  const body = json(await request(LA));
  assert.equal(body.stale, true);
  assert.deepEqual(
    body.cameras.map((camera) => camera.id),
    ['d07-1'],
  );
});

test('a slow still waits out its own update frequency', async (t) => {
  let now = 1_700_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const calls = [];
  t.mock.method(
    globalThis,
    'fetch',
    districts((district, href) => {
      calls.push(href);
      if (district === 7) {
        return Response.json({
          data: [record({ frequency: '60' })],
        });
      }
      if (href.includes('/image/')) {
        return new Response(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        });
      }
      return Response.json({ data: [] });
    }),
  );
  const request = install(cwwpProxy());
  assert.equal((await request('/webcams/d07-1/still')).status, 200);
  const imageCalls = () =>
    calls.filter((href) => href.includes('/image/')).length;
  assert.equal(imageCalls(), 1);
  now += STILL_WINDOW();
  assert.equal((await request('/webcams/d07-1/still')).status, 200);
  assert.equal(imageCalls(), 1);
  now += stillRefreshMs(60);
  assert.equal((await request('/webcams/d07-1/still')).status, 200);
  assert.equal(imageCalls(), 2);
});

function STILL_WINDOW() {
  return 2 * 60 * 1000;
}

test('warm refreshes only the requested visible ids and limits concurrency', async (t) => {
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  t.mock.method(
    globalThis,
    'fetch',
    districts(async (district, href) => {
      calls.push(href);
      if (district === 7) {
        return Response.json({
          data: [1, 2, 3, 4].map((index) =>
            record({
              index,
              lat: String(34.08 + index * 0.01),
              still: `https://cwwp2.dot.ca.gov/data/d7/cctv/image/cam/${index}.jpg`,
            }),
          ),
        });
      }
      if (href.includes('/image/')) {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 20));
        inFlight -= 1;
        return new Response(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        });
      }
      return Response.json({ data: [] });
    }),
  );
  const request = install(cwwpProxy());
  const warm = await request(
    '/webcams/warm?ids=d07-1,d07-2,d07-3,d07-4,d07-2,nope',
  );
  const body = json(warm);
  assert.equal(warm.status, 200);
  assert.equal(body.refreshed, 4);
  assert.equal(body.count, 4);
  assert.equal(warm.body.includes('cwwp2'), false);
  assert.equal(warm.body.includes('wzmedia'), false);
  assert.equal(maxInFlight, 2);
  const cached = await request('/webcams/warm?ids=d07-2');
  assert.equal(json(cached).cached, 1);
  assert.equal(json(cached).refreshed, 0);
});

test('an expired district is reused when Caltrans fails, and a fresh one replaces it', async (t) => {
  let now = 1_700_000_000_000;
  t.mock.method(Date, 'now', () => now);
  let mode = 'ok';
  t.mock.method(
    globalThis,
    'fetch',
    districts((district) => {
      if (mode === 'fail') throw new TypeError('fetch failed');
      if (district === 7) return Response.json({ data: [record()] });
      return Response.json({ data: [] });
    }),
  );
  const request = install(cwwpProxy());
  assert.equal((await request(LA)).status, 200);
  mode = 'fail';
  now += LIST_CACHE_TTL_MS + 5;
  const stale = json(await request(LA));
  assert.equal(stale.stale, true);
  assert.equal(stale.cameras[0].id, 'd07-1');
  mode = 'ok';
  now += LIST_CACHE_TTL_MS + 5;
  const fresh = json(await request(LA));
  assert.equal(fresh.stale, false);
  assert.equal(fresh.cameras[0].stillUrl, '/api/cwwp/webcams/d07-1/still');
});
