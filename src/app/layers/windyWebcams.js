import { createWindyWebcamsLayer } from '../../layers/windy/index.js';

/** Wire Windy webcams to the catalog's server-backed source. */
export function createApplicationWindyWebcams({ source }) {
  return createWindyWebcamsLayer({ source });
}
