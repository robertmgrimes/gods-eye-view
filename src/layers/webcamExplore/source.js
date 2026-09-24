import { clientMessage } from './model.js';

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Browser client for the same-origin Webcam Explore proxy. The MCP call
 * stays on the server. This module only speaks /api/webcam-explore.
 */
export function createWebcamExploreSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  async function get(url, signal) {
    signal?.throwIfAborted();
    const response = await fetchImpl(url, { signal, cache: 'no-store' });
    const payload = await readJson(response);
    signal?.throwIfAborted();
    if (!response.ok) {
      const code =
        payload?.error === 'rate_limited' ||
        payload?.error === 'bad_request' ||
        payload?.error === 'ambiguous_location' ||
        payload?.error === 'not_found'
          ? payload.error
          : 'upstream';
      const error = new Error(clientMessage(code));
      error.code = code;
      error.note = typeof payload?.note === 'string' ? payload.note : '';
      error.choices = Array.isArray(payload?.choices) ? payload.choices : [];
      throw error;
    }
    return payload;
  }

  function withLimit(params, limit) {
    if (limit != null) params.set('limit', String(limit));
    return params;
  }

  return {
    label: 'Webcam Explore',
    search({ query, location, category, limit, signal } = {}) {
      const params = withLimit(new URLSearchParams(), limit);
      if (query) params.set('q', query);
      if (location) params.set('location', location);
      if (category) params.set('category', category);
      return get(`/api/webcam-explore/search?${params}`, signal);
    },
    trending({ limit, signal } = {}) {
      return get(
        `/api/webcam-explore/trending?${withLimit(new URLSearchParams(), limit)}`,
        signal,
      );
    },
    popular({ limit, signal } = {}) {
      return get(
        `/api/webcam-explore/popular?${withLimit(new URLSearchParams(), limit)}`,
        signal,
      );
    },
    byLocation({ location, limit, signal } = {}) {
      const params = withLimit(new URLSearchParams(), limit);
      params.set('location', location || '');
      return get(`/api/webcam-explore/location?${params}`, signal);
    },
    byCategory({ category, limit, signal } = {}) {
      const params = withLimit(new URLSearchParams(), limit);
      params.set('category', category || '');
      return get(`/api/webcam-explore/category?${params}`, signal);
    },
    webcam(id, { signal } = {}) {
      return get(
        `/api/webcam-explore/webcams/${encodeURIComponent(id)}`,
        signal,
      );
    },
  };
}
