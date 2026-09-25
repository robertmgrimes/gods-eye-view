import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceKm, sortByDistance } from './distance.js';
import { searchCameras } from './fanout.js';
import { createAlgoAdapter } from './adapters/algo.js';
import {
  createGa511Adapter,
  createLa511Adapter,
  createWsdotAdapter,
} from './adapters/futureDot.js';
import { createCameraSearchRegistry } from './index.js';
import { createCwwpAdapter } from './adapters/cwwp.js';

test('distance sort is nearest first and keeps ties in incoming order', () => {
  const origin = { lat: 38.58, lon: -121.49 };
  const hits = [
    { id: 'far', lat: 39.1, lon: -121.49, name: 'Far' },
    { id: 'near', lat: 38.59, lon: -121.49, name: 'Near' },
    { id: 'mid', lat: 38.7, lon: -121.49, name: 'Mid' },
    { id: 'tie', lat: 38.59, lon: -121.49, name: 'Tie' },
  ];
  const sorted = sortByDistance(hits, origin);
  assert.deepEqual(
    sorted.map((hit) => hit.id),
    ['near', 'tie', 'mid', 'far'],
  );
  assert.ok(sorted[0].distanceKm < sorted[2].distanceKm);
  assert.ok(sorted[2].distanceKm < sorted[3].distanceKm);
  assert.ok(distanceKm(origin.lat, origin.lon, 38.59, -121.49) < 2);
});

test('the registry leaves ALGO and keyed stubs off unless the flag or key is set', async () => {
  const calls = [];
  const registry = createCameraSearchRegistry({
    env: {},
    windy: { nearby: async () => ({ webcams: [] }) },
    kytc: { cameras: async () => ({ cameras: [] }) },
    cwwp: { cameras: async () => ({ cameras: [] }) },
    algo: {
      cameras: async () => {
        calls.push('algo');
        return { cameras: [] };
      },
    },
    nps: { cameras: async () => ({ cameras: [] }) },
    webcamExplore: { search: async () => ({ webcams: [] }) },
  });
  const ga = registry.adapters.find((adapter) => adapter.id === 'ga-511');
  const la = registry.adapters.find((adapter) => adapter.id === 'la-511');
  const wsdot = registry.adapters.find((adapter) => adapter.id === 'wsdot');
  const algo = registry.adapters.find((adapter) => adapter.id === 'algo');
  assert.equal(algo.enabled(), false);
  assert.equal(ga.enabled(), false);
  assert.equal(la.enabled(), false);
  assert.equal(wsdot.enabled(), false);
  const result = await registry.search({ lat: 38.5, lon: -121.4, query: '' });
  assert.deepEqual(calls, []);
  for (const id of ['algo', 'ga-511', 'la-511', 'wsdot']) {
    assert.equal(
      result.statuses.find((row) => row.id === id).status,
      'disabled',
    );
  }
  assert.equal(
    createAlgoAdapter({ env: { GEV_ALGO_CAMERAS: '1' } }).enabled(),
    true,
  );
  assert.equal(
    createGa511Adapter({ env: { DOT_GA_511_API_KEY: 'present' } }).enabled(),
    true,
  );
  assert.equal(
    createLa511Adapter({ env: { DOT_LA_511_API_KEY: 'present' } }).enabled(),
    true,
  );
  assert.equal(
    createWsdotAdapter({ env: { WSDOT_ACCESS_CODE: 'present' } }).enabled(),
    true,
  );
  const keyed = createGa511Adapter({
    env: { DOT_GA_511_API_KEY: 'secret-value' },
  });
  const empty = await keyed.searchNear({
    lat: 1,
    lon: 2,
    radiusKm: 10,
    limit: 1,
  });
  assert.deepEqual(empty, []);
  assert.equal(JSON.stringify(empty).includes('secret-value'), false);
});

test('a slow source times out without dropping results that already arrived', async () => {
  const updates = [];
  const fast = {
    id: 'fast',
    label: 'Fast',
    badge: 'FAST',
    enabled: () => true,
    async searchNear() {
      return [
        {
          id: 'fast-1',
          source: 'fast',
          name: 'Fast camera',
          lat: 38.58,
          lon: -121.5,
          stillUrl: '/api/cwwp/webcams/d03-1/still',
          pageUrl: null,
        },
      ];
    },
  };
  const slow = {
    id: 'slow',
    label: 'Slow',
    badge: 'SLOW',
    enabled: () => true,
    searchNear({ signal }) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve([
            {
              id: 'slow-1',
              source: 'slow',
              name: 'Late',
              lat: 38.58,
              lon: -121.49,
              stillUrl: null,
              pageUrl: null,
            },
          ]);
        }, 250);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    },
  };
  const result = await searchCameras(
    { adapters: [slow, fast] },
    {
      lat: 38.58,
      lon: -121.49,
      timeoutMs: 40,
      onUpdate: (partial) => updates.push(partial.near.map((hit) => hit.id)),
    },
  );
  assert.deepEqual(
    result.near.map((hit) => hit.id),
    ['fast-1'],
  );
  assert.equal(result.statuses.find((row) => row.id === 'fast').status, 'ok');
  assert.equal(
    result.statuses.find((row) => row.id === 'slow').status,
    'timed out',
  );
  assert.ok(
    updates.some((ids) => ids.includes('fast-1') && !ids.includes('slow-1')),
  );
});

test('name-only matches stay in the By name section', async () => {
  const geo = {
    id: 'cwwp',
    label: 'Caltrans',
    badge: 'CALTRANS',
    enabled: () => true,
    async searchNear() {
      return [
        {
          id: 'd03-1',
          source: 'cwwp',
          name: 'Sacramento',
          lat: 38.58,
          lon: -121.49,
          stillUrl: '/api/cwwp/webcams/d03-1/still',
          pageUrl: null,
        },
      ];
    },
  };
  const explore = {
    id: 'webcam-explore',
    label: 'Webcam Explore',
    badge: 'EXPLORE',
    enabled: () => true,
    async searchByName() {
      return [
        {
          id: 'explore-1',
          source: 'webcam-explore',
          name: 'Sacramento river',
          stillUrl: 'https://www.webcamexplore.com/thumb.jpg',
          pageUrl: 'https://www.webcamexplore.com/webcams/explore-1',
          lat: 10,
          lon: 10,
        },
      ];
    },
  };
  const result = await searchCameras(
    { adapters: [geo, explore] },
    { lat: 38.58, lon: -121.49, query: 'Sacramento' },
  );
  assert.deepEqual(
    result.near.map((hit) => hit.id),
    ['d03-1'],
  );
  assert.deepEqual(
    result.byName.map((hit) => hit.id),
    ['explore-1'],
  );
  assert.equal(result.byName[0].lat, undefined);
  assert.equal(
    result.statuses.find((row) => row.id === 'webcam-explore').status,
    'ok',
  );
});

test('Sacramento search returns Caltrans rows from the nearby districts', async () => {
  const calls = [];
  const adapter = createCwwpAdapter({
    source: {
      async cameras(query) {
        calls.push(query.district ?? null);
        if (query.district !== 3) return { cameras: [] };
        return {
          cameras: [
            {
              id: 'd03-9',
              title: 'US 50 at Sacramento',
              latitude: 38.58,
              longitude: -121.49,
              stillUrl: '/api/cwwp/webcams/d03-9/still',
            },
          ],
        };
      },
    },
  });
  const result = await searchCameras(
    { adapters: [adapter] },
    { lat: 38.58, lon: -121.49, query: 'Sacramento' },
  );
  assert.ok(calls.includes(3));
  assert.ok(!calls.includes(7));
  assert.equal(result.near[0]?.source, 'cwwp');
  assert.equal(result.near[0]?.name, 'US 50 at Sacramento');
  assert.equal(result.statuses.find((row) => row.id === 'cwwp').status, 'ok');
});
