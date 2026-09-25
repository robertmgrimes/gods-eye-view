import { createCwwpWebcamsLayer } from '../../layers/cwwp/index.js';

/** Wire Caltrans CWWP traffic cameras to the catalog's server-backed source. */
export function createApplicationCwwpWebcams({ source }) {
  return createCwwpWebcamsLayer({ source });
}
