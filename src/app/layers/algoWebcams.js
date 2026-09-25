import { createAlgoWebcamsLayer } from '../../layers/algo/index.js';

/** Wire Alabama ALGO traffic cameras to the catalog's server-backed source. */
export function createApplicationAlgoWebcams({ source }) {
  return createAlgoWebcamsLayer({ source });
}
