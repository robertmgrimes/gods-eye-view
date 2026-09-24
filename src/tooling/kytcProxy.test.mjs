import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { kytcProxy } from '../../server/providers/kytc.js';
import { LIST_CACHE_TTL_MS } from '../layers/kytc/policy.js';

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

function feature({ id, lat, lon, snapshot, description = `Cam ${id}` }) {
  return {
    attributes: {
      OBJECTID: id,
      description,
      highway: 'I-65',
      direction: 'North',
      county: 'Jefferson',
      district: 5,
      status: 'OK',
      latitude: lat,
      longitude: lon,
      snapshot,
      updateTS: 1621047617000,
    },
  };
}

const LOUISVILLE_SNAPSHOT =
  'http://www.trimarc.org/images/milestone/CCTV_05_65_1365.jpg?token=super-secret-token';

function catalogBody(features, extra = {}) {
  return { features, exceededTransferLimit: false, ...extra };
}

test('the proxy has no key and does not read the environment', () => {
  const source = readFileSync(
    new URL('../../server/providers/kytc.js', import.meta.url),
    'utf8',
  );
  assert.equal(source.includes('process.env'), false);
  assert.equal(/API_KEY|SECRET|PASSWORD/i.test(source), false);
});

test('a view outside Kentucky is empty and does not call KYTC', async (t) => {
  t.mock.method(globalThis, 'fetch', () => {
    throw new Error('upstream must not be called');
  });
  const request = install(kytcProxy());
  const res = await request(
    '/webcams?west=-74.1&south=40.6&east=-73.9&north=40.9',
  );
  assert.equal(res.status, 200);
  assert.deepEqual(json(res), {
    fetchedAt: json(res).fetchedAt,
    stale: false,
    coverage: 'outside',
    count: 0,
    cameras: [],
  });
  assert.equal(Number.isFinite(json(res).fetchedAt), true);
  const bad = await request('/webcams?lat=38');
  assert.equal(bad.status, 400);
  assert.deepEqual(json(bad), { error: 'bad_request' });
  assert.equal(
    (await request('/webcams?lat=38.2&lon=-85.7', 'POST')).status,
    405,
  );
});

test('the catalog is cached, filtered to the view, and hides snapshot URLs', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(String(url));
    return Response.json(
      catalogBody([
        feature({
          id: 2,
          lat: 38.259,
          lon: -85.741,
          snapshot: LOUISVILLE_SNAPSHOT,
        }),
        feature({
          id: 9,
          lat: 40.71,
          lon: -74,
          snapshot: 'http://127.0.0.1/secret.jpg',
        }),
        feature({
          id: 4,
          lat: 38.2,
          lon: -85.7,
          snapshot: 'http://cam.example/live.m3u8',
        }),
      ]),
    );
  });
  const request = install(kytcProxy());
  const first = await request(
    '/webcams?west=-85.9&south=38.1&east=-85.6&north=38.4',
  );
  const second = await request(
    '/webcams?west=-86.2&south=38.0&east=-85.4&north=38.6',
  );
  assert.equal(first.status, 200);
  assert.equal(calls.length, 1);
  const upstream = new URL(calls[0]);
  assert.equal(upstream.hostname, 'kygisserver.ky.gov');
  assert.equal(upstream.searchParams.get('where'), '1=1');
  assert.equal(upstream.searchParams.get('outFields'), '*');
  assert.equal(upstream.searchParams.get('returnGeometry'), 'false');
  assert.equal(upstream.searchParams.get('f'), 'json');
  const body = json(first);
  assert.equal(body.coverage, 'view');
  assert.deepEqual(
    body.cameras.map((camera) => camera.id),
    ['2', '4'],
  );
  assert.equal(body.cameras[0].stillUrl, '/api/kytc/webcams/2/still');
  assert.equal(body.cameras[0].title, 'Cam 2');
  assert.equal(body.cameras[1].stillUrl, null);
  assert.equal(first.body.includes('super-secret-token'), false);
  assert.equal(first.body.includes('trimarc'), false);
  assert.equal(first.body.includes('127.0.0.1'), false);
  assert.equal(json(second).count, 2);
  assert.equal(calls.length, 1);
});

test('a still is proxied from the catalog snapshot, including one redirect, and ignores a client URL', async (t) => {
  const calls = [];
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
  t.mock.method(globalThis, 'fetch', async (url) => {
    const href = String(url);
    calls.push(href);
    if (href.includes('kygisserver.ky.gov')) {
      return Response.json(
        catalogBody([
          feature({
            id: 2,
            lat: 38.25,
            lon: -85.75,
            snapshot: 'http://pws.trafficwise.org/pullover/172.jpg',
          }),
        ]),
      );
    }
    if (href.startsWith('http://pws.trafficwise.org/')) {
      return new Response('moved', {
        status: 301,
        headers: { location: 'https://511in.org/pullover/172.jpg' },
      });
    }
    if (href === 'https://511in.org/pullover/172.jpg') {
      return new Response(jpeg, {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    }
    throw new Error(`unexpected upstream ${href}`);
  });
  const request = install(kytcProxy());
  const image = await request(
    '/webcams/2/still?url=http://evil.example/secret.jpg',
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
    calls.some((href) => href.includes('127.0.0.1')),
    false,
  );
  assert.equal(calls.at(-1), 'https://511in.org/pullover/172.jpg');
});

test('a private snapshot is not fetched', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(String(url));
    return Response.json(
      catalogBody([
        feature({
          id: 9,
          lat: 38.2,
          lon: -85.7,
          snapshot: 'http://127.0.0.1/secret.jpg',
        }),
      ]),
    );
  });
  const request = install(kytcProxy());
  const missing = await request('/webcams/9/still');
  assert.equal(missing.status, 404);
  assert.deepEqual(json(missing), { error: 'not_found' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].includes('127.0.0.1'), false);
});

test('an expired catalog is reused when KYTC fails, and a fresh one replaces it', async (t) => {
  let now = 1_700_000_000_000;
  t.mock.method(Date, 'now', () => now);
  let mode = 'ok';
  t.mock.method(globalThis, 'fetch', async () => {
    if (mode === 'fail') return new Response('nope', { status: 503 });
    return Response.json(
      catalogBody([
        feature({
          id: 2,
          lat: 38.25,
          lon: -85.75,
          snapshot: 'http://www.trimarc.org/a.jpg',
        }),
      ]),
    );
  });
  const request = install(kytcProxy());
  const view = '/webcams?west=-86&south=38&east=-85&north=39';
  assert.equal((await request(view)).status, 200);
  mode = 'fail';
  now += LIST_CACHE_TTL_MS + 5;
  const stale = json(await request(view));
  assert.equal(stale.stale, true);
  assert.equal(stale.cameras[0].id, '2');
  assert.equal(stale.cameras[0].stillUrl, '/api/kytc/webcams/2/still');
  mode = 'ok';
  now += LIST_CACHE_TTL_MS + 5;
  const fresh = json(await request(view));
  assert.equal(fresh.stale, false);
});

test('catalog pages follow exceededTransferLimit and then stop', async (t) => {
  const offsets = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    const offset = Number(new URL(url).searchParams.get('resultOffset'));
    offsets.push(offset);
    if (offset === 0) {
      return Response.json(
        catalogBody(
          [
            feature({
              id: 1,
              lat: 38.1,
              lon: -85.7,
              snapshot: 'http://www.trimarc.org/1.jpg',
            }),
          ],
          { exceededTransferLimit: true },
        ),
      );
    }
    return Response.json(
      catalogBody([
        feature({
          id: 2,
          lat: 38.2,
          lon: -85.6,
          snapshot: 'http://www.trimarc.org/2.jpg',
        }),
      ]),
    );
  });
  const request = install(kytcProxy());
  const body = json(
    await request('/webcams?west=-86&south=38&east=-85&north=39'),
  );
  assert.deepEqual(offsets, [0, 1]);
  assert.deepEqual(
    body.cameras.map((camera) => camera.id),
    ['1', '2'],
  );
});
