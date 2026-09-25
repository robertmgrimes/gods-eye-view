import { createKytcSource } from '../../../layers/kytc/source.js';
import { clampHits } from './shared.js';

/** Kentucky traffic stills. No key. */
export function createKytcAdapter({ source = createKytcSource() } = {}) {
  return {
    id: 'kytc',
    label: 'KYTC',
    badge: 'KYTC',
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
          source: 'kytc',
          name: camera.title || 'KYTC camera',
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
