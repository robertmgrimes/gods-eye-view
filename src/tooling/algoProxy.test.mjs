import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { algoProxy } from '../../server/providers/algo.js';
import { LIST_CACHE_TTL_MS, STILL_REFRESH_MS } from '../layers/algo/policy.js';

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

function camera({
  id,
  lat,
  lon,
  accessLevel = 'Public',
  snapshot = `https://api.algotraffic.com/v4/Cameras/${id}/snapshot.jpg`,
}) {
  return {
    id,
    accessLevel,
    responsibleRegion: 'Southwest',
    location: {
      latitude: lat,
      longitude: lon,
      city: 'Mobile',
      county: 'Mobile',
      displayRouteDesignator: 'I-10',
      displayCrossStreet: 'McDonald Rd',
      direction: 'East',
    },
    snapshotImageUrl: snapshot,
    playbackUrls: {
      hls: 'https://cdn3.wowza.com/5/example/playlist.m3u8',
      dash: 'https://cdn3.wowza.com/5/example/manifest.mpd',
    },
  };
}

test('the proxy has no API key and never requests video', () => {
  const source = readFileSync(
    new URL('../../server/providers/algo.js', import.meta.url),
    'utf8',
  );
  assert.equal(/API_KEY|SECRET|PASSWORD/i.test(source), false);
  assert.equal(source.includes('playbackUrls'), false);
  assert.equal(source.includes('wowza'), false);
  assert.equal(source.includes('.m3u8'), false);
});

test('a disabled flag does not call ALGO', async (t) => {
  t.mock.method(globalThis, 'fetch', () => {
    throw new Error('upstream must not be called');
  });
  const request = install(algoProxy({ isEnabled: () => false }));
  const res = await request(
    '/webcams?west=-88.4&south=30.4&east=-88.1&north=30.7',
  );
  assert.equal(res.status, 404);
  assert.deepEqual(json(res), { error: 'disabled' });
  assert.equal((await request('/webcams/1845/still', 'POST')).status, 404);
});

test('a view outside Alabama is empty and does not call ALGO', async (t) => {
  t.mock.method(globalThis, 'fetch', () => {
    throw new Error('upstream must not be called');
  });
  const request = install(algoProxy({ isEnabled: () => true }));
  const res = await request(
    '/webcams?west=-74.1&south=40.6&east=-73.9&north=40.9',
  );
  assert.equal(res.status, 200);
  assert.equal(json(res).coverage, 'outside');
  assert.equal(json(res).count, 0);
  const bad = await request('/webcams?lat=30.5');
  assert.equal(bad.status, 400);
  assert.equal(
    (await request('/webcams?lat=30.5&lon=-88.2', 'POST')).status,
    405,
  );
});

test('the catalog is cached, keeps Public cameras, and hides snapshot and video URLs', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(String(url));
    return Response.json([
      camera({ id: 1845, lat: 30.535105, lon: -88.23953 }),
      camera({
        id: 9,
        lat: 30.55,
        lon: -88.22,
        accessLevel: 'FirstResponder',
      }),
      camera({
        id: 1844,
        lat: 30.544058,
        lon: -88.224075,
        snapshot: 'https://cdn3.wowza.com/5/example/playlist.m3u8',
      }),
    ]);
  });
  const request = install(algoProxy({ isEnabled: () => true }));
  const first = await request(
    '/webcams?west=-88.4&south=30.4&east=-88.1&north=30.7',
  );
  const second = await request('/webcams?lat=30.54&lon=-88.23&radiusKm=20');
  assert.equal(first.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]).hostname, 'api.algotraffic.com');
  const body = json(first);
  assert.equal(body.coverage, 'view');
  assert.deepEqual(
    body.cameras.map((row) => row.id),
    ['1845', '1844'],
  );
  assert.equal(body.cameras[0].stillUrl, '/api/algo/webcams/1845/still');
  assert.equal(body.cameras[0].title, 'I-10 @ McDonald Rd');
  assert.equal(body.cameras[1].stillUrl, null);
  assert.equal(first.body.includes('wowza'), false);
  assert.equal(first.body.includes('m3u8'), false);
  assert.equal(first.body.includes('algotraffic'), false);
  assert.equal(json(second).count, 2);
  assert.equal(calls.length, 1);
  assert.equal(LIST_CACHE_TTL_MS, 30 * 60 * 1000);
});

test('a still is proxied from the catalog snapshot and refuses a Wowza redirect', async (t) => {
  const calls = [];
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
  t.mock.method(globalThis, 'fetch', async (url) => {
    const href = String(url);
    calls.push(href);
    if (href.includes('/v4.0/cameras')) {
      return Response.json([
        camera({ id: 1845, lat: 30.535105, lon: -88.23953 }),
        camera({ id: 1842, lat: 30.550528, lon: -88.216576 }),
      ]);
    }
    if (href.includes('/Cameras/1842/')) {
      return new Response(null, {
        status: 302,
        headers: {
          location: 'https://cdn3.wowza.com/5/example/playlist.m3u8',
        },
      });
    }
    assert.equal(new URL(href).hostname, 'api.algotraffic.com');
    assert.match(href, /\/v4\/Cameras\/1845\/snapshot\.jpg/);
    return new Response(jpeg, {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    });
  });
  const request = install(algoProxy({ isEnabled: () => true }));
  const still = await request('/webcams/1845/still');
  assert.equal(still.status, 200);
  assert.equal(still.headers['Content-Type'], 'image/jpeg');
  assert.equal(Buffer.compare(still.body, Buffer.from(jpeg)), 0);
  assert.equal(calls.some((href) => href.includes('wowza')), false);
  const refused = await request('/webcams/1842/still');
  assert.equal(refused.status, 502);
  assert.equal(json(refused).error, 'upstream');
  assert.equal(
    calls.filter((href) => href.includes('wowza')).length,
    0,
  );
  const warm = await request('/webcams/warm?ids=1845,1842,nope');
  assert.equal(json(warm).cached, 1);
  assert.equal(json(warm).failed, 1);
  assert.equal(STILL_REFRESH_MS, 45 * 1000);
});
