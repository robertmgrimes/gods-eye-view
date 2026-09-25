import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDefaultLayerState,
  decodeLayerStateParams,
  encodeLayerStateParams,
} from '../../data/layerState.js';
import {
  cameraId,
  cameraInQuery,
  camerasForQuery,
  districtStatusUrl,
  districtsForQuery,
  groundFootprintKm,
  isAllowedSnapshotUrl,
  normalizeCamera,
  parseBBox,
  parseCameraQuery,
  parseNearby,
  parseStillIds,
  preferLocalQuery,
  publicCamera,
  queryIntersectsService,
  sameOriginStillUrl,
  stillImageUrl,
} from './model.js';
import {
  DISTRICT_FETCH_CONCURRENCY,
  LIST_CACHE_TTL_MS,
  MAX_CAMERAS,
  STILL_FETCH_CONCURRENCY,
  STILL_REFRESH_MS,
  STILL_WARM_LIMIT,
  stillRefreshMs,
} from './policy.js';

const avenue26 = {
  cctv: {
    index: '1',
    recordTimestamp: { recordEpoch: '1715124427' },
    location: {
      district: '7',
      locationName: 'I-110 : (196) Avenue 26 Off Ramp',
      nearbyPlace: 'Cypress Park',
      longitude: '-118.2215',
      latitude: '34.0837',
      elevation: '95',
      direction: 'South',
      county: 'Los Angeles',
      route: 'I-110',
    },
    inService: 'true',
    imageData: {
      streamingVideoURL:
        'https://wzmedia.dot.ca.gov/D7/CCTV-196.stream/playlist.m3u8',
      static: {
        currentImageUpdateFrequency: '2',
        currentImageURL:
          'https://cwwp2.dot.ca.gov/data/d7/cctv/image/i110196avenue26offramp/i110196avenue26offramp.jpg',
      },
    },
  },
};

test('a CWWP record becomes a pin and keeps only a public still path', () => {
  const camera = normalizeCamera(avenue26, 7);
  assert.equal(camera.id, 'd07-1');
  assert.equal(camera.title, 'I-110 : (196) Avenue 26 Off Ramp');
  assert.equal(camera.district, '7');
  assert.equal(camera.place, 'Cypress Park');
  assert.equal(camera.latitude, 34.0837);
  assert.equal(camera.longitude, -118.2215);
  assert.equal(camera.elevationMeters, 95);
  assert.equal(camera.updateFrequencyMinutes, 2);
  assert.match(camera.snapshot, /^https:\/\/cwwp2\.dot\.ca\.gov\//);
  const published = publicCamera(camera);
  assert.equal(published.elevationMeters, 95);
  assert.equal(published.stillUrl, '/api/cwwp/webcams/d07-1/still');
  assert.equal(published.snapshot, undefined);
  assert.equal(JSON.stringify(published).includes('cwwp2.dot.ca.gov'), false);
  assert.equal(JSON.stringify(published).includes('wzmedia'), false);
  assert.equal(JSON.stringify(published).includes('m3u8'), false);
});

test('out of service cameras and repeated indexes stay distinct', () => {
  assert.equal(
    normalizeCamera(
      { ...avenue26, cctv: { ...avenue26.cctv, inService: 'false' } },
      7,
    ),
    null,
  );
  assert.equal(
    normalizeCamera(
      { ...avenue26, cctv: { ...avenue26.cctv, inService: true } },
      7,
    ),
    null,
  );
  assert.equal(cameraId(7, '1'), 'd07-1');
  assert.equal(cameraId(12, '1'), 'd12-1');
  assert.equal(normalizeCamera(avenue26, 12).id, 'd12-1');
  assert.equal(cameraId(0, '1'), null);
  assert.equal(cameraId(7, 'cam'), null);
});

test('stills accept only CWWP https images and refuse video and other hosts', () => {
  const jpg = 'https://cwwp2.dot.ca.gov/data/d7/cctv/image/cam/cam.jpg';
  assert.equal(stillImageUrl(jpg), jpg);
  assert.equal(isAllowedSnapshotUrl(jpg), true);
  assert.equal(
    isAllowedSnapshotUrl(
      'http://cwwp2.dot.ca.gov/data/d7/cctv/image/cam/cam.jpg',
    ),
    false,
  );
  assert.equal(
    isAllowedSnapshotUrl(
      'https://wzmedia.dot.ca.gov/D7/CCTV-1.stream/playlist.m3u8',
    ),
    false,
  );
  assert.equal(
    isAllowedSnapshotUrl(
      'https://cwwp2.dot.ca.gov/data/d7/cctv/cctvStatusD07.json',
    ),
    false,
  );
  assert.equal(isAllowedSnapshotUrl('https://example.com/cam.jpg'), false);
  assert.equal(isAllowedSnapshotUrl('https://127.0.0.1/cam.jpg'), false);
  assert.equal(
    sameOriginStillUrl('/api/cwwp/webcams/d07-1/still'),
    '/api/cwwp/webcams/d07-1/still',
  );
  assert.equal(
    sameOriginStillUrl('/api/cwwp/webcams/d07-1/still?t=1'),
    '/api/cwwp/webcams/d07-1/still?t=1',
  );
  assert.equal(sameOriginStillUrl(jpg), null);
  assert.equal(sameOriginStillUrl('/api/kytc/webcams/2/still'), null);
  assert.equal(
    districtStatusUrl(7),
    'https://cwwp2.dot.ca.gov/data/d7/cctv/cctvStatusD07.json',
  );
  assert.equal(
    districtStatusUrl(10),
    'https://cwwp2.dot.ca.gov/data/d10/cctv/cctvStatusD10.json',
  );
  assert.equal(districtStatusUrl(13), null);
});

test('views outside California do not intersect the service, and Los Angeles does', () => {
  const losAngeles = parseBBox({
    west: -118.5,
    south: 33.9,
    east: -118.1,
    north: 34.2,
  });
  const tokyo = parseBBox({ west: 139, south: 35, east: 140, north: 36 });
  const nyc = parseNearby({ lat: 40.71, lon: -74, radiusKm: 40 });
  assert.equal(queryIntersectsService(losAngeles), true);
  assert.equal(queryIntersectsService(tokyo), false);
  assert.equal(queryIntersectsService(nyc), false);
  const params = new URLSearchParams(
    'west=-118.5&south=33.9&east=-118.1&north=34.2&lat=34',
  );
  assert.equal(parseCameraQuery(params), null);
  assert.equal(parseCameraQuery(new URLSearchParams('lat=34')), null);
});

test('a crowded view keeps the cameras nearest the center', () => {
  const cameras = [];
  for (let index = 1; index <= MAX_CAMERAS + 5; index += 1) {
    cameras.push(
      normalizeCamera(
        {
          cctv: {
            ...avenue26.cctv,
            index: String(index),
            location: {
              ...avenue26.cctv.location,
              latitude: String(34 + index * 0.01),
              longitude: '-118.22',
            },
          },
        },
        7,
      ),
    );
  }
  const box = parseBBox({ west: -119, south: 33, east: -117, north: 42 });
  const kept = camerasForQuery(cameras, box);
  assert.equal(kept.length, MAX_CAMERAS);
  const centerLat = (box.south + box.north) / 2;
  const nearest = [...cameras].sort(
    (a, b) =>
      Math.abs(a.latitude - centerLat) - Math.abs(b.latitude - centerLat),
  )[0];
  assert.equal(kept[0].id, nearest.id);
  assert.equal(
    cameraInQuery(
      cameras[0],
      parseNearby({ lat: 34.01, lon: -118.22, radiusKm: 5 }),
    ),
    true,
  );
});

test('still refresh ids stay district-scoped, unique, and capped', () => {
  assert.deepEqual(parseStillIds('d07-1, d07-2,d07-1,2,nope,d12-9'), [
    'd07-1',
    'd07-2',
    'd12-9',
  ]);
  assert.deepEqual(parseStillIds(''), []);
  assert.deepEqual(parseStillIds(null), []);
});

test('catalog and still cadence stay inside the handoff bounds', () => {
  assert.ok(LIST_CACHE_TTL_MS >= 5 * 60 * 1000);
  assert.ok(LIST_CACHE_TTL_MS <= 15 * 60 * 1000);
  assert.equal(STILL_REFRESH_MS, 2 * 60 * 1000);
  assert.equal(stillRefreshMs(2), 2 * 60 * 1000);
  assert.equal(stillRefreshMs(60), 60 * 60 * 1000);
  assert.equal(stillRefreshMs(1), 2 * 60 * 1000);
  assert.equal(STILL_FETCH_CONCURRENCY, 2);
  assert.ok(DISTRICT_FETCH_CONCURRENCY >= 1);
  assert.ok(DISTRICT_FETCH_CONCURRENCY <= 4);
  assert.ok(STILL_WARM_LIMIT >= 1);
  assert.ok(STILL_WARM_LIMIT <= 40);
});

test('a whole-globe rectangle falls back to a tight circle around the camera', () => {
  const world = parseBBox({ west: -180, south: -90, east: 180, north: 90 });
  const local = preferLocalQuery(world, { lat: 34.0837, lon: -118.2215 }, 700);
  assert.equal(local.kind, 'nearby');
  assert.equal(local.radiusKm, 2);
  const metro = parseBBox({
    west: -118.5,
    south: 33.9,
    east: -118.1,
    north: 34.2,
  });
  assert.equal(
    preferLocalQuery(metro, { lat: 34.05, lon: -118.25 }, 700),
    metro,
  );
});

test('an oblique Los Angeles view is a capped circle, not the horizon box', () => {
  const horizon = parseBBox({
    west: -125,
    south: 32,
    east: -114,
    north: 42,
  });
  const pitch = -35 * (Math.PI / 180);
  const query = preferLocalQuery(
    horizon,
    { lat: 34.05, lon: -118.24 },
    40000,
    pitch,
  );
  assert.equal(query.kind, 'nearby');
  assert.equal(query.lat, 34.05);
  assert.equal(query.lon, -118.24);
  assert.ok(query.radiusKm <= 50);
  assert.equal(groundFootprintKm(40000, pitch), query.radiusKm);
  const districts = districtsForQuery(query);
  assert.ok(districts.includes(7));
  assert.ok(!districts.includes(3));
  assert.ok(!districts.includes(4));
  assert.ok(districts.length < 12);
  const nadir = preferLocalQuery(
    parseBBox({ west: -118.5, south: 33.9, east: -118.1, north: 34.2 }),
    { lat: 34.05, lon: -118.24 },
    40000,
    -89 * (Math.PI / 180),
  );
  assert.equal(nadir.kind, 'bbox');
});

test('Sacramento search only needs the nearby Caltrans districts', () => {
  const query = parseNearby({ lat: 38.58, lon: -121.49, radiusKm: 40 });
  const districts = districtsForQuery(query);
  assert.ok(districts.includes(3));
  assert.ok(!districts.includes(7));
  assert.ok(!districts.includes(11));
  assert.ok(districts.length <= 4);
});

test('the Caltrans layer share hash round-trips on the unused token 5', () => {
  const state = createDefaultLayerState();
  state.enabledLayerIds = [
    'ca-cwwp-webcams',
    'ky-kytc-webcams',
    'windy-webcams',
  ];
  const params = new URLSearchParams('v=2');
  encodeLayerStateParams(params, state);
  assert.equal(params.get('l'), '5.4.3');
  const decoded = decodeLayerStateParams(params);
  assert.deepEqual(decoded.enabledLayerIds, [
    'ca-cwwp-webcams',
    'ky-kytc-webcams',
    'windy-webcams',
  ]);
});
