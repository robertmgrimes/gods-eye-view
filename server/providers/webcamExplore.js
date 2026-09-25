import { readResponseJsonCapped, coalesceProxyRequest } from './common/http.js';
import {
  ambiguousGeorgia,
  clampLimit,
  extractWebcamList,
  isCategorySlug,
  publicWebcam,
} from '../../src/layers/webcamExplore/model.js';
import {
  LIST_CACHE_TTL_MS,
  MAX_LIMIT,
  MCP_URL,
} from '../../src/layers/webcamExplore/policy.js';

const BODY_CAP = 1_500_000;
const TEXT_CAP = 120;

/**
 * Webcam Explore discovery proxy.
 *
 *   GET /api/webcam-explore/search?q=&location=&category=&limit=
 *   GET /api/webcam-explore/trending?limit=
 *   GET /api/webcam-explore/popular?limit=
 *   GET /api/webcam-explore/category?category=&limit=
 *   GET /api/webcam-explore/location?location=&limit=
 *   GET /api/webcam-explore/webcams/:id
 *
 * No API key. Responses are the public discovery fields only. Stream URLs
 * are not requested and are not forwarded. Results cache for 30 minutes.
 *
 * @returns {import('vite').Plugin}
 */
export function webcamExploreProxy({
  now = () => Date.now(),
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  const cache = new Map();
  const inflight = new Map();

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

  function clip(value) {
    return String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, TEXT_CAP);
  }

  function remember(key, payload) {
    cache.set(key, { at: now(), payload });
    while (cache.size > 80) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
  }

  async function callTool(name, args) {
    const response = await fetchImpl(MCP_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'user-agent': 'gods-eye-view-webcam-explore/1.0',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 429) {
      try {
        await response.body?.cancel();
      } catch {
        /* status is enough */
      }
      throw fail(429, 'rate_limited');
    }
    if (!response.ok) {
      try {
        await response.body?.cancel();
      } catch {
        /* status is enough */
      }
      throw fail(502, 'upstream');
    }
    let body;
    try {
      body = await readResponseJsonCapped(response, BODY_CAP);
    } catch {
      throw fail(502, 'upstream');
    }
    if (body?.error || body?.result?.isError) throw fail(502, 'upstream');
    const limit = clampLimit(args.limit);
    const webcams = extractWebcamList(body)
      .map((row) => publicWebcam(row))
      .filter(Boolean)
      .slice(0, Math.min(limit, MAX_LIMIT));
    return {
      tool: name,
      fetchedAt: now(),
      stale: false,
      count: webcams.length,
      webcams,
      cachedForMs: LIST_CACHE_TTL_MS,
    };
  }

  async function load(key, name, args) {
    const cached = cache.get(key);
    if (cached && now() - cached.at < LIST_CACHE_TTL_MS)
      return { ...cached.payload, stale: false };
    try {
      const { promise } = coalesceProxyRequest(inflight, key, () =>
        callTool(name, args),
      );
      const payload = await promise;
      remember(key, payload);
      return payload;
    } catch (error) {
      if (cached) return { ...cached.payload, stale: true };
      throw error;
    }
  }

  function ambiguousResponse(value) {
    const ambiguous = ambiguousGeorgia(value);
    return ambiguous
      ? { status: 400, body: { error: 'ambiguous_location', ...ambiguous } }
      : null;
  }

  function route(url) {
    const path = url.pathname.replace(/\/$/, '') || '/';
    const limit = clampLimit(url.searchParams.get('limit'));
    if (path === '/search') {
      const query = clip(url.searchParams.get('q'));
      const location = clip(url.searchParams.get('location'));
      const category = clip(url.searchParams.get('category')).toLowerCase();
      const blocked = ambiguousResponse(query) || ambiguousResponse(location);
      if (blocked) return blocked;
      if (!query && !location && !category)
        return { status: 400, body: { error: 'bad_request' } };
      if (category && !isCategorySlug(category))
        return { status: 400, body: { error: 'bad_request' } };
      const args = { limit };
      if (query) args.query = query;
      if (location) args.location = location;
      if (category) args.category = category;
      return {
        key: `search:${JSON.stringify(args)}`,
        tool: 'search_webcams',
        args,
      };
    }
    if (path === '/trending') {
      const args = { limit };
      return {
        key: `trending:${limit}`,
        tool: 'get_trending_webcams',
        args,
      };
    }
    if (path === '/popular') {
      const args = { limit };
      return { key: `popular:${limit}`, tool: 'get_popular_webcams', args };
    }
    if (path === '/category') {
      const category = clip(url.searchParams.get('category')).toLowerCase();
      if (!isCategorySlug(category))
        return { status: 400, body: { error: 'bad_request' } };
      const args = { category, limit };
      return {
        key: `category:${JSON.stringify(args)}`,
        tool: 'get_webcams_by_category',
        args,
      };
    }
    if (path === '/location') {
      const location = clip(url.searchParams.get('location'));
      const blocked = ambiguousResponse(location);
      if (blocked) return blocked;
      if (!location) return { status: 400, body: { error: 'bad_request' } };
      const args = { location, limit };
      return {
        key: `location:${JSON.stringify(args)}`,
        tool: 'get_webcams_by_location',
        args,
      };
    }
    const one = path.match(/^\/webcams\/([A-Za-z0-9_-]{1,64})$/);
    if (one) {
      const args = { id: one[1] };
      return {
        key: `webcam:${one[1]}`,
        tool: 'get_webcam',
        args,
      };
    }
    return { status: 404, body: { error: 'not_found' } };
  }

  const installMiddleware = (server) => {
    server.middlewares.use('/api/webcam-explore', async (req, res) => {
      try {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'method' });
          return;
        }
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        const resolved = route(url);
        if (resolved.status) {
          sendJson(res, resolved.status, resolved.body);
          return;
        }
        const payload = await load(resolved.key, resolved.tool, resolved.args);
        sendJson(res, 200, payload);
      } catch (error) {
        const status = Number(error?.httpStatus) || 502;
        const code = error?.publicError || 'upstream';
        console.warn(`[webcam-explore] ${code} (${status})`);
        sendJson(res, status, { error: code });
      }
    });
  };

  return {
    name: 'webcam-explore-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
