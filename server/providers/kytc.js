import {
  readResponseBytesCapped,
  readResponseJsonCapped,
  coalesceProxyRequest,
} from './common/http.js';
import {
  camerasForQuery,
  extractCameraFeatures,
  isAllowedSnapshotUrl,
  normalizeCamera,
  parseCameraQuery,
  publicCamera,
  queryIntersectsService,
} from '../../src/layers/kytc/model.js';
import {
  LIST_CACHE_TTL_MS,
  STILL_MAX_BYTES,
} from '../../src/layers/kytc/policy.js';

const QUERY_URL =
  'https://kygisserver.ky.gov/arcgis/rest/services/WGS84WM_Services/Ky_WebCams_WGS84WM/MapServer/0/query';

const IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

/**
 * Kentucky KYTC webcam proxy. No API key.
 *
 *   GET /api/kytc/webcams?west=&south=&east=&north=
 *   GET /api/kytc/webcams?lat=&lon=&radiusKm=
 *   GET /api/kytc/webcams/:id/still
 *
 * The catalog is about 226 features. It is fetched at most once per cache
 * window, then filtered to the requested view. A view that misses Kentucky
 * returns an empty list and does not call KYTC. Snapshot fields are HTTP
 * JPEGs, so the browser only receives a same-origin still URL; the image
 * bytes are fetched here on click.
 *
 * @returns {import('vite').Plugin}
 */
export function kytcProxy() {
  const BODY_CAP = 2_000_000;
  let catalog = null;
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
    const body = await readResponseJsonCapped(response, BODY_CAP);
    if (body?.error) throw fail(502, 'upstream');
    return body;
  }

  function catalogUrl(offset) {
    const url = new URL(QUERY_URL);
    url.searchParams.set('where', '1=1');
    url.searchParams.set('outFields', '*');
    url.searchParams.set('returnGeometry', 'false');
    url.searchParams.set('f', 'json');
    url.searchParams.set('resultOffset', String(offset));
    url.searchParams.set('resultRecordCount', '1000');
    return url;
  }

  async function fetchCatalogPages() {
    const cameras = [];
    const seen = new Set();
    let offset = 0;
    for (let page = 0; page < 4; page += 1) {
      const response = await fetch(catalogUrl(offset), {
        headers: {
          accept: 'application/json',
          'user-agent': 'gods-eye-view-kytc/1.0',
        },
        signal: AbortSignal.timeout(20_000),
      });
      const body = await readJson(response);
      const features = extractCameraFeatures(body);
      for (const feature of features) {
        const camera = normalizeCamera(feature);
        if (!camera || seen.has(camera.id)) continue;
        seen.add(camera.id);
        cameras.push(camera);
      }
      if (body?.exceededTransferLimit !== true || features.length === 0) break;
      offset += features.length;
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
          const cameras = await fetchCatalogPages();
          const entry = { at: Date.now(), stale: false, cameras };
          catalog = entry;
          return entry;
        },
      );
      return await promise;
    } catch (error) {
      if (catalog) return { ...catalog, stale: true };
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

  async function fetchStill(startUrl) {
    let current = startUrl;
    for (let hop = 0; hop < 4; hop += 1) {
      if (!isAllowedSnapshotUrl(current)) throw fail(502, 'upstream');
      const response = await fetch(current, {
        redirect: 'manual',
        headers: {
          accept: 'image/jpeg,image/png,image/webp,image/*',
          'user-agent': 'gods-eye-view-kytc/1.0',
        },
        signal: AbortSignal.timeout(20_000),
      });
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

  const installMiddleware = (server) => {
    server.middlewares.use('/api/kytc', async (req, res) => {
      try {
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

        const still = path.match(/^\/webcams\/(\d{1,12})\/still$/);
        if (still) {
          const entry = await loadCatalog();
          const camera = entry.cameras.find((row) => row.id === still[1]);
          if (!camera?.snapshot) {
            sendJson(res, 404, { error: 'not_found' });
            return;
          }
          const { promise } = coalesceProxyRequest(
            stillInflight,
            camera.id,
            () => fetchStill(camera.snapshot),
          );
          const image = await promise;
          if (res.headersSent) return;
          res.writeHead(200, {
            'Content-Type': image.contentType,
            'Content-Length': String(image.bytes.byteLength),
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          });
          res.end(Buffer.from(image.bytes));
          return;
        }

        sendJson(res, 404, { error: 'not_found' });
      } catch (error) {
        const status = Number(error?.httpStatus) || 502;
        const code = error?.publicError || 'upstream';
        console.warn(`[kytc-proxy] ${code} (${status})`);
        sendJson(res, status, { error: code });
      }
    });
  };

  return {
    name: 'kytc-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
