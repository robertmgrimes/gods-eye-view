import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWebcamExploreLayer } from './index.js';
import { createWebcamExplorePanel } from '../../ui/webcamExplore.js';
import { railFixture } from '../../ui/railTestFixture.mjs';

const page =
  'https://www.webcamexplore.com/countries/united-states/georgia/buckhead-1/live-atlanta-skyline-view-axis-communications-experience-center';
const thumb =
  'https://www.webcamexplore.com/storage/webcams/73770549-a7b8-46e1-8d7c-a44ab323fedf_thumb.jpg';

function sample() {
  return {
    id: '64551',
    title: 'Live Atlanta Skyline View',
    location: 'Buckhead, Georgia, United States',
    category: 'youtube',
    trending: false,
    popularity_score: 5,
    thumbnail_url: thumb,
    page_url: page,
    is_live: true,
    stream_url: 'https://cdn.example/master.m3u8',
    latitude: 33.8,
    longitude: -84.4,
  };
}

function source(calls) {
  return {
    async search({ query }) {
      calls.push(['search', query]);
      return { webcams: [sample()] };
    },
    async trending() {
      calls.push(['trending']);
      return { webcams: [] };
    },
    async popular() {
      calls.push(['popular']);
      return { webcams: [] };
    },
    async byCategory({ category }) {
      calls.push(['category', category]);
      return { webcams: [] };
    },
  };
}

test('the layer does not poll and does not keep stream fields', () => {
  const file = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
  assert.equal(file.includes('setInterval'), false);
  const layer = createWebcamExploreLayer({
    source: { search() {}, trending() {}, popular() {}, byCategory() {} },
  });
  assert.notEqual(layer.update(), false);
  assert.equal(file.includes('m3u8'), false);
  assert.equal(file.includes('CustomDataSource'), false);
});

test('search renders a thumbnail card that opens the Webcam Explore page', async () => {
  const calls = [];
  const layer = createWebcamExploreLayer({ source: source(calls) });
  layer.enable();
  const f = railFixture();
  const panel = createWebcamExplorePanel({
    container: f.container,
    layer,
  });
  const input = f.find((node) => node.className === 'webcam-explore-query');
  const form = f.find((node) => node.className === 'webcam-explore-form');
  input.value = 'Atlanta';
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(calls, [['search', 'Atlanta']]);
  const card = f.find((node) => node.className === 'webcam-explore-card');
  const image = f.find((node) => node.className === 'webcam-explore-thumb');
  const open = f.find((node) => node.className === 'webcam-explore-open');
  const live = f.find((node) =>
    node.className?.includes('webcam-explore-live'),
  );
  assert.equal(image.src, thumb);
  assert.equal(open.href, page);
  assert.equal(open.target, '_blank');
  assert.equal(open.rel, 'noopener noreferrer');
  assert.equal(live.textContent, 'LIVE');
  assert.equal(card.textContent.includes('m3u8'), false);
  assert.equal(JSON.stringify(layer.getSnapshot()).includes('latitude'), false);
  panel.destroy();
});

test('bare Georgia asks for a choice and does not call the source', async () => {
  const calls = [];
  const layer = createWebcamExploreLayer({ source: source(calls) });
  layer.enable();
  const f = railFixture();
  createWebcamExplorePanel({ container: f.container, layer });
  await layer.search('Georgia');
  assert.deepEqual(calls, []);
  const choice = f.find((node) => node.dataset.choice === 'us');
  assert.equal(choice.textContent, 'Georgia, United States');
  choice.click();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(calls, [['search', 'Georgia, United States']]);
});
