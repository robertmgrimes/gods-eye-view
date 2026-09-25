import { createNpsNatureSource } from '../../../layers/npsNature/source.js';
import { distanceKm } from '../distance.js';
import { clampHits } from './shared.js';

/** Curated NPS and nature cameras. The catalog is small, so distance is local. */
export function createNpsAdapter({ source = createNpsNatureSource() } = {}) {
  return {
    id: 'nps',
    label: 'NPS',
    badge: 'NPS',
    enabled() {
      return true;
    },
    async searchNear({ lat, lon, radiusKm, limit, signal } = {}) {
      const payload = await source.cameras({ signal });
      const cameras = Array.isArray(payload?.cameras) ? payload.cameras : [];
      const radius = Number(radiusKm);
      const near = cameras.filter((camera) => {
        if (
          !Number.isFinite(camera?.latitude) ||
          !Number.isFinite(camera?.longitude)
        )
          return false;
        if (!Number.isFinite(radius) || radius <= 0) return true;
        return (
          distanceKm(lat, lon, camera.latitude, camera.longitude) <= radius
        );
      });
      return clampHits(
        near.map((camera) => ({
          id: String(camera.id),
          source: 'nps',
          name: camera.name || 'NPS camera',
          lat: camera.latitude,
          lon: camera.longitude,
          stillUrl: camera.stillUrl || null,
          pageUrl: camera.pageUrl || null,
          updatedAt: null,
          record: camera,
        })),
        limit,
      );
    },
  };
}
