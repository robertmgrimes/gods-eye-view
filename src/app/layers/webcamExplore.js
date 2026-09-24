import { createWebcamExploreLayer } from '../../layers/webcamExplore/index.js';

/** Wire Webcam Explore discovery to the catalog's server-backed source. */
export function createApplicationWebcamExplore({ source }) {
  return createWebcamExploreLayer({ source });
}
