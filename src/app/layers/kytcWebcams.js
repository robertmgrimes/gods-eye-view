import { createKytcWebcamsLayer } from '../../layers/kytc/index.js';

/** Wire Kentucky KYTC traffic cameras to the catalog's server-backed source. */
export function createApplicationKytcWebcams({ source }) {
  return createKytcWebcamsLayer({ source });
}
