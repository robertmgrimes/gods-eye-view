import { hasKey } from './shared.js';

/**
 * Future department-of-transportation cameras join by adding an adapter
 * file and registering it in `src/search/cameras/index.js`. The panel does
 * not change. `enabled(env)` turns the adapter on when its key exists.
 *
 * These three are stubs. They are not called unless the named variable is
 * set, they do not open a network request, and they never interpolate a
 * secret into a message or a log line.
 *
 *   DOT_GA_511_API_KEY   Georgia 511
 *   DOT_LA_511_API_KEY   Louisiana 511
 *   WSDOT_ACCESS_CODE    Washington State DOT
 *
 * Example of a real adapter once a proxy exists:
 *
 *   export function createExampleAdapter({ source, env } = {}) {
 *     return {
 *       id: 'example',
 *       label: 'Example',
 *       badge: 'EX',
 *       enabled: () => hasKey(env, 'EXAMPLE_API_KEY'),
 *       searchNear: (query) => source.nearby(query),
 *     };
 *   }
 */

function createKeyedStub({ id, label, badge, envName, env }) {
  function enabled(next = env) {
    return hasKey(next, envName);
  }
  return {
    id,
    label,
    badge,
    envName,
    enabled,
    async searchNear({ signal } = {}) {
      signal?.throwIfAborted?.();
      if (!enabled())
        throw Object.assign(new Error('disabled'), { code: 'disabled' });
      return [];
    },
  };
}

export function createGa511Adapter({ env } = {}) {
  return createKeyedStub({
    id: 'ga-511',
    label: 'GA 511',
    badge: 'GA 511',
    envName: 'DOT_GA_511_API_KEY',
    env,
  });
}

export function createLa511Adapter({ env } = {}) {
  return createKeyedStub({
    id: 'la-511',
    label: 'LA 511',
    badge: 'LA 511',
    envName: 'DOT_LA_511_API_KEY',
    env,
  });
}

export function createWsdotAdapter({ env } = {}) {
  return createKeyedStub({
    id: 'wsdot',
    label: 'WSDOT',
    badge: 'WSDOT',
    envName: 'WSDOT_ACCESS_CODE',
    env,
  });
}
