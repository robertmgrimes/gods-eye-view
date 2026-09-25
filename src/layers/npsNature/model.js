import { NPS_NATURE_CATALOG, yosemiteConservancyHits } from './catalog.js';
import { STILL_WARM_LIMIT } from './policy.js';

const STILL_HOST = 'www.nps.gov';
const STILL_PATH = /^\/webcams-yell\/[a-z0-9_]+\.jpg$/;
const CAMERA_ID = /^[a-z0-9-]{1,40}$/;

export function npsClientMessage(code) {
  if (code === 'rate_limited') return 'NPS cameras are rate limited';
  if (code === 'not_found') return 'That camera is not in the curated set';
  if (code === 'bad_request') return 'NPS camera request was rejected';
  return 'NPS cameras are unavailable';
}

/** Public JPEG on the NPS Yellowstone still host. Nothing else is fetched. */
export function isAllowedNpsStillUrl(value) {
  if (typeof value !== 'string' || !value) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  if (url.hostname !== STILL_HOST) return false;
  if (url.search || url.hash) return false;
  return STILL_PATH.test(url.pathname);
}

export function isCameraId(value) {
  return typeof value === 'string' && CAMERA_ID.test(value);
}

/**
 * Same-origin still path. Upstream JPEG hosts never reach the page.
 */
export function sameOriginStillUrl(value) {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/api/nps-nature/cameras/')
  )
    return null;
  const [path, query = ''] = value.split('?');
  if (!/^\/api\/nps-nature\/cameras\/[a-z0-9-]{1,40}\/still$/.test(path || ''))
    return null;
  if (query && !/^t=\d{1,16}$/.test(query)) return null;
  if (value.includes('#')) return null;
  return value;
}

function publicStill(record) {
  if (record.kind !== 'still' || !isAllowedNpsStillUrl(record.stillUrl))
    return null;
  return `/api/nps-nature/cameras/${record.id}/still`;
}

/** Fields the browser is allowed to see. Upstream URLs stay on the server. */
export function publicCamera(record) {
  if (!record || !isCameraId(record.id) || !record.name) return null;
  if (record.kind !== 'still' && record.kind !== 'link') return null;
  const stillUrl = record.kind === 'still' ? publicStill(record) : null;
  if (record.kind === 'still' && !stillUrl) return null;
  const latitude = Number(record.latitude);
  const longitude = Number(record.longitude);
  const pinned =
    record.pin !== false &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude);
  return {
    id: record.id,
    name: record.name,
    kind: record.kind,
    park: record.park || '',
    place: record.place || '',
    latitude: pinned ? latitude : null,
    longitude: pinned ? longitude : null,
    approximate: pinned ? record.approximate === true : false,
    pin: pinned,
    stillUrl,
    pageUrl: typeof record.pageUrl === 'string' ? record.pageUrl : '',
    note: record.note || '',
    seasonal: record.seasonal || '',
  };
}

export function publicCatalog(records = NPS_NATURE_CATALOG) {
  return records.map((record) => publicCamera(record)).filter(Boolean);
}

export function catalogById(records = NPS_NATURE_CATALOG) {
  return new Map(records.map((record) => [record.id, record]));
}

export function parseStillIds(value, limit = STILL_WARM_LIMIT) {
  const ids = [];
  const seen = new Set();
  for (const part of String(value || '').split(',')) {
    const id = part.trim();
    if (!isCameraId(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= limit) break;
  }
  return ids;
}

export function assertNoYosemiteConservancy(records = NPS_NATURE_CATALOG) {
  const hits = yosemiteConservancyHits(records);
  if (hits.length) {
    throw new Error(
      `Yosemite Conservancy cameras are featured: ${hits.join(', ')}`,
    );
  }
  return true;
}
