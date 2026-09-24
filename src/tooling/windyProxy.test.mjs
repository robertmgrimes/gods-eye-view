import test from 'node:test';
import assert from 'node:assert/strict';
import { windyProxy } from '../../server/providers/windy.js';
import { WINDY_TESTING_DISCLAIMER } from '../layers/windy/model.js';

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

function isolate(t, env = {}) {
  for (const [name, value] of Object.entries(env)) {
    const previous = process.env[name];
    t.after(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

const json = (res) => JSON.parse(res.body || 'null');

test('missing keys stop before any upstream call and do not echo a secret', async (t) => {
  isolate(t, { WINDY_API_KEY: '', WINDY_POINT_FORECAST_API_KEY: '' });
  t.mock.method(globalThis, 'fetch', () => {
    throw new Error('upstream must not be called');
  });
  const request = install(windyProxy());
  const status = await request('/status');
  assert.equal(status.status, 200);
  assert.deepEqual(json(status), { webcams: false, pointForecast: false });
  const nearby = await request('/webcams?lat=33.75&lon=-84.39&radiusKm=50');
  assert.equal(nearby.status, 503);
  assert.deepEqual(json(nearby), { error: 'no_key' });
  const forecast = await request('/point-forecast?lat=33.75&lon=-84.39');
  assert.equal(forecast.status, 503);
  assert.equal(json(forecast).error, 'no_key');
  assert.equal(`${nearby.body}${forecast.body}`.includes('secret'), false);
});

test('nearby uses the webcam header, caches locations without image urls, and hides a rejected key', async (t) => {
  const secret = 'webcams-secret-value';
  isolate(t, { WINDY_API_KEY: secret, WINDY_POINT_FORECAST_API_KEY: '' });
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args.join(' ')));
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls += 1;
    assert.equal(init.headers['x-windy-api-key'], secret);
    assert.equal(String(url).includes(secret), false);
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('limit'), '50');
    assert.equal(parsed.searchParams.get('include'), 'images,location,urls');
    assert.equal(parsed.searchParams.get('nearby'), '33.75,-84.39,50');
    if (calls === 1) {
      return new Response('denied', { status: 401 });
    }
    return Response.json({
      webcams: [
        {
          webcamId: 7,
          title: 'Peachtree',
          status: 'active',
          location: { latitude: 33.75, longitude: -84.39, city: 'Atlanta' },
          images: { current: { preview: `https://cdn.example/${secret}.jpg` } },
          urls: { detail: 'https://www.windy.com/webcams/7' },
          key: secret,
        },
      ],
    });
  });
  const request = install(windyProxy());
  const denied = await request('/webcams?lat=33.75&lon=-84.39&radiusKm=50');
  assert.equal(denied.status, 401);
  assert.deepEqual(json(denied), { error: 'unauthorized' });
  assert.equal(denied.body.includes(secret), false);
  assert.equal(warnings.join('\n').includes(secret), false);

  const fresh = install(windyProxy());
  const first = await fresh('/webcams?lat=33.75&lon=-84.39&radiusKm=50');
  const second = await fresh('/webcams?lat=33.7496&lon=-84.3902&radiusKm=50');
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  const body = json(first);
  assert.equal(body.count, 1);
  assert.equal(body.webcams[0].title, 'Peachtree');
  assert.equal(body.webcams[0].preview, null);
  assert.equal(JSON.stringify(body).includes(secret), false);
  assert.equal(calls, 2);
});

test('a preview refetches the still and a point forecast posts the key only in the body', async (t) => {
  const webSecret = 'webcams-secret-value';
  const forecastSecret = 'forecast-secret-value';
  isolate(t, {
    WINDY_API_KEY: webSecret,
    WINDY_POINT_FORECAST_API_KEY: forecastSecret,
  });
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args.join(' ')));
  const seen = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    seen.push({
      url: String(url),
      method: init.method || 'GET',
      body: init.body,
    });
    if (String(url).includes('point-forecast')) {
      const posted = JSON.parse(init.body);
      assert.equal(posted.key, forecastSecret);
      assert.equal(init.headers['x-windy-api-key'], undefined);
      return Response.json({
        ts: [1_700_000_000_000],
        units: { 'temp-surface': 'K' },
        'temp-surface': [283.15],
        'wind_u-surface': [3],
        'wind_v-surface': [4],
        key: forecastSecret,
      });
    }
    return Response.json({
      webcamId: 7,
      title: 'Peachtree',
      location: { latitude: 33.75, longitude: -84.39 },
      images: { current: { preview: 'https://cdn.example/still.jpg' } },
      urls: { player: 'https://cdn.example/live.m3u8' },
    });
  });
  const request = install(windyProxy());
  const detailA = await request('/webcams/7');
  const detailB = await request('/webcams/7');
  assert.equal(detailA.status, 200);
  assert.equal(detailB.status, 200);
  assert.equal(json(detailA).webcam.preview, 'https://cdn.example/still.jpg');
  assert.equal(json(detailA).webcam.detailUrl, null);
  assert.equal(JSON.stringify(json(detailA)).includes(webSecret), false);
  const forecast = await request('/point-forecast?lat=33.749&lon=-84.391');
  assert.equal(forecast.status, 200);
  const card = json(forecast);
  assert.equal(card.testing, true);
  assert.equal(card.disclaimer, WINDY_TESTING_DISCLAIMER);
  assert.equal(card.lat, 33.75);
  assert.equal(card.lon, -84.39);
  assert.equal(card.steps[0].tempC, 10);
  assert.equal(Math.round(card.steps[0].windMps), 5);
  assert.equal(forecast.body.includes(forecastSecret), false);
  assert.equal(warnings.join('\n').includes(forecastSecret), false);
  assert.equal(
    seen.filter((call) => call.url.includes('/webcams/7')).length,
    2,
  );
  assert.equal(
    seen.some((call) => String(call.url).includes(forecastSecret)),
    false,
  );
  assert.equal(
    seen.some((call) => String(call.body || '').includes('x-windy-api-key')),
    false,
  );
});
