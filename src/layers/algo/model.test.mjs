import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDefaultLayerState,
  decodeLayerStateParams,
  encodeLayerStateParams,
} from '../../data/layerState.js';
import {
  camerasForQuery,
  isAllowedSnapshotUrl,
  normalizeCamera,
  parseBBox,
  parseCameraQuery,
  preferLocalQuery,
  publicCamera,
  queryIntersectsService,
  sameOriginStillUrl,
  stillImageUrl,
} from './model.js';
import {
  LIST_CACHE_TTL_MS,
  STILL_FETCH_CONCURRENCY,
  STILL_REFRESH_MS,
  STILL_WARM_LIMIT,
} from './policy.js';

const mobile = {
  id: 1845,
  accessLevel: 'Public',
  responsibleRegion: 'Southwest',
  location: {
    latitude: 30.535105,
    longitude: -88.23953,
    city: 'Mobile',
    county: 'Mobile',
    displayRouteDesignator: 'I-10',
    displayCrossStreet: 'McDonald Rd',
    direction: 'East',
  },
  snapshotImageUrl: 'https://api.algotraffic.com/v4/Cameras/1845/snapshot.jpg',
  playbackUrls: {
    hls: 'https://cdn3.wowza.com/5/example/mob-cam-c095.stream/playlist.m3u8',
    dash: 'https://cdn3.wowza.com/5/example/mob-cam-c095.stream/manifest.mpd',
  },
  permLink: 'https://www.algotraffic.com?cameraId=1845',
};

test('a Public ALGO camera becomes a pin and keeps only a same-origin still path', () => {
  const camera = normalizeCamera(mobile);
  assert.equal(camera.id, '1845');
  assert.equal(camera.title, 'I-10 @ McDonald Rd');
  assert.equal(camera.city, 'Mobile');
  assert.equal(
    camera.snapshot,
    'https://api.algotraffic.com/v4/Cameras/1845/snapshot.jpg',
  );
  const published = publicCamera(camera);
  assert.equal(published.stillUrl, '/api/algo/webcams/1845/still');
  assert.equal(published.snapshot, undefined);
  const body = JSON.stringify(published);
  assert.equal(body.includes('wowza'), false);
  assert.equal(body.includes('m3u8'), false);
  assert.equal(body.includes('mpd'), false);
  assert.equal(body.includes('algotraffic'), false);
  assert.equal(body.includes('permLink'), false);
});

test('non-public rows and video addresses are dropped', () => {
  assert.equal(
    normalizeCamera({ ...mobile, accessLevel: 'FirstResponder' }),
    null,
  );
  assert.equal(normalizeCamera({ ...mobile, accessLevel: 'ALDOT' }), null);
  assert.equal(normalizeCamera({ ...mobile, accessLevel: 'public' }), null);
  const video = normalizeCamera({
    ...mobile,
    snapshotImageUrl:
      'https://cdn3.wowza.com/5/example/mob-cam.stream/playlist.m3u8',
  });
  assert.equal(video.snapshot, null);
  assert.equal(publicCamera(video).stillUrl, null);
  assert.equal(
    stillImageUrl('https://api.algotraffic.com/v4/Cameras/1845/snapshot.jpg'),
    'https://api.algotraffic.com/v4/Cameras/1845/snapshot.jpg',
  );
  assert.equal(
    stillImageUrl(
      'https://api.algotraffic.com/v4/Cameras/1845/snapshot.jpg?file=playlist.m3u8',
    ),
    null,
  );
  assert.equal(
    isAllowedSnapshotUrl('https://api.algotraffic.com/v4/Cameras/1845/map@1x.jpg'),
    false,
  );
  assert.equal(
    isAllowedSnapshotUrl('https://cdn3.wowza.com/snapshot.jpg'),
    false,
  );
  assert.equal(isAllowedSnapshotUrl('http://api.algotraffic.com/v4/Cameras/1/snapshot.jpg'), false);
  assert.equal(
    sameOriginStillUrl('/api/algo/webcams/1845/still'),
    '/api/algo/webcams/1845/still',
  );
  assert.equal(
    sameOriginStillUrl('https://api.algotraffic.com/v4/Cameras/1845/snapshot.jpg'),
    null,
  );
});

test('views outside Alabama do not intersect the service, and Mobile does', () => {
  const nyc = parseBBox({
    west: -74.1,
    south: 40.6,
    east: -73.9,
    north: 40.9,
  });
  assert.equal(queryIntersectsService(nyc), false);
  const mobileBox = parseBBox({
    west: -88.4,
    south: 30.4,
    east: -88.1,
    north: 30.7,
  });
  assert.equal(queryIntersectsService(mobileBox), true);
  const camera = normalizeCamera(mobile);
  assert.equal(camerasForQuery([camera], mobileBox).length, 1);
  assert.equal(camerasForQuery([camera], nyc).length, 0);
  assert.equal(parseCameraQuery(new URLSearchParams('lat=30.5')), null);
});

test('catalog and still cadences stay inside the handoff windows', () => {
  assert.ok(LIST_CACHE_TTL_MS >= 15 * 60 * 1000);
  assert.ok(LIST_CACHE_TTL_MS <= 60 * 60 * 1000);
  assert.ok(STILL_REFRESH_MS >= 30 * 1000);
  assert.ok(STILL_REFRESH_MS <= 60 * 1000);
  assert.equal(STILL_FETCH_CONCURRENCY, 2);
  assert.ok(STILL_WARM_LIMIT <= 40);
});

test('a whole-globe rectangle falls back to a tight circle around the camera', () => {
  const world = parseBBox({ west: -180, south: -90, east: 180, north: 90 });
  const local = preferLocalQuery(world, { lat: 30.5351, lon: -88.2395 }, 700);
  assert.equal(local.kind, 'nearby');
  assert.equal(local.radiusKm, 2);
});

test('the ALGO layer share hash round-trips on the unused token 6', () => {
  const state = createDefaultLayerState();
  state.enabledLayerIds = [
    'al-algo-webcams',
    'ca-cwwp-webcams',
    'ky-kytc-webcams',
    'windy-webcams',
  ];
  const params = new URLSearchParams('v=2');
  encodeLayerStateParams(params, state);
  assert.equal(params.get('l'), '6.5.4.3');
  const decoded = decodeLayerStateParams(params);
  assert.deepEqual(decoded.enabledLayerIds, [
    'al-algo-webcams',
    'ca-cwwp-webcams',
    'ky-kytc-webcams',
    'windy-webcams',
  ]);
});
