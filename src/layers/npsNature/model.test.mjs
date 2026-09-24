import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAllowedNpsStillUrl,
  publicCamera,
  publicCatalog,
  sameOriginStillUrl,
} from './model.js';

test('only the NPS Yellowstone JPEG host is fetchable', () => {
  assert.equal(
    isAllowedNpsStillUrl('https://www.nps.gov/webcams-yell/mammoth_arch.jpg'),
    true,
  );
  assert.equal(
    isAllowedNpsStillUrl(
      'https://www.nps.gov/webcams-yell/mammoth_arch.jpg?x=1',
    ),
    false,
  );
  assert.equal(
    isAllowedNpsStillUrl(
      'https://pixelcaster.com/live/yellowstone/stream.m3u8',
    ),
    false,
  );
  assert.equal(
    isAllowedNpsStillUrl('https://yosemite.org/webcams/yosemite-falls/'),
    false,
  );
  assert.equal(isAllowedNpsStillUrl('https://explore.org/livecams'), false);
});

test('public records hide upstream JPEGs and keep official page links', () => {
  const cameras = publicCatalog();
  const north = cameras.find((row) => row.id === 'yell-north-out');
  const faithful = cameras.find((row) => row.id === 'yell-of-livestream');
  const explore = cameras.find((row) => row.id === 'explore-org');
  assert.equal(north.stillUrl, '/api/nps-nature/cameras/yell-north-out/still');
  assert.equal(north.approximate, true);
  assert.equal(north.pin, true);
  assert.equal(faithful.stillUrl, null);
  assert.equal(faithful.kind, 'link');
  assert.equal(faithful.pin, true);
  assert.equal(explore.pin, false);
  assert.equal(explore.pageUrl, 'https://explore.org/livecams');
  assert.equal(JSON.stringify(cameras).includes('webcams-yell'), false);
  assert.equal(
    sameOriginStillUrl('/api/nps-nature/cameras/yell-north-out/still'),
    '/api/nps-nature/cameras/yell-north-out/still',
  );
  assert.equal(
    sameOriginStillUrl(
      '/api/nps-nature/cameras/yell-north-out/still?t=1700000000000',
    ),
    '/api/nps-nature/cameras/yell-north-out/still?t=1700000000000',
  );
  assert.equal(
    sameOriginStillUrl('https://www.nps.gov/webcams-yell/mammoth_arch.jpg'),
    null,
  );
  assert.equal(
    publicCamera({
      id: 'nope',
      name: 'Nope',
      kind: 'still',
      stillUrl: 'https://yosemite.org/a.jpg',
    }),
    null,
  );
});
