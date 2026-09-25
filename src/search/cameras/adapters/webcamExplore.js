import { createWebcamExploreSource } from '../../../layers/webcamExplore/source.js';
import { publicWebcam } from '../../../layers/webcamExplore/model.js';
import { clampHits } from './shared.js';

/**
 * Webcam Explore has no coordinates. Matches stay in the By name section
 * and open `page_url` in a new tab.
 */
export function createWebcamExploreAdapter({
  source = createWebcamExploreSource(),
} = {}) {
  return {
    id: 'webcam-explore',
    label: 'Webcam Explore',
    badge: 'EXPLORE',
    enabled() {
      return true;
    },
    async searchByName(query, { signal } = {}) {
      const text = String(query || '').trim();
      if (!text) return [];
      const payload = await source.search({ query: text, signal });
      const webcams = Array.isArray(payload?.webcams) ? payload.webcams : [];
      return clampHits(
        webcams.map((row) => {
          const webcam = publicWebcam(row);
          if (!webcam) return null;
          return {
            id: webcam.id,
            source: 'webcam-explore',
            name: webcam.title,
            stillUrl: webcam.thumbnail_url,
            pageUrl: webcam.page_url,
            updatedAt: null,
            record: webcam,
          };
        }),
        8,
      );
    },
  };
}
