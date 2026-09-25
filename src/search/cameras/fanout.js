import { sortByDistance } from './distance.js';

/** Per-source budget. A slow feed must not hold the others. */
export const SOURCE_TIMEOUT_MS = 4000;

/** Default search radius. Server proxies clamp their own wider limits. */
export const DEFAULT_RADIUS_KM = 40;

/** Cameras kept from each source. The merged list stays short. */
export const DEFAULT_LIMIT = 8;

const STATUS = Object.freeze({
  ok: 'ok',
  empty: 'no results',
  timeout: 'timed out',
  error: 'error',
  disabled: 'disabled',
});

function finitePoint(lat, lon) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  );
}

function abortError() {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

function snapshot(near, byName, statuses) {
  return {
    near: near.map((hit) => ({ ...hit })),
    byName: byName.map((hit) => ({ ...hit })),
    statuses: statuses.map((row) => ({ ...row })),
  };
}

/**
 * One source, one AbortController, one timeout.
 * Name-only hits stay out of the distance list.
 */
async function runAdapter(adapter, request, bucket) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, request.timeoutMs);
  const onParent = () => controller.abort();
  request.signal?.addEventListener('abort', onParent);
  const row = bucket.statuses.find((entry) => entry.id === adapter.id);
  try {
    if (request.signal?.aborted) throw abortError();
    const signal = controller.signal;
    const geo = [];
    const named = [];
    if (request.point && typeof adapter.searchNear === 'function') {
      const hits = await adapter.searchNear({
        lat: request.point.lat,
        lon: request.point.lon,
        radiusKm: request.radiusKm,
        limit: request.limit,
        signal,
      });
      for (const hit of Array.isArray(hits) ? hits : []) {
        if (!hit || hit.source !== adapter.id) continue;
        if (finitePoint(hit.lat, hit.lon)) geo.push(hit);
        else named.push(hit);
      }
    }
    if (request.query && typeof adapter.searchByName === 'function') {
      const hits = await adapter.searchByName(request.query, { signal });
      for (const hit of Array.isArray(hits) ? hits : []) {
        if (!hit || hit.source !== adapter.id) continue;
        named.push({ ...hit, lat: undefined, lon: undefined });
      }
    }
    if (request.signal?.aborted) throw abortError();
    bucket.near.push(...geo);
    bucket.byName.push(...named);
    row.status = geo.length || named.length ? STATUS.ok : STATUS.empty;
  } catch (error) {
    if (request.signal?.aborted) {
      row.status = 'aborted';
      return;
    }
    if (
      timedOut ||
      error?.name === 'AbortError' ||
      error?.name === 'TimeoutError'
    )
      row.status = STATUS.timeout;
    else if (error?.code === 'disabled') row.status = STATUS.disabled;
    else row.status = STATUS.error;
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener('abort', onParent);
  }
}

/**
 * Fan a place out across enabled camera adapters.
 * `onUpdate` fires as each source settles, with the distance list resorted.
 *
 * @param {{ adapters: object[], env?: object }} registry
 * @param {{ lat?: number, lon?: number, query?: string, radiusKm?: number, limit?: number, timeoutMs?: number, signal?: AbortSignal, onUpdate?: (result: object) => void }} request
 */
export async function searchCameras(registry, request = {}) {
  const env = request.env ?? registry.env;
  const adapters = Array.isArray(registry?.adapters) ? registry.adapters : [];
  const point = finitePoint(request.lat, request.lon)
    ? { lat: request.lat, lon: request.lon }
    : null;
  const query = String(request.query || '').trim();
  const timeoutMs =
    Number.isFinite(request.timeoutMs) && request.timeoutMs > 0
      ? request.timeoutMs
      : SOURCE_TIMEOUT_MS;
  const radiusKm =
    Number.isFinite(request.radiusKm) && request.radiusKm > 0
      ? request.radiusKm
      : DEFAULT_RADIUS_KM;
  const limit =
    Number.isFinite(request.limit) && request.limit > 0
      ? Math.floor(request.limit)
      : DEFAULT_LIMIT;
  const bucket = {
    near: [],
    byName: [],
    statuses: adapters.map((adapter) => ({
      id: adapter.id,
      label: adapter.label,
      badge: adapter.badge,
      status: adapter.enabled?.(env) ? 'loading' : STATUS.disabled,
    })),
  };
  const publish = () => {
    const result = snapshot(
      point ? sortByDistance(bucket.near, point) : bucket.near.slice(),
      bucket.byName,
      bucket.statuses.filter((row) => row.status !== 'aborted'),
    );
    request.onUpdate?.(result);
    return result;
  };
  if (request.signal?.aborted) throw abortError();
  publish();
  await Promise.all(
    adapters.map((adapter) => {
      if (!adapter.enabled?.(env)) return null;
      return runAdapter(
        adapter,
        { point, query, radiusKm, limit, timeoutMs, signal: request.signal },
        bucket,
      ).then(() => {
        if (!request.signal?.aborted) publish();
      });
    }),
  );
  if (request.signal?.aborted) throw abortError();
  return publish();
}
