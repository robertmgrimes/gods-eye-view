import {
  readResponseBytesCapped,
  readResponseJsonCapped,
  coalesceProxyRequest,
} from './common/http.js';
import { algoCamerasEnabled } from '../../src/layers/algo/flag.js';
import {
  camerasForQuery,
  extractCameraRecords,
  isAllowedSnapshotUrl,
  isCameraId,
  normalizeCamera,
  parseCameraQuery,
  parseStillIds,
  publicCamera,
  queryIntersectsService,
} from '../../src/layers/algo/model.js';
import {
  CATALOG_MAX_BYTES,
  CATALOG_URL,
  LIST_CACHE_TTL_MS,
  STILL_FETCH_CONCURRENCY,
  STILL_MAX_BYTES,
  STILL_REFRESH_MS,
  UPSTREAM_ATTEMPTS,
} from '../../src/layers/algo/policy.js';

const IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

const RETRY_STATUSES = new Set([429, 502, 503, 504]);

/**
 * Alabama ALGO webcam proxy. No API key.
 *
 *   GET /api/algo/webcams?west=&south=&east=&north=
 *   GET /api/algo/webcams?lat=&lon=&radiusKm=
 *   GET /api/algo/webcams/warm?ids=1845,1844
 *   GET /api/algo/webcams/:id/still
 *
 * The route answers 404 and does not call ALGO unless GEV_ALGO_CAMERAS is
 * `1` or `true`. The public catalog is one JSON list, cached for 30 minutes,
 * then filtered to the view. A view outside Alabama returns an empty list
 * and does not call ALGO. Snapshot fields stay on the server; the browser
 * receives a same-origin still URL. Image bytes refresh for the visible ids
 * only. Wowza HLS and DASH are never requested.
 *
 * @returns {import('vite').Plugin}
 */
export function algoProxy({ isEnabled = () => algoCamerasEnabled() } = {}) {
  let catalog = null;
  /** @type {Map<string, { at: number, bytes: Uint8Array | null, contentType: string, kept?: boolean }>} */
  const stills = new Map();
  const catalogInflight = new Map();
  const stillInflight = new Map();

  function sendJson(res, status, obj) {
    if (res.headersSent) return;
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(obj));
  }

  function upstreamFailure(status) {
    if (status === 429) return { status: 429, error: 'rate_limited' };
    if (status === 400) return { status: 400, error: 'bad_request' };
    return { status: 502, error: 'upstream' };
  }

  function fail(status, code) {
    const error = new Error(code);
    error.httpStatus = status;
    error.publicError = code;
    return error;
  }

  function pause(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function tlsOrNetwork(error) {
    if (!error || error?.name === 'AbortError') return false;
    if (error?.name === 'TimeoutError') return true;
    const code = String(error?.cause?.code || error?.code || '');
    const message = `${code} ${error?.message || ''}`;
    if (error instanceof TypeError) return true;
    return /ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|UND_ERR|TLS|EOF|EPROTO|CERT|socket/i.test(
      message,
    );
  }

  async function fetchUpstream(url, headers, redirect = 'follow') {
    let lastError = null;
    for (let attempt = 1; attempt <= UPSTREAM_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(url, {
          redirect,
          headers,
          signal: AbortSignal.timeout(20_000),
        });
        if (
          RETRY_STATUSES.has(response.status) &&
          attempt < UPSTREAM_ATTEMPTS
        ) {
          try {
            await response.body?.cancel();
          } catch {
            /* the next attempt replaces this response */
          }
          await pause(200 * attempt);
          continue;
        }
        return response;
      } catch (error) {
        lastError = error;
        if (!tlsOrNetwork(error) || attempt === UPSTREAM_ATTEMPTS) throw error;
        await pause(200 * attempt);
      }
    }
    throw lastError || fail(502, 'upstream');
  }

  async function readJson(response) {
    if (!response.ok) {
      try {
        await response.body?.cancel();
      } catch {
        /* the status is the only fact we keep */
      }
      throw fail(
        upstreamFailure(response.status).status,
        upstreamFailure(response.status).error,
      );
    }
    try {
      return await readResponseJsonCapped(response, CATALOG_MAX_BYTES);
    } catch {
      throw fail(502, 'upstream');
    }
  }

  async function fetchCatalog() {
    const response = await fetchUpstream(CATALOG_URL, {
      accept: 'application/json',
      'user-agent': 'gods-eye-view-algo/1.0',
    });
    const body = await readJson(response);
    const cameras = [];
    const seen = new Set();
    for (const record of extractCameraRecords(body)) {
      const camera = normalizeCamera(record);
      if (!camera || seen.has(camera.id)) continue;
      seen.add(camera.id);
      cameras.push(camera);
    }
    return cameras;
  }

  async function loadCatalog() {
    if (catalog && Date.now() - catalog.at < LIST_CACHE_TTL_MS) return catalog;
    try {
      const { promise } = coalesceProxyRequest(
        catalogInflight,
        'catalog',
        async () => {
          const cameras = await fetchCatalog();
          const entry = { at: Date.now(), stale: false, cameras };
          catalog = entry;
          return entry;
        },
      );
      return await promise;
    } catch (error) {
      if (catalog?.cameras?.length) return { ...catalog, stale: true };
      throw error;
    }
  }

  function contentTypeOf(header) {
    const type = String(header || '')
      .split(';', 1)[0]
      .trim()
      .toLowerCase();
    if (type === 'image/jpg') return 'image/jpeg';
    return IMAGE_TYPES.has(type) ? type : '';
  }

  async function readImage(response) {
    const type = contentTypeOf(response.headers.get('content-type'));
    if (!response.ok || !type) {
      try {
        await response.body?.cancel();
      } catch {
        /* status is enough */
      }
      throw fail(502, 'upstream');
    }
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > STILL_MAX_BYTES) {
      try {
        await response.body?.cancel();
      } catch {
        /* oversized */
      }
      throw fail(502, 'upstream');
    }
    let bytes;
    try {
      bytes = await readResponseBytesCapped(response, STILL_MAX_BYTES);
    } catch {
      throw fail(502, 'upstream');
    }
    return { bytes, contentType: type };
  }

  function cacheBusted(url) {
    const next = new URL(url);
    next.searchParams.set('t', String(Date.now()));
    return next.toString();
  }

  async function fetchStill(startUrl) {
    let current = cacheBusted(startUrl);
    for (let hop = 0; hop < 4; hop += 1) {
      if (!isAllowedSnapshotUrl(current)) throw fail(502, 'upstream');
      const response = await fetchUpstream(
        current,
        {
          accept: 'image/jpeg,image/png,image/webp,image/*',
          'user-agent': 'gods-eye-view-algo/1.0',
        },
        'manual',
      );
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        try {
          await response.body?.cancel();
        } catch {
          /* the next hop is the response */
        }
        if (!location) throw fail(502, 'upstream');
        current = new URL(location, current).toString();
        continue;
      }
      return readImage(response);
    }
    throw fail(502, 'upstream');
  }

  async function loadStill(camera) {
    const cached = stills.get(camera.id);
    if (cached && Date.now() - cached.at < STILL_REFRESH_MS) {
      if (cached.bytes) return cached;
      throw fail(502, 'upstream');
    }
    const { promise } = coalesceProxyRequest(
      stillInflight,
      camera.id,
      async () => {
        try {
          const image = await fetchStill(camera.snapshot);
          const entry = {
            at: Date.now(),
            bytes: image.bytes,
            contentType: image.contentType,
            kept: false,
          };
          stills.set(camera.id, entry);
          return entry;
        } catch (error) {
          const previous = stills.get(camera.id);
          if (previous?.bytes) {
            const kept = {
              at: Date.now(),
              bytes: previous.bytes,
              contentType: previous.contentType,
              kept: true,
            };
            stills.set(camera.id, kept);
            return kept;
          }
          stills.set(camera.id, {
            at: Date.now(),
            bytes: null,
            contentType: '',
            kept: false,
          });
          throw error;
        }
      },
    );
    return promise;
  }

  function retainVisibleStills(ids, cameras) {
    const wanted = new Set(ids);
    const known = new Set(
      cameras.filter((camera) => camera.snapshot).map((camera) => camera.id),
    );
    for (const id of [...stills.keys()]) {
      if (!wanted.has(id) || !known.has(id)) stills.delete(id);
    }
  }

  async function runPool(items, limit, worker) {
    if (!items.length) return;
    let cursor = 0;
    const lanes = Math.max(1, Math.min(limit, items.length));
    async function lane() {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        await worker(items[index]);
      }
    }
    await Promise.all(Array.from({ length: lanes }, () => lane()));
  }

  async function warmStills(ids) {
    const entry = await loadCatalog();
    retainVisibleStills(ids, entry.cameras);
    const targets = ids
      .map((id) => entry.cameras.find((row) => row.id === id))
      .filter((camera) => camera?.snapshot);
    const tally = { refreshed: 0, cached: 0, kept: 0, failed: 0 };
    await runPool(targets, STILL_FETCH_CONCURRENCY, async (camera) => {
      const cached = stills.get(camera.id);
      if (cached?.bytes && Date.now() - cached.at < STILL_REFRESH_MS) {
        tally.cached += 1;
        return;
      }
      try {
        const image = await loadStill(camera);
        if (!image?.bytes) tally.failed += 1;
        else if (image.kept) tally.kept += 1;
        else tally.refreshed += 1;
      } catch {
        tally.failed += 1;
      }
    });
    return { fetchedAt: entry.at, count: targets.length, ...tally };
  }

  function writeStill(res, image) {
    if (res.headersSent || !image?.bytes) return;
    res.writeHead(200, {
      'Content-Type': image.contentType,
      'Content-Length': String(image.bytes.byteLength),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(Buffer.from(image.bytes));
  }

  const installMiddleware = (server) => {
    server.middlewares.use('/api/algo', async (req, res) => {
      try {
        if (!isEnabled()) {
          sendJson(res, 404, { error: 'disabled' });
          return;
        }
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'method' });
          return;
        }
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        const path = url.pathname;

        if (path === '/webcams' || path === '/webcams/') {
          const query = parseCameraQuery(url.searchParams);
          if (!query) {
            sendJson(res, 400, { error: 'bad_request' });
            return;
          }
          if (!queryIntersectsService(query)) {
            sendJson(res, 200, {
              fetchedAt: Date.now(),
              stale: false,
              coverage: 'outside',
              count: 0,
              cameras: [],
            });
            return;
          }
          const entry = await loadCatalog();
          const cameras = camerasForQuery(entry.cameras, query)
            .map(publicCamera)
            .filter(Boolean);
          sendJson(res, 200, {
            fetchedAt: entry.at,
            stale: entry.stale === true,
            coverage: 'view',
            count: cameras.length,
            cameras,
          });
          return;
        }

        if (path === '/webcams/warm' || path === '/webcams/warm/') {
          const report = await warmStills(
            parseStillIds(url.searchParams.get('ids')),
          );
          sendJson(res, 200, report);
          return;
        }

        const still = path.match(/^\/webcams\/(\d{1,12})\/still$/);
        if (still && isCameraId(still[1])) {
          const entry = await loadCatalog();
          const camera = entry.cameras.find((row) => row.id === still[1]);
          if (!camera?.snapshot) {
            sendJson(res, 404, { error: 'not_found' });
            return;
          }
          writeStill(res, await loadStill(camera));
          return;
        }

        sendJson(res, 404, { error: 'not_found' });
      } catch (error) {
        const status = Number(error?.httpStatus) || 502;
        const code = error?.publicError || 'upstream';
        console.warn(`[algo-proxy] ${code} (${status})`);
        sendJson(res, status, { error: code });
      }
    });
  };

  return {
    name: 'algo-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
