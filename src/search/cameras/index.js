import { createAlgoAdapter } from './adapters/algo.js';
import { createCwwpAdapter } from './adapters/cwwp.js';
import {
  createGa511Adapter,
  createLa511Adapter,
  createWsdotAdapter,
} from './adapters/futureDot.js';
import { createKytcAdapter } from './adapters/kytc.js';
import { createNpsAdapter } from './adapters/nps.js';
import { createWebcamExploreAdapter } from './adapters/webcamExplore.js';
import { createWindyAdapter } from './adapters/windy.js';
import { searchCameras } from './fanout.js';

export {
  searchCameras,
  SOURCE_TIMEOUT_MS,
  DEFAULT_RADIUS_KM,
  DEFAULT_LIMIT,
} from './fanout.js';
export { distanceKm, sortByDistance } from './distance.js';
export { resolveCameraPlace } from './geocode.js';

/**
 * Camera-source adapters. A new feed joins by appending one adapter whose
 * `enabled(env)` reads its own flag or key. The Find cameras panel reads
 * this list and does not grow a per-source control.
 *
 * @param {object} [options]
 * @param {object} [options.env] Flag and key bag. Omit it in the browser so
 *   server-held keys are decided by the proxies.
 */
export function createCameraSearchRegistry(options = {}) {
  const env = options.env;
  const adapters = [
    createWindyAdapter({ source: options.windy, env }),
    createKytcAdapter({ source: options.kytc }),
    createCwwpAdapter({ source: options.cwwp }),
    createAlgoAdapter({ source: options.algo, env }),
    createNpsAdapter({ source: options.nps }),
    createWebcamExploreAdapter({ source: options.webcamExplore }),
    createGa511Adapter({ env }),
    createLa511Adapter({ env }),
    createWsdotAdapter({ env }),
  ];
  return {
    env,
    adapters,
    search(request = {}) {
      return searchCameras(this, { ...request, env: request.env ?? env });
    },
  };
}
