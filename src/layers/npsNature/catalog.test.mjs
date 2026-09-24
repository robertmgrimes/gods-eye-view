import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NPS_NATURE_CATALOG,
  YELLOWSTONE_CAMERAS,
  yosemiteConservancyHits,
} from './catalog.js';
import { assertNoYosemiteConservancy, publicCatalog } from './model.js';
import { STILL_REFRESH_MS } from './policy.js';

test('the curated set is ten Yellowstone cameras and three link-outs', () => {
  assert.equal(YELLOWSTONE_CAMERAS.length, 10);
  assert.equal(
    YELLOWSTONE_CAMERAS.filter((row) => row.kind === 'still').length,
    9,
  );
  assert.equal(
    YELLOWSTONE_CAMERAS.find((row) => row.id === 'yell-of-livestream')?.kind,
    'link',
  );
  assert.equal(NPS_NATURE_CATALOG.length, 13);
  assert.equal(STILL_REFRESH_MS >= 60_000, true);
});

test('Yellowstone stills are NPS JPEGs and every pin is approximate', () => {
  for (const camera of YELLOWSTONE_CAMERAS) {
    assert.equal(camera.approximate, true);
    assert.equal(Number.isFinite(camera.latitude), true);
    assert.equal(Number.isFinite(camera.longitude), true);
    if (camera.kind === 'still') {
      assert.match(
        camera.stillUrl,
        /^https:\/\/www\.nps\.gov\/webcams-yell\/[a-z0-9_]+\.jpg$/,
      );
    } else {
      assert.equal(camera.stillUrl, null);
      assert.equal(camera.pageUrl.includes('pixelcaster'), false);
    }
  }
});

test('Yosemite Conservancy cameras stay out of the catalog', () => {
  assert.deepEqual(yosemiteConservancyHits(), []);
  assert.equal(assertNoYosemiteConservancy(), true);
  const published = JSON.stringify(publicCatalog());
  assert.equal(published.includes('yosemite'), false);
  assert.equal(published.includes('pixelcaster'), false);
  assert.equal(published.includes('webcams-yell'), false);
});
