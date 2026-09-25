import { readResponseJsonCapped, coalesceProxyRequest } from './common/http.js';
import {
  extractWebcamList,
  extractWebcamRecord,
  normalizeWebcam,
  parseForecastPoint,
  parseNearbyQuery,
  scrubSecrets,
  summarizePointForecast,
} from '../../src/layers/windy/model.js';
import {
  LIST_CACHE_TTL_MS,
  NEARBY_LIMIT,
} from '../../src/layers/windy/policy.js';

/**
 * Windy server proxy.
 *
 *   GET /api/windy/status
 *   GET /api/windy/webcams?lat=&lon=&radiusKm=
 *   GET /api/windy/webcams/:id          fresh still (never cached)
 *   GET /api/windy/point-forecast?lat=&lon=
 *
 * Webcams authenticate with the header `x-windy-api-key`. Point Forecast
 * sends `WINDY_POINT_FORECAST_API_KEY` in the upstream JSON body. Neither
 * key is written to a response, a log line, or a cached image URL.
 *
 * Map Forecast is not mounted. Its browser bundle (Leaflet `libBoot.js`)
 * would run a second map beside the Cesium globe and fight the camera,
 * picking, and the render loop. Webcams and Point Forecast do not need it.
 *
 * @returns {import('vite').Plugin}
 */
export function windyProxy() {
  const WEB_BASE = 'https://api.windy.com/webcams/api/v3/webcams';
  const FORECAST_URL = 'https://api.windy.com/api/point-forecast/v2';
  const BODY_CAP = 1_500_000;
  const listCache = new Map();
  const listInflight = new Map();
  const detailInflight = new Map();
  const forecastInflight = new Map();

  const webcamsKey = () => String(process.env.WINDY_API_KEY || '').trim();
  const forecastKey = () =>
    String(process.env.WINDY_POINT_FORECAST_API_KEY || '').trim();

  function sendJson(res, status, obj) {
    if (res.headersSent) return;
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(obj));
  }

  function upstreamFailure(status) {
    if (status === 401) return { status: 401, error: 'unauthorized' };
    if (status === 429) return { status: 429, error: 'rate_limited' };
    if (status === 400) return { status: 400, error: 'bad_request' };
    if (status === 204) return { status: 204, error: 'no_data' };
    return { status: 502, error: 'upstream' };
  }

  async function readUpstream(response, secret) {
    if (!response.ok) {
      try {
        await response.body?.cancel();
      } catch {
        /* the status is the only fact we keep */
      }
      const failure = upstreamFailure(response.status);
      const error = new Error(`HTTP ${response.status}`);
      error.httpStatus = failure.status;
      error.publicError = failure.error;
      throw error;
    }
    const parsed = await readResponseJsonCapped(response, BODY_CAP);
    return scrubSecrets(parsed, [secret]);
  }

  function rememberList(key, entry) {
    listCache.set(key, entry);
    while (listCache.size > 80) {
      const oldest = listCache.keys().next().value;
      listCache.delete(oldest);
    }
  }

  async function fetchNearby(query, key) {
    const cacheKey = `${query.lat.toFixed(2)},${query.lon.toFixed(2)},${query.radiusKm}`;
    const cached = listCache.get(cacheKey);
    if (cached && Date.now() - cached.at < LIST_CACHE_TTL_MS)
      return { ...cached, stale: false };
    try {
      const { promise } = coalesceProxyRequest(
        listInflight,
        cacheKey,
        async () => {
          const url = new URL(WEB_BASE);
          url.searchParams.set('limit', String(NEARBY_LIMIT));
          url.searchParams.set('include', 'images,location,urls');
          url.searchParams.set(
            'nearby',
            `${query.lat},${query.lon},${query.radiusKm}`,
          );
          const response = await fetch(url, {
            headers: { 'x-windy-api-key': key },
            signal: AbortSignal.timeout(20_000),
          });
          const body = await readUpstream(response, key);
          const webcams = extractWebcamList(body)
            .map((row) => normalizeWebcam(row, { includeImages: false }))
            .filter(Boolean)
            .slice(0, NEARBY_LIMIT);
          const entry = {
            at: Date.now(),
            stale: false,
            radiusKm: query.radiusKm,
            webcams,
          };
          rememberList(cacheKey, entry);
          return entry;
        },
      );
      return await promise;
    } catch (error) {
      // A rejected key must not be papered over. A dead upstream can still
      // show the last pins; those entries never carry image URLs.
      if (
        cached &&
        error?.publicError !== 'unauthorized' &&
        error?.publicError !== 'rate_limited'
      ) {
        return { ...cached, stale: true };
      }
      throw error;
    }
  }

  async function fetchDetail(id, key) {
    const { promise } = coalesceProxyRequest(detailInflight, id, async () => {
      const url = new URL(`${WEB_BASE}/${id}`);
      url.searchParams.set('include', 'images,location,urls');
      const response = await fetch(url, {
        headers: { 'x-windy-api-key': key },
        signal: AbortSignal.timeout(20_000),
      });
      const body = await readUpstream(response, key);
      const now = Date.now();
      const webcam = normalizeWebcam(extractWebcamRecord(body), {
        includeImages: true,
        now,
      });
      if (!webcam) {
        const error = new Error('empty webcam');
        error.httpStatus = 502;
        error.publicError = 'upstream';
        throw error;
      }
      return { fetchedAt: now, webcam };
    });
    return promise;
  }

  async function fetchForecast(point, key) {
    const cacheKey = `${point.lat.toFixed(2)},${point.lon.toFixed(2)}`;
    const { promise } = coalesceProxyRequest(
      forecastInflight,
      cacheKey,
      async () => {
        const response = await fetch(FORECAST_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            lat: point.lat,
            lon: point.lon,
            model: 'gfs',
            parameters: ['temp', 'wind', 'windGust', 'pressure', 'precip'],
            levels: ['surface'],
            key,
          }),
          signal: AbortSignal.timeout(20_000),
        });
        if (response.status === 204) {
          try {
            await response.body?.cancel();
          } catch {
            /* status is enough */
          }
          const error = new Error('HTTP 204');
          error.httpStatus = 204;
          error.publicError = 'no_data';
          throw error;
        }
        const body = await readUpstream(response, key);
        return summarizePointForecast(body, point);
      },
    );
    return promise;
  }

  const installMiddleware = (server) => {
    server.middlewares.use('/api/windy', async (req, res) => {
      try {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'method' });
          return;
        }
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        const path = url.pathname;

        if (path === '/status') {
          sendJson(res, 200, {
            webcams: Boolean(webcamsKey()),
            pointForecast: Boolean(forecastKey()),
          });
          return;
        }

        if (path === '/webcams' || path === '/webcams/') {
          const query = parseNearbyQuery({
            lat: url.searchParams.get('lat'),
            lon: url.searchParams.get('lon'),
            radiusKm: url.searchParams.has('radiusKm')
              ? url.searchParams.get('radiusKm')
              : undefined,
          });
          if (!query) {
            sendJson(res, 400, { error: 'bad_request' });
            return;
          }
          const key = webcamsKey();
          if (!key) {
            sendJson(res, 503, { error: 'no_key' });
            return;
          }
          const entry = await fetchNearby(query, key);
          sendJson(res, 200, {
            fetchedAt: entry.at,
            stale: entry.stale === true,
            radiusKm: entry.radiusKm,
            count: entry.webcams.length,
            webcams: entry.webcams,
          });
          return;
        }

        const detail = path.match(/^\/webcams\/(\d{1,12})$/);
        if (detail) {
          const key = webcamsKey();
          if (!key) {
            sendJson(res, 503, { error: 'no_key' });
            return;
          }
          sendJson(res, 200, await fetchDetail(detail[1], key));
          return;
        }

        if (path === '/point-forecast') {
          const point = parseForecastPoint({
            lat: url.searchParams.get('lat'),
            lon: url.searchParams.get('lon'),
          });
          if (!point) {
            sendJson(res, 400, { error: 'bad_request' });
            return;
          }
          const key = forecastKey();
          if (!key) {
            sendJson(res, 503, { error: 'no_key' });
            return;
          }
          sendJson(res, 200, await fetchForecast(point, key));
          return;
        }

        sendJson(res, 404, { error: 'not_found' });
      } catch (error) {
        const upstreamStatus = Number(error?.httpStatus) || 502;
        const status = upstreamStatus === 204 ? 404 : upstreamStatus;
        const code = error?.publicError || 'upstream';
        console.warn(`[windy-proxy] ${code} (${status})`);
        sendJson(res, status, { error: code });
      }
    });
  };

  return {
    name: 'windy-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
