import { createCwwpSource } from '../../../layers/cwwp/source.js';
import { districtsForQuery, parseNearby } from '../../../layers/cwwp/model.js';
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
      const query = parseNearby({ lat, lon, radiusKm }) || {
        kind: 'nearby',
        lat,
        lon,
        radiusKm,
      };
      const districts = districtsForQuery(query);
      const jobs = districts.length ? districts : [null];
      const cameras = [];
      await Promise.all(
        jobs.map(async (district) => {
          const next = district == null ? query : { ...query, district };
          try {
            const payload = await source.cameras(next, { signal });
            const rows = Array.isArray(payload?.cameras) ? payload.cameras : [];
            cameras.push(...rows);
          } catch (error) {
            if (signal?.aborted || error?.name === 'AbortError') throw error;
          }
        }),
      );
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
