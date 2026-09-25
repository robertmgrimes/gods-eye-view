import { cwwpClientMessage } from './model.js';

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Browser client for the same-origin Caltrans CWWP proxy. Snapshot hosts stay
 * on the server; this module only speaks /api/cwwp.
 */
export function createCwwpSource({
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
      const error = new Error(cwwpClientMessage(code));
      error.code = code;
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  return {
    label: 'Caltrans CWWP',
    cameras(query = {}, { signal } = {}) {
      const params = new URLSearchParams();
      if (query.kind === 'nearby' || query.lat != null) {
        params.set('lat', String(query.lat));
        params.set('lon', String(query.lon));
        params.set('radiusKm', String(query.radiusKm));
        if (query.district != null)
          params.set('district', String(query.district));
      } else {
        params.set('west', String(query.west));
        params.set('south', String(query.south));
        params.set('east', String(query.east));
        params.set('north', String(query.north));
        if (query.district != null)
          params.set('district', String(query.district));
      }
      return get(`/api/cwwp/webcams?${params}`, signal);
    },
    warm(ids = [], { signal } = {}) {
      const seen = new Set();
      const list = [];
      for (const raw of Array.isArray(ids) ? ids : []) {
        const id = String(raw).trim();
        if (!/^d(?:0[1-9]|1[0-2])-\d{1,6}$/.test(id) || seen.has(id)) continue;
        seen.add(id);
        list.push(id);
      }
      const params = new URLSearchParams();
      params.set('ids', list.join(','));
      return get(`/api/cwwp/webcams/warm?${params}`, signal);
    },
  };
}
