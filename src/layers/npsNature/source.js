import { npsClientMessage } from './model.js';

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Browser client for the curated NPS nature catalog. JPEG hosts stay on the
 * server; this module only speaks /api/nps-nature.
 */
export function createNpsNatureSource({
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
        payload?.error === 'not_found'
          ? payload.error
          : 'upstream';
      const error = new Error(npsClientMessage(code));
      error.code = code;
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  return {
    label: 'NPS',
    cameras({ signal } = {}) {
      return get('/api/nps-nature/cameras', signal);
    },
    warm(ids = [], { signal } = {}) {
      const params = new URLSearchParams();
      params.set('ids', (Array.isArray(ids) ? ids : []).join(','));
      return get(`/api/nps-nature/cameras/warm?${params}`, signal);
    },
  };
}
