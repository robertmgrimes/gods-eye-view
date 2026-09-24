import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ambiguousGeorgia,
  clampLimit,
  extractWebcamList,
  publicWebcam,
} from './model.js';

const atlanta = {
  id: '64551',
  title: 'Live Atlanta Skyline View: Axis Communications Experience Center',
  location: 'Buckhead, Georgia, United States',
  category: 'youtube',
  trending: false,
  popularity_score: 5,
  thumbnail_url:
    'https://www.webcamexplore.com/storage/webcams/73770549-a7b8-46e1-8d7c-a44ab323fedf_thumb.jpg',
  page_url:
    'https://www.webcamexplore.com/countries/united-states/georgia/buckhead-1/live-atlanta-skyline-view-axis-communications-experience-center',
  is_live: true,
  stream_url: 'https://cdn.example/live.m3u8',
  hls: 'https://cdn.example/live.m3u8',
  latitude: 33.8,
  longitude: -84.4,
  lat: 33.8,
  lon: -84.4,
};

test('public cards keep discovery fields and drop streams and coordinates', () => {
  const card = publicWebcam(atlanta);
  assert.deepEqual(Object.keys(card).sort(), [
    'category',
    'id',
    'is_live',
    'location',
    'page_url',
    'popularity_score',
    'thumbnail_url',
    'title',
    'trending',
  ]);
  assert.equal(card.is_live, true);
  assert.equal(card.page_url, atlanta.page_url);
  assert.equal(JSON.stringify(card).includes('m3u8'), false);
  assert.equal(JSON.stringify(card).includes('latitude'), false);
  assert.equal(
    publicWebcam({ ...atlanta, page_url: 'https://evil.example/cam' }),
    null,
  );
  assert.equal(
    publicWebcam({ ...atlanta, page_url: 'http://www.webcamexplore.com/cam' }),
    null,
  );
  assert.equal(
    publicWebcam({
      ...atlanta,
      thumbnail_url: 'https://cdn.example/thumb.jpg',
    }).thumbnail_url,
    null,
  );
});

test('limits and Georgia stay inside the discovery rules', () => {
  assert.equal(clampLimit(undefined), 10);
  assert.equal(clampLimit(0), 10);
  assert.equal(clampLimit(20), 20);
  assert.equal(clampLimit(50), 20);
  assert.ok(ambiguousGeorgia('Georgia'));
  assert.ok(ambiguousGeorgia('  georgia. '));
  assert.equal(ambiguousGeorgia('Georgia, United States'), null);
  assert.equal(ambiguousGeorgia('Tbilisi, Georgia'), null);
  assert.equal(ambiguousGeorgia('Atlanta'), null);
});

test('tools/call results read structured content, then text', () => {
  assert.deepEqual(
    extractWebcamList({
      result: { structuredContent: { webcams: [atlanta] } },
    }),
    [atlanta],
  );
  assert.deepEqual(
    extractWebcamList({
      result: {
        content: [
          { type: 'text', text: JSON.stringify({ webcams: [atlanta] }) },
        ],
      },
    }).map((row) => row.id),
    ['64551'],
  );
  assert.deepEqual(extractWebcamList({ result: { isError: true } }), []);
});
