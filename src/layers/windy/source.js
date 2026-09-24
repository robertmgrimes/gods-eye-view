import { windyClientMessage } from './model.js';

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Browser client for the same-origin Windy proxy. The API keys stay on the
 * server; this module only speaks /api/windy.
 */
export function createWindySource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  async function get(url, signal) {
    signal?.throwIfAborted();
    const response = await fetchImpl(url, { signal, cache: 'no-store' });
    const payload = await readJson(response);
    signal?.throwIfAborted();
    if (!response.ok) {
      const code =
        payload?.error === 'no_key' ||
        payload?.error === 'unauthorized' ||
        payload?.error === 'rate_limited' ||
        payload?.error === 'no_data' ||
        payload?.error === 'bad_request'
          ? payload.error
          : 'upstream';
      const error = new Error(windyClientMessage(code));
      error.code = code;
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  return {
    label: 'Windy',
    nearby({ lat, lon, radiusKm, signal } = {}) {
      const params = new URLSearchParams({
        lat: String(lat),
        lon: String(lon),
        radiusKm: String(radiusKm),
      });
      return get(`/api/windy/webcams?${params}`, signal);
    },
    detail(id, { signal } = {}) {
      return get(`/api/windy/webcams/${encodeURIComponent(id)}`, signal);
    },
    forecast({ lat, lon, signal } = {}) {
      const params = new URLSearchParams({
        lat: String(lat),
        lon: String(lon),
      });
      return get(`/api/windy/point-forecast?${params}`, signal);
    },
  };
}
