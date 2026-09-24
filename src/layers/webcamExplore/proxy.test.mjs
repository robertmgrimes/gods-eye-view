import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcamExploreProxy } from '../../../server/providers/webcamExplore.js';
import { MCP_URL } from './policy.js';

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

function rpc(webcams) {
  return {
    jsonrpc: '2.0',
    id: 1,
    result: {
      content: [{ type: 'text', text: JSON.stringify({ webcams }) }],
      isError: false,
      structuredContent: { webcams },
    },
  };
}

const atlanta = {
  id: '64551',
  title: 'Live Atlanta Skyline View',
  location: 'Buckhead, Georgia, United States',
  category: 'youtube',
  trending: false,
  popularity_score: 5,
  thumbnail_url:
    'https://www.webcamexplore.com/storage/webcams/73770549-a7b8-46e1-8d7c-a44ab323fedf_thumb.jpg',
  page_url:
    'https://www.webcamexplore.com/countries/united-states/georgia/buckhead-1/live-atlanta-skyline-view-axis-communications-experience-center',
  is_live: true,
  stream_url: 'https://cdn.example/master.m3u8',
  latitude: 33.84,
  longitude: -84.38,
};

test('the proxy has no API key and never names a stream', () => {
  const source = readFileSync(
    new URL('../../../server/providers/webcamExplore.js', import.meta.url),
    'utf8',
  );
  assert.equal(/API_KEY|SECRET|PASSWORD/i.test(source), false);
  assert.equal(source.includes('m3u8'), false);
  assert.equal(source.includes('stream_url'), false);
});

test('search Atlanta returns a page card and caches the MCP call', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(rpc([atlanta])), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  const request = install(webcamExploreProxy());
  const first = json(await request('/search?q=Atlanta'));
  const second = json(await request('/search?q=Atlanta'));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, MCP_URL);
  assert.equal(calls[0].init.method, 'POST');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.method, 'tools/call');
  assert.equal(body.params.name, 'search_webcams');
  assert.equal(body.params.arguments.query, 'Atlanta');
  assert.equal(body.params.arguments.limit, 10);
  assert.equal(first.count, 1);
  assert.equal(first.webcams[0].page_url, atlanta.page_url);
  assert.equal(first.webcams[0].thumbnail_url, atlanta.thumbnail_url);
  assert.equal(first.webcams[0].is_live, true);
  assert.equal(JSON.stringify(first).includes('m3u8'), false);
  assert.equal(JSON.stringify(first).includes('latitude'), false);
  assert.equal(second.stale, false);
  assert.equal((await request('/search?q=Atlanta', 'POST')).status, 405);
});

test('bare Georgia never calls the MCP', async (t) => {
  t.mock.method(globalThis, 'fetch', () => {
    throw new Error('upstream must not be called');
  });
  const request = install(webcamExploreProxy());
  const search = json(await request('/search?q=Georgia'));
  const location = json(await request('/location?location=Georgia'));
  assert.equal(search.error, 'ambiguous_location');
  assert.equal(search.choices.length, 2);
  assert.equal(location.error, 'ambiguous_location');
  assert.equal((await request('/search')).status, 400);
  assert.equal((await request('/category?category=nope')).status, 400);
});

test('a failed refresh can serve the previous discovery cache', async (t) => {
  let now = 1_000;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    if (calls > 1) return new Response('no', { status: 503 });
    return new Response(JSON.stringify(rpc([atlanta])), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  const request = install(webcamExploreProxy({ now: () => now }));
  assert.equal(json(await request('/trending')).count, 1);
  now += 31 * 60 * 1000;
  const stale = json(await request('/trending'));
  assert.equal(stale.stale, true);
  assert.equal(stale.webcams[0].id, '64551');
});
