/** Env bag for adapters. Browser bundles do not receive server secrets. */
export function readEnv(env) {
  if (env && typeof env === 'object') return env;
  if (typeof process !== 'undefined' && process.env) return process.env;
  return {};
}

export function hasKey(env, name) {
  return Boolean(String(readEnv(env)[name] || '').trim());
}

/** A disabled stub answers nothing and never reads the secret into a message. */
export function disabledSearch() {
  const error = new Error('disabled');
  error.code = 'disabled';
  return error;
}

export function clampHits(hits, limit) {
  const cap =
    Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : hits.length;
  return hits.filter(Boolean).slice(0, cap);
}
