import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCwwpDiskCache } from '../../server/providers/cwwpDiskCache.js';
import { cwwpProxy } from '../../server/providers/cwwp.js';
import { createCwwpWebcamsLayer } from '../layers/cwwp/index.js';
import { createCwwpAdapter } from '../search/cameras/adapters/cwwp.js';
import { searchCameras } from '../search/cameras/fanout.js';
import * as Cesium from 'cesium';

const cameras = [
  {
    id: 'd07-1',
    title: 'LA',
    latitude: 34.05,
    longitude: -118.24,
    snapshot: 'https://cwwp2.dot.ca.gov/data/d7/cctv/image/cam/a.jpg',
  },
];

async function tempCache(now = () => Date.now()) {
  const dir = await mkdtemp(path.join(tmpdir(), 'gev-caltrans-'));
  const cache = createCwwpDiskCache({ dir, now });
  return { dir, cache };
}

test('a district file older than a day is discarded, not served', async () => {
  let clock = Date.now();
  const { dir, cache } = await tempCache(() => clock);
  try {
    await cache.write(7, cameras, clock);
    clock += 25 * 60 * 60 * 1000;
    assert.equal(await cache.read(7), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the disk cache evicts the oldest district files past the size cap', async () => {
  const { dir, cache } = await tempCache();
  const tiny = createCwwpDiskCache({
    dir,
    maxBytes: 180,
    now: () => Date.now(),
  });
  try {
    await tiny.write(9, [{ id: 'd09-1', title: 'a' }]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await tiny.write(10, [{ id: 'd10-1', title: 'b' }]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await tiny.write(7, cameras);
    assert.equal(await tiny.read(9), null);
    assert.ok(await tiny.read(7));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a corrupt district file is ignored', async () => {
  const { dir, cache } = await tempCache();
  try {
    await writeFile(path.join(dir, 'd07.json'), '{not json', 'utf8');
    assert.equal(await cache.read(7), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the Caltrans cache directory is gitignored', async () => {
  const ignore = await readFile(
    new URL('../../.gitignore', import.meta.url),
    'utf8',
  );
  assert.match(ignore, /^\.cache\/$/m);
});

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

test('a warm cache answers while a 9s district refresh is still running', async (t) => {
  const { dir, cache } = await tempCache();
  let fetches = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    fetches += 1;
    await new Promise((resolve) => setTimeout(resolve, 9000));
    return Response.json({ data: [] });
  });
  try {
    await cache.write(7, cameras);
    const request = install(cwwpProxy({ disk: cache, warm: false }));
    const started = Date.now();
    const res = await request(
      '/webcams?lat=34.05&lon=-118.24&radiusKm=40&district=7',
    );
    const body = JSON.parse(res.body);
    assert.ok(Date.now() - started < 1000);
    assert.equal(body.cameras[0].id, 'd07-1');
    assert.equal(body.cameras[0].snapshot, undefined);
    assert.equal(fetches > 0, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a stale disk copy is served immediately and refreshed behind it', async (t) => {
  const { dir, cache } = await tempCache();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  t.mock.method(globalThis, 'fetch', async () => {
    await gate;
    return Response.json({
      data: [
        {
          cctv: {
            index: '2',
            inService: 'true',
            location: {
              locationName: 'Fresh',
              latitude: '34.05',
              longitude: '-118.24',
            },
            imageData: {
              static: {
                currentImageURL:
                  'https://cwwp2.dot.ca.gov/data/d7/cctv/image/cam/b.jpg',
              },
            },
          },
        },
      ],
    });
  });
  try {
    await cache.write(7, cameras, Date.now() - 11 * 60 * 1000);
    const request = install(cwwpProxy({ disk: cache, warm: false }));
    const started = Date.now();
    const first = JSON.parse(
      (await request('/webcams?lat=34.05&lon=-118.24&radiusKm=40&district=7'))
        .body,
    );
    assert.ok(Date.now() - started < 1000);
    assert.equal(first.cameras[0].id, 'd07-1');
    assert.equal(first.stale, true);
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = JSON.parse(
      (await request('/webcams?lat=34.05&lon=-118.24&radiusKm=40&district=7'))
        .body,
    );
    assert.equal(
      second.cameras.some((camera) => camera.id === 'd07-2'),
      true,
    );
  } finally {
    release();
    await rm(dir, { recursive: true, force: true });
  }
});

function viewerAt() {
  if (!globalThis.document) {
    globalThis.document = {
      addEventListener() {},
      removeEventListener() {},
      createElement() {
        return { style: {}, addEventListener() {} };
      },
    };
  }
  const canvas = {
    ownerDocument: globalThis.document,
    clientWidth: 800,
    clientHeight: 600,
    width: 800,
    height: 600,
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 800, height: 600 };
    },
  };
  return {
    camera: {
      pitch: Cesium.Math.toRadians(-35),
      positionCartographic: { height: 40000 },
      changed: new Cesium.Event(),
      moveEnd: new Cesium.Event(),
      flyTo() {},
      setView() {},
      pickEllipsoid() {
        return Cesium.Cartesian3.fromDegrees(-118.24, 34.05);
      },
      computeViewRectangle() {
        return Cesium.Rectangle.fromDegrees(-125, 32, -114, 42);
      },
    },
    scene: {
      canvas,
      requestRender() {},
      frameState: { camera: { frustum: {} } },
      postRender: new Cesium.Event(),
    },
    dataSources: { add() {}, remove() {} },
  };
}

test('a warm cache draws pitchless Los Angeles pins without waiting out a 9s district', async () => {
  const viewer = viewerAt();
  let slowStarted = false;
  const layer = createCwwpWebcamsLayer({
    source: {
      cameras(query, { signal } = {}) {
        if (query.district === 7) {
          return {
            cameras: [
              {
                id: 'd07-1',
                latitude: 34.05,
                longitude: -118.24,
                title: 'LA',
              },
            ],
            fetchedAt: 1,
          };
        }
        slowStarted = true;
        return new Promise((resolve) => {
          const timer = setTimeout(
            () => resolve({ cameras: [], fetchedAt: 2 }),
            9000,
          );
          signal?.addEventListener?.('abort', () => {
            clearTimeout(timer);
            resolve({ cameras: [], fetchedAt: 2 });
          });
        });
      },
    },
  });
  try {
    layer.init(viewer);
    layer.enable(viewer);
    const pending = layer.update(viewer);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(slowStarted, true);
    assert.ok(layer.getStats().count >= 1);
    layer.destroy(viewer);
    await Promise.race([
      pending,
      new Promise((resolve) => setTimeout(resolve, 50)),
    ]);
  } finally {
    layer.destroy(viewer);
  }
});

test('a cold Caltrans search keeps districts that arrive inside the budget', async () => {
  const adapter = createCwwpAdapter({
    source: {
      cameras(query, { signal } = {}) {
        if (query.district === 3) {
          return {
            cameras: [
              {
                id: 'd03-1',
                title: 'Sacramento',
                latitude: 38.58,
                longitude: -121.49,
              },
            ],
          };
        }
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve({ cameras: [] }), 9000);
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        });
      },
    },
  });
  adapter.timeoutMs = 80;
  const result = await searchCameras(
    { adapters: [adapter] },
    { lat: 38.58, lon: -121.49, query: 'Sacramento' },
  );
  assert.equal(result.near[0]?.name, 'Sacramento');
  assert.equal(result.near[0]?.source, 'cwwp');
  assert.equal(result.statuses.find((row) => row.id === 'cwwp').status, 'ok');
});
