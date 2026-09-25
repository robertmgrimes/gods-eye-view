import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IMAGE_URL_MAX_AGE_MS,
  NEARBY_RADIUS_KM,
  REQUEST_DEBOUNCE_MS,
} from './policy.js';
import {
  WINDY_TESTING_DISCLAIMER,
  extractWebcamList,
  imageUrlFresh,
  normalizeWebcam,
  parseForecastPoint,
  parseNearbyQuery,
  scrubSecrets,
  stillImageUrl,
  summarizePointForecast,
  windFromDegrees,
} from './model.js';
import {
  createDefaultLayerState,
  decodeLayerStateParams,
  encodeLayerStateParams,
} from '../../data/layerState.js';

test('nearby queries start at 50 km and refuse poles past the edge', () => {
  assert.equal(NEARBY_RADIUS_KM, 50);
  assert.ok(REQUEST_DEBOUNCE_MS >= 300 && REQUEST_DEBOUNCE_MS <= 500);
  assert.deepEqual(parseNearbyQuery({ lat: '33.749', lon: '-84.388' }), {
    lat: 33.749,
    lon: -84.388,
    radiusKm: 50,
  });
  assert.equal(parseNearbyQuery({ lat: 91, lon: 0 }), null);
  assert.equal(parseNearbyQuery({ lat: 1, lon: 2, radiusKm: 0 }), null);
  assert.deepEqual(parseForecastPoint({ lat: 33.7491, lon: -84.3882 }), {
    lat: 33.75,
    lon: -84.39,
  });
});

test('stills are https images and expire before the free-tier token', () => {
  const now = 1_700_000_000_000;
  assert.equal(
    stillImageUrl('https://images.windy.com/preview.jpg?token=abc'),
    'https://images.windy.com/preview.jpg?token=abc',
  );
  assert.equal(stillImageUrl('http://images.windy.com/preview.jpg'), null);
  assert.equal(
    stillImageUrl('https://images.windy.com/live/playlist.m3u8'),
    null,
  );
  assert.equal(stillImageUrl('https://cdn.example/hls/stream'), null);
  assert.equal(imageUrlFresh(now, now + IMAGE_URL_MAX_AGE_MS - 1), true);
  assert.equal(imageUrlFresh(now, now + IMAGE_URL_MAX_AGE_MS), false);
  assert.equal(imageUrlFresh(now + 10 * 60_000, now), false);
});

test('webcam records keep a pin and a page link, and drop video urls', () => {
  const webcam = normalizeWebcam(
    {
      webcamId: 42,
      title: '  Atlanta  cam ',
      status: 'active',
      location: { latitude: 33.75, longitude: -84.39, city: 'Atlanta' },
      images: {
        current: {
          preview: 'https://images.windy.com/a.jpg',
          thumbnail: 'https://images.windy.com/live.m3u8',
        },
      },
      urls: { detail: 'https://www.windy.com/webcams/42' },
    },
    { includeImages: true, now: 10_000 },
  );
  assert.equal(webcam.id, '42');
  assert.equal(webcam.title, 'Atlanta cam');
  assert.equal(webcam.preview, 'https://images.windy.com/a.jpg');
  assert.equal(webcam.thumbnail, null);
  assert.equal(webcam.detailUrl, 'https://www.windy.com/webcams/42');
  assert.equal(webcam.imagesAt, 10_000);
  const listed = normalizeWebcam(
    {
      webcamId: 42,
      location: { latitude: 1, longitude: 2 },
      images: { current: { preview: 'https://images.windy.com/a.jpg' } },
    },
    { includeImages: false },
  );
  assert.equal(listed.preview, null);
  assert.equal(listed.imagesAt, null);
  assert.equal(
    normalizeWebcam({
      webcamId: 'nope',
      location: { latitude: 1, longitude: 2 },
    }),
    null,
  );
  assert.deepEqual(extractWebcamList({ webcams: [{ webcamId: 1 }] }).length, 1);
});

test('point forecast converts Kelvin and wind components and always labels testing data', () => {
  assert.equal(windFromDegrees(0, -5), 0);
  assert.equal(windFromDegrees(5, 0), 270);
  const summary = summarizePointForecast(
    {
      ts: [1_700_000_000],
      units: {
        'temp-surface': 'K',
        'pressure-surface': 'Pa',
        'precip-surface': 'mm',
      },
      'temp-surface': [293.15],
      'wind_u-surface': [0],
      'wind_v-surface': [-3],
      'gust-surface': [5],
      'pressure-surface': [101325],
      'precip-surface': [1.5],
      key: 'must-not-survive',
    },
    { lat: 33.75, lon: -84.39 },
    { fetchedAt: 50 },
  );
  assert.equal(summary.testing, true);
  assert.equal(summary.disclaimer, WINDY_TESTING_DISCLAIMER);
  assert.match(summary.disclaimer, /testing\/demo data/i);
  assert.equal(summary.steps[0].tempC, 20);
  assert.equal(summary.steps[0].windMps, 3);
  assert.equal(summary.steps[0].windFromDeg, 0);
  assert.equal(summary.steps[0].pressureHpa, 1013.25);
  assert.equal(summary.steps[0].precipMm, 1.5);
  assert.equal(summary.key, undefined);
});

test('scrubbing removes a key that upstream echoed into a string or field', () => {
  const secret = 'windy-secret-value';
  const clean = scrubSecrets(
    {
      key: secret,
      title: `cam ${secret}`,
      images: { current: { preview: `https://cdn.example/${secret}.jpg` } },
      ok: 'plain',
    },
    [secret],
  );
  assert.equal(clean.key, undefined);
  assert.equal(clean.title, '');
  assert.equal(clean.images.current.preview, '');
  assert.equal(clean.ok, 'plain');
  assert.equal(JSON.stringify(clean).includes(secret), false);
});

test('the webcam layer share hash round-trips on the unused token 3', () => {
  const state = createDefaultLayerState();
  state.enabledLayerIds = ['windy-webcams'];
  const params = new URLSearchParams('v=2');
  encodeLayerStateParams(params, state);
  assert.equal(params.get('l'), '3');
  const decoded = decodeLayerStateParams(params);
  assert.deepEqual(decoded.enabledLayerIds, ['windy-webcams']);
});
