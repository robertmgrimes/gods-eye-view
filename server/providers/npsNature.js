import {
  readResponseBytesCapped,
  coalesceProxyRequest,
} from './common/http.js';
import { NPS_NATURE_CATALOG } from '../../src/layers/npsNature/catalog.js';
import {
  assertNoYosemiteConservancy,
  catalogById,
  isAllowedNpsStillUrl,
  parseStillIds,
  publicCatalog,
} from '../../src/layers/npsNature/model.js';
import {
  STILL_FETCH_CONCURRENCY,
  STILL_MAX_BYTES,
  STILL_REFRESH_MS,
} from '../../src/layers/npsNature/policy.js';

/**
 * Curated NPS nature cameras. No API key and no catalog fetch.
 *
 *   GET /api/nps-nature/cameras
 *   GET /api/nps-nature/cameras/warm?ids=yell-north-out
 *   GET /api/nps-nature/cameras/:id/still
 *
 * The browser receives same-origin still paths. JPEG bytes are fetched only
 * for allow-listed www.nps.gov/webcams-yell images, at most once a minute.
 * Link-outs are not fetched. A client cannot supply an image URL.
 */
export function npsNatureProxy() {
  assertNoYosemiteConservancy();
  const byId = catalogById();
  /** @type {Map<string, { at: number, bytes: Uint8Array | null, contentType: string, kept?: boolean }>} */
  const stills = new Map();
  const stillInflight = new Map();

  function sendJson(res, status, obj) {
    if (res.headersSent) return;
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(obj));
  }

  function fail(status, code) {
    const error = new Error(code);
    error.httpStatus = status;
    error.publicError = code;
    return error;
  }

  function contentTypeOf(header) {
    const type = String(header || '')
      .split(';', 1)[0]
      .trim()
      .toLowerCase();
    if (type === 'image/jpg') return 'image/jpeg';
    return type === 'image/jpeg' ? type : '';
  }

  async function readImage(response) {
    const type = contentTypeOf(response.headers.get('content-type'));
    if (!response.ok || type !== 'image/jpeg') {
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
    if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      throw fail(502, 'upstream');
    }
    return { bytes, contentType: 'image/jpeg' };
  }

  async function fetchStill(startUrl) {
    if (!isAllowedNpsStillUrl(startUrl)) throw fail(502, 'upstream');
    const response = await fetch(startUrl, {
      redirect: 'manual',
      headers: {
        accept: 'image/jpeg',
        'user-agent': 'gods-eye-view-nps-nature/1.0',
      },
      signal: AbortSignal.timeout(20_000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      try {
        await response.body?.cancel();
      } catch {
        /* redirects are not followed; the catalog URL is the only one we fetch */
      }
      throw fail(502, 'upstream');
    }
    return readImage(response);
  }

  async function loadStill(camera) {
    if (camera?.kind !== 'still' || !isAllowedNpsStillUrl(camera.stillUrl))
      throw fail(404, 'not_found');
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
          const image = await fetchStill(camera.stillUrl);
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
    const targets = ids
      .map((id) => byId.get(id))
      .filter(
        (camera) =>
          camera?.kind === 'still' && isAllowedNpsStillUrl(camera.stillUrl),
      );
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
    return { fetchedAt: Date.now(), count: targets.length, ...tally };
  }

  function writeStill(res, image) {
    if (res.headersSent || !image?.bytes) return;
    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Content-Length': String(image.bytes.byteLength),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(Buffer.from(image.bytes));
  }

  const installMiddleware = (server) => {
    server.middlewares.use('/api/nps-nature', async (req, res) => {
      try {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'method' });
          return;
        }
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        const path = url.pathname;

        if (path === '/cameras' || path === '/cameras/') {
          const cameras = publicCatalog(NPS_NATURE_CATALOG);
          sendJson(res, 200, {
            fetchedAt: Date.now(),
            stale: false,
            count: cameras.length,
            cameras,
          });
          return;
        }

        if (path === '/cameras/warm' || path === '/cameras/warm/') {
          sendJson(
            res,
            200,
            await warmStills(parseStillIds(url.searchParams.get('ids'))),
          );
          return;
        }

        const still = path.match(/^\/cameras\/([a-z0-9-]{1,40})\/still$/);
        if (still) {
          const camera = byId.get(still[1]);
          if (!camera || camera.kind !== 'still') {
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
        console.warn(`[nps-nature] ${code} (${status})`);
        sendJson(res, status, { error: code });
      }
    });
  };

  return {
    name: 'nps-nature-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
