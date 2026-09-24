import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDefaultLayerState,
  decodeLayerStateParams,
  encodeLayerStateParams,
} from '../../data/layerState.js';
import {
  cameraInQuery,
  camerasForQuery,
  isAllowedSnapshotUrl,
  normalizeCamera,
  parseBBox,
  parseCameraQuery,
  parseNearby,
  publicCamera,
  queryIntersectsService,
  sameOriginStillUrl,
  stillImageUrl,
} from './model.js';

const louisville = {
  attributes: {
    OBJECTID: 2,
    name: null,
    description: 'I-65 at Spaghetti Junction',
    highway: 'I-65',
    direction: 'North',
    county: 'Jefferson',
    district: 5,
    status: 'OK',
    state: 'KY',
    latitude: 38.25933,
    longitude: -85.74119,
    snapshot: 'http://www.trimarc.org/images/milestone/CCTV_05_65_1365.jpg',
    updateTS: 1621047617000,
  },
};

test('a KYTC feature becomes a pin and keeps only a public still path', () => {
  const camera = normalizeCamera(louisville);
  assert.equal(camera.id, '2');
  assert.equal(camera.title, 'I-65 at Spaghetti Junction');
  assert.equal(camera.district, '5');
  assert.equal(
    camera.snapshot,
    'http://www.trimarc.org/images/milestone/CCTV_05_65_1365.jpg',
  );
  const published = publicCamera(camera);
  assert.equal(published.stillUrl, '/api/kytc/webcams/2/still');
  assert.equal(published.snapshot, undefined);
  assert.equal(JSON.stringify(published).includes('trimarc'), false);
});

test('stills accept http and https images and refuse video', () => {
  assert.equal(
    stillImageUrl('https://cam.example/snap.jpg'),
    'https://cam.example/snap.jpg',
  );
  assert.equal(
    stillImageUrl('http://www.trimarc.org/a.jpg'),
    'http://www.trimarc.org/a.jpg',
  );
  assert.equal(stillImageUrl('http://cam.example/live.m3u8'), null);
  assert.equal(stillImageUrl('https://cam.example/hls/index.m3u8'), null);
  assert.equal(stillImageUrl('https://cam.example/clip.mp4'), null);
  assert.equal(stillImageUrl('javascript:alert(1)'), null);
  assert.equal(isAllowedSnapshotUrl('http://127.0.0.1/a.jpg'), false);
  assert.equal(isAllowedSnapshotUrl('http://10.1.2.3/a.jpg'), false);
  assert.equal(isAllowedSnapshotUrl('http://localhost/a.jpg'), false);
  assert.equal(isAllowedSnapshotUrl('http://169.254.169.254/a.jpg'), false);
  assert.equal(
    isAllowedSnapshotUrl('http://user:pass@cam.example/a.jpg'),
    false,
  );
  assert.equal(
    sameOriginStillUrl('/api/kytc/webcams/2/still'),
    '/api/kytc/webcams/2/still',
  );
  assert.equal(
    sameOriginStillUrl('/api/kytc/webcams/2/still?t=1'),
    '/api/kytc/webcams/2/still?t=1',
  );
  assert.equal(sameOriginStillUrl('http://www.trimarc.org/a.jpg'), null);
  assert.equal(sameOriginStillUrl('/api/windy/webcams/2'), null);
});

test('views outside Kentucky do not intersect the service, and Louisville does', () => {
  const louisvilleBox = parseBBox({
    west: -85.9,
    south: 38.1,
    east: -85.6,
    north: 38.4,
  });
  const tokyo = parseBBox({ west: 139, south: 35, east: 140, north: 36 });
  const nyc = parseNearby({ lat: 40.71, lon: -74, radiusKm: 40 });
  assert.equal(queryIntersectsService(louisvilleBox), true);
  assert.equal(queryIntersectsService(tokyo), false);
  assert.equal(queryIntersectsService(nyc), false);
  assert.equal(
    queryIntersectsService(parseNearby({ lat: 39.96, lon: -83, radiusKm: 30 })),
    false,
  );
  const params = new URLSearchParams(
    'west=-85.9&south=38.1&east=-85.6&north=38.4&lat=38',
  );
  assert.equal(parseCameraQuery(params), null);
  assert.equal(parseCameraQuery(new URLSearchParams('lat=10')), null);
  assert.equal(parseBBox({ west: -85, south: 40, east: -84, north: 39 }), null);
});

test('a view box and a nearby circle keep only the cameras inside them', () => {
  const inTown = normalizeCamera(louisville);
  const away = normalizeCamera({
    ...louisville.attributes,
    OBJECTID: 8,
    latitude: 40.71,
    longitude: -74,
    description: 'not Kentucky',
  });
  const box = parseBBox({ west: -86, south: 38, east: -85.5, north: 38.5 });
  assert.deepEqual(
    camerasForQuery([inTown, away], box).map((camera) => camera.id),
    ['2'],
  );
  assert.equal(
    cameraInQuery(
      inTown,
      parseNearby({ lat: 38.26, lon: -85.74, radiusKm: 5 }),
    ),
    true,
  );
  assert.equal(
    cameraInQuery(away, parseNearby({ lat: 38.26, lon: -85.74, radiusKm: 5 })),
    false,
  );
  const pacific = parseBBox({ west: 170, south: -10, east: -170, north: 10 });
  assert.equal(cameraInQuery(inTown, pacific), false);
});

test('the KYTC layer share hash round-trips on the unused token 4', () => {
  const state = createDefaultLayerState();
  state.enabledLayerIds = ['ky-kytc-webcams', 'windy-webcams'];
  const params = new URLSearchParams('v=2');
  encodeLayerStateParams(params, state);
  assert.equal(params.get('l'), '4.3');
  const decoded = decodeLayerStateParams(params);
  assert.deepEqual(decoded.enabledLayerIds, [
    'ky-kytc-webcams',
    'windy-webcams',
  ]);
});
