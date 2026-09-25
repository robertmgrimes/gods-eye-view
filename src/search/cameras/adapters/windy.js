import { createWindySource } from '../../../layers/windy/source.js';
import { clampHits, hasKey, readEnv } from './shared.js';

/**
 * Windy is on when a key is configured. In the browser the key stays on the
 * server, so a missing env bag still tries the proxy. `no_key` becomes
 * disabled and is not called again for that search.
 */
export function windyEnabled(env) {
  if (env == null) return true;
  const bag = readEnv(env);
  if (bag.windyWebcams === false) return false;
  if (bag.windyWebcams === true) return true;
  if (!Object.hasOwn(bag, 'WINDY_API_KEY') && bag.windyWebcams == null)
    return true;
  return hasKey(bag, 'WINDY_API_KEY');
}

export function createWindyAdapter({ source = createWindySource(), env } = {}) {
  return {
    id: 'windy',
    label: 'Windy',
    badge: 'WINDY',
    enabled(next = env) {
      return windyEnabled(next);
    },
    async searchNear({ lat, lon, radiusKm, limit, signal } = {}) {
      if (!windyEnabled(env))
        throw Object.assign(new Error('disabled'), { code: 'disabled' });
      try {
        const payload = await source.nearby({ lat, lon, radiusKm, signal });
        const webcams = Array.isArray(payload?.webcams) ? payload.webcams : [];
        return clampHits(
          webcams.map((webcam) => ({
            id: String(webcam.id),
            source: 'windy',
            name: webcam.title || 'Windy webcam',
            lat: webcam.latitude,
            lon: webcam.longitude,
            stillUrl: null,
            pageUrl: webcam.detailUrl || null,
            updatedAt: webcam.imagesAt || null,
            record: webcam,
          })),
          limit,
        );
      } catch (error) {
        if (error?.code === 'no_key')
          throw Object.assign(new Error('disabled'), { code: 'disabled' });
        throw error;
      }
    },
  };
}
