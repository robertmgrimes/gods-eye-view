/**
 * Alabama ALGO cameras are experimental and off unless this process was
 * started with an explicit opt-in. Unset, empty, 0, and any other word stay
 * off so a normal launch cannot fetch the undocumented feed.
 *
 * The browser bundle receives only `1` or `` via the Vite define
 * `__GEV_ALGO_CAMERAS__`. Node (the proxy and unit tests) reads
 * `process.env.GEV_ALGO_CAMERAS` when that define is absent.
 */

export function readAlgoCamerasFlag(value) {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase();
  return raw === '1' || raw === 'true';
}

function bundledAlgoCamerasFlag() {
  if (typeof __GEV_ALGO_CAMERAS__ !== 'string') return undefined;
  return __GEV_ALGO_CAMERAS__;
}

export function algoCamerasEnabled(env) {
  const bundled = bundledAlgoCamerasFlag();
  if (bundled !== undefined) return readAlgoCamerasFlag(bundled);
  const source =
    env ?? (typeof process !== 'undefined' ? process.env : undefined);
  return readAlgoCamerasFlag(source?.GEV_ALGO_CAMERAS);
}
