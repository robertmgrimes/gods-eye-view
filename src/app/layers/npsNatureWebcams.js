import { createNpsNatureLayer } from '../../layers/npsNature/index.js';

/** Wire the curated NPS nature cameras to the catalog's server-backed source. */
export function createApplicationNpsNature({ source }) {
  return createNpsNatureLayer({ source });
}
