import { algoCamerasEnabled } from '../../../layers/algo/flag.js';
import { createAlgoSource } from '../../../layers/algo/source.js';
import { clampHits } from './shared.js';

/**
 * Alabama ALGO stills. Off unless `GEV_ALGO_CAMERAS` is `1` or `true`.
 * The adapter is not called while the flag is off.
 */
export function createAlgoAdapter({
  source = createAlgoSource(),
  isEnabled = algoCamerasEnabled,
  env,
} = {}) {
  function enabled(next = env) {
    return isEnabled(next);
  }
  return {
    id: 'algo',
    label: 'ALGO',
    badge: 'ALGO',
    enabled,
    async searchNear({ lat, lon, radiusKm, limit, signal } = {}) {
      if (!enabled())
        throw Object.assign(new Error('disabled'), { code: 'disabled' });
      const payload = await source.cameras(
        { kind: 'nearby', lat, lon, radiusKm },
        { signal },
      );
      const cameras = Array.isArray(payload?.cameras) ? payload.cameras : [];
      return clampHits(
        cameras.map((camera) => ({
          id: String(camera.id),
          source: 'algo',
          name: camera.title || 'ALGO camera',
          lat: camera.latitude,
          lon: camera.longitude,
          stillUrl: camera.stillUrl || null,
          pageUrl: null,
          updatedAt: null,
          record: camera,
        })),
        limit,
      );
    },
  };
}
