import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { npsNatureProxy } from '../../../server/providers/npsNature.js';
import { STILL_REFRESH_MS } from './policy.js';

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

test('the proxy has no key and does not read the environment', () => {
  const source = readFileSync(
    new URL('../../../server/providers/npsNature.js', import.meta.url),
    'utf8',
  );
  assert.equal(source.includes('process.env'), false);
  assert.equal(/API_KEY|SECRET|PASSWORD/i.test(source), false);
  assert.equal(source.includes('pixelcaster'), false);
  assert.equal(source.includes('yosemite.org'), false);
});

test('the catalog is local and hides JPEG hosts', async (t) => {
  t.mock.method(globalThis, 'fetch', () => {
    throw new Error('catalog must not call the network');
  });
  const request = install(npsNatureProxy());
  const res = await request('/cameras');
  assert.equal(res.status, 200);
  const body = json(res);
  assert.equal(body.count, 13);
  const north = body.cameras.find((row) => row.id === 'yell-north-out');
  assert.equal(north.stillUrl, '/api/nps-nature/cameras/yell-north-out/still');
  assert.equal(north.approximate, true);
  assert.equal(res.body.includes('webcams-yell'), false);
  assert.equal(res.body.includes('yosemite'), false);
  assert.equal(res.body.includes('pixelcaster'), false);
  assert.equal(
    body.cameras.find((row) => row.id === 'yell-of-livestream').stillUrl,
    null,
  );
  assert.equal((await request('/cameras', 'POST')).status, 405);
});

test('a Yellowstone still is proxied as JPEG and a link-out is not', async (t) => {
  const calls = [];
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(String(url));
    return new Response(jpeg, {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    });
  });
  const request = install(npsNatureProxy());
  const still = await request(
    '/cameras/yell-north-out/still?url=https://yosemite.org/secret.jpg',
  );
  assert.equal(still.status, 200);
  assert.equal(still.headers['Content-Type'], 'image/jpeg');
  assert.equal(calls.length, 1);
  assert.equal(calls[0], 'https://www.nps.gov/webcams-yell/mammoth_arch.jpg');
  const again = await request('/cameras/yell-north-out/still');
  assert.equal(again.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(STILL_REFRESH_MS >= 60_000, true);
  const live = await request('/cameras/yell-of-livestream/still');
  assert.equal(live.status, 404);
  assert.equal(calls.length, 1);
  const missing = await request('/cameras/yose-falls/still');
  assert.equal(missing.status, 404);
});
