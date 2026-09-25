import { kytcClientMessage } from './model.js';

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Browser client for the same-origin KYTC proxy. Snapshot hosts stay on the
 * server; this module only speaks /api/kytc.
 */
export function createKytcSource({
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
      const error = new Error(kytcClientMessage(code));
      error.code = code;
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  return {
    label: 'KYTC',
    cameras(query = {}, { signal } = {}) {
      const params = new URLSearchParams();
      if (query.kind === 'nearby' || query.lat != null) {
        params.set('lat', String(query.lat));
        params.set('lon', String(query.lon));
        params.set('radiusKm', String(query.radiusKm));
      } else {
        params.set('west', String(query.west));
        params.set('south', String(query.south));
        params.set('east', String(query.east));
        params.set('north', String(query.north));
      }
      return get(`/api/kytc/webcams?${params}`, signal);
    },
    warm(ids = [], { signal } = {}) {
      const seen = new Set();
      const list = [];
      for (const raw of Array.isArray(ids) ? ids : []) {
        const id = String(raw).trim();
        if (!/^\d{1,12}$/.test(id) || seen.has(id)) continue;
        seen.add(id);
        list.push(id);
      }
      const params = new URLSearchParams();
      params.set('ids', list.join(','));
      return get(`/api/kytc/webcams/warm?${params}`, signal);
    },
  };
}
