import { createCwwpSource } from '../../../layers/cwwp/source.js';
import { clampHits } from './shared.js';

/** Caltrans CWWP stills. No key. */
export function createCwwpAdapter({ source = createCwwpSource() } = {}) {
  return {
    id: 'cwwp',
    label: 'Caltrans',
    badge: 'CALTRANS',
    enabled() {
      return true;
    },
    async searchNear({ lat, lon, radiusKm, limit, signal } = {}) {
      const payload = await source.cameras(
        { kind: 'nearby', lat, lon, radiusKm },
        { signal },
      );
      const cameras = Array.isArray(payload?.cameras) ? payload.cameras : [];
      return clampHits(
        cameras.map((camera) => ({
          id: String(camera.id),
          source: 'cwwp',
          name: camera.title || 'Caltrans camera',
          lat: camera.latitude,
          lon: camera.longitude,
          stillUrl: camera.stillUrl || null,
          pageUrl: null,
          updatedAt: camera.updatedAt || null,
          record: camera,
        })),
        limit,
      );
    },
  };
}
