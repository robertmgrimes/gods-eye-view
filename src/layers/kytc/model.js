import { MAX_CAMERAS, NEARBY_RADIUS_KM, SERVICE_BOUNDS } from './policy.js';

const VIDEO_PATH =
  /\.(?:m3u8|mp4|m4s|ts|mpd)(?:$|[?#])|\/hls(?:\/|$)|playlist/i;
const INDIANA = /\bindiana\b/i;

function text(value, max = 180) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function lonSpans(west, east) {
  if (west <= east) return [[west, east]];
  return [
    [west, 180],
    [-180, east],
  ];
}

function lonRangesOverlap(west, east, otherWest, otherEast) {
  const left = lonSpans(west, east);
  const right = lonSpans(otherWest, otherEast);
  return left.some(([a, b]) => right.some(([c, d]) => a <= d && c <= b));
}

/**
 * A still the browser can show. KYTC publishes plain HTTP JPEGs, so http and
 * https are both accepted here; the proxy is what the page actually loads.
 * Playlists and video files are refused — this layer is stills only.
 */
export function stillImageUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  const path = `${url.pathname}${url.search}`;
  if (VIDEO_PATH.test(path)) return null;
  return url.toString();
}

function ipv4Blocked(host) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => part > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function ipv6Blocked(hostname) {
  const host = hostname.toLowerCase();
  if (!host.includes(':')) return false;
  if (host === '::' || host === '::1') return true;
  if (
    host.startsWith('fe80:') ||
    host.startsWith('fc') ||
    host.startsWith('fd')
  )
    return true;
  // Mapped IPv4 can hide a loopback address from the dotted-quad check.
  if (host.startsWith('::ffff:')) return true;
  return false;
}

/** Public http(s) image URL. Private and link-local hosts are refused. */
export function isAllowedSnapshotUrl(value) {
  const still = stillImageUrl(value);
  if (!still) return false;
  let url;
  try {
    url = new URL(still);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase().replace(/\.+$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost'))
    return false;
  if (host.endsWith('.local')) return false;
  if (ipv4Blocked(host) || ipv6Blocked(host)) return false;
  return true;
}

/**
 * Same-origin still path. Anything else (http snapshots, other hosts) stays
 * off the page so a public HTTP JPEG is not loaded as mixed content.
 */
export function sameOriginStillUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('/api/kytc/webcams/'))
    return null;
  const [path, query = ''] = value.split('?');
  if (!/^\/api\/kytc\/webcams\/\d{1,12}\/still$/.test(path || '')) return null;
  if (
    query &&
    !/^[A-Za-z0-9_]+=[A-Za-z0-9_.%-]*(?:&[A-Za-z0-9_]+=[A-Za-z0-9_.%-]*)*$/.test(
      query,
    )
  )
    return null;
  if (value.includes('#')) return null;
  return value;
}

function finiteCoord(value, min, max) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return null;
  return number;
}

/** View envelope. West may be greater than east when the view crosses the dateline. */
export function parseBBox({ west, south, east, north } = {}) {
  const latSouth = finiteCoord(south, -90, 90);
  const latNorth = finiteCoord(north, -90, 90);
  const lonWest = finiteCoord(west, -180, 180);
  const lonEast = finiteCoord(east, -180, 180);
  if (
    latSouth === null ||
    latNorth === null ||
    lonWest === null ||
    lonEast === null ||
    latSouth > latNorth
  )
    return null;
  return {
    kind: 'bbox',
    west: round(lonWest, 5),
    south: round(latSouth, 5),
    east: round(lonEast, 5),
    north: round(latNorth, 5),
  };
}

/** Nearby circle. An omitted radius starts at the layer default. */
export function parseNearby({ lat, lon, radiusKm } = {}) {
  const latitude = finiteCoord(lat, -90, 90);
  const longitude = finiteCoord(lon, -180, 180);
  if (latitude === null || longitude === null) return null;
  const radius =
    radiusKm === undefined || radiusKm === null || radiusKm === ''
      ? NEARBY_RADIUS_KM
      : Number(radiusKm);
  if (!Number.isFinite(radius) || radius < 1 || radius > 250) return null;
  return {
    kind: 'nearby',
    lat: round(latitude, 4),
    lon: round(longitude, 4),
    radiusKm: Math.round(radius),
  };
}

/** One of bbox or nearby. Both, or neither, is a 400. */
export function parseCameraQuery(searchParams) {
  if (!searchParams?.has) return null;
  const boxKeys = ['west', 'south', 'east', 'north'];
  const hasBox = boxKeys.some((key) => searchParams.has(key));
  const hasNear =
    searchParams.has('lat') ||
    searchParams.has('lon') ||
    searchParams.has('radiusKm');
  if (hasBox === hasNear) return null;
  if (hasBox) {
    if (!boxKeys.every((key) => searchParams.has(key))) return null;
    return parseBBox({
      west: searchParams.get('west'),
      south: searchParams.get('south'),
      east: searchParams.get('east'),
      north: searchParams.get('north'),
    });
  }
  return parseNearby({
    lat: searchParams.get('lat'),
    lon: searchParams.get('lon'),
    radiusKm: searchParams.has('radiusKm')
      ? searchParams.get('radiusKm')
      : undefined,
  });
}

export function pointInBBox(lat, lon, box) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !box) return false;
  if (lat < box.south || lat > box.north) return false;
  return lonSpans(box.west, box.east).some(
    ([west, east]) => lon >= west && lon <= east,
  );
}

/** True when the requested view can contain a KYTC camera. */
export function queryIntersectsService(query) {
  if (!query) return false;
  if (query.kind === 'bbox') {
    if (
      query.north < SERVICE_BOUNDS.south ||
      query.south > SERVICE_BOUNDS.north
    )
      return false;
    return lonRangesOverlap(
      query.west,
      query.east,
      SERVICE_BOUNDS.west,
      SERVICE_BOUNDS.east,
    );
  }
  const pad = query.radiusKm / 111;
  return pointInBBox(query.lat, query.lon, {
    south: SERVICE_BOUNDS.south - pad,
    north: SERVICE_BOUNDS.north + pad,
    west: Math.max(-180, SERVICE_BOUNDS.west - pad),
    east: Math.min(180, SERVICE_BOUNDS.east + pad),
  });
}

export function cameraInQuery(camera, query) {
  if (!camera || !query) return false;
  if (query.kind === 'bbox')
    return pointInBBox(camera.latitude, camera.longitude, query);
  return (
    haversineKm(query.lat, query.lon, camera.latitude, camera.longitude) <=
    query.radiusKm
  );
}

function epochMs(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return number < 1e12 ? Math.round(number * 1000) : Math.round(number);
}

/**
 * One camera the globe can pin. `snapshot` is the upstream still and stays on
 * the server. The browser receives `stillUrl` instead.
 */
export function normalizeCamera(raw) {
  const attrs =
    raw?.attributes && typeof raw.attributes === 'object'
      ? raw.attributes
      : raw;
  if (!attrs || typeof attrs !== 'object') return null;
  const id = text(attrs.OBJECTID ?? attrs.objectId ?? attrs.objectid, 12);
  if (!/^\d{1,12}$/.test(id)) return null;
  const latitude = Number(attrs.latitude);
  const longitude = Number(attrs.longitude);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  )
    return null;
  const description = text(attrs.description, 180);
  const highway = text(attrs.highway, 80);
  const name = text(attrs.name, 80);
  const snapshot = isAllowedSnapshotUrl(attrs.snapshot)
    ? stillImageUrl(attrs.snapshot)
    : null;
  return {
    id,
    title: name || description || highway || 'KYTC camera',
    highway,
    description,
    direction: text(attrs.direction, 40),
    status: text(attrs.status, 32),
    county: text(attrs.county, 80),
    district: text(attrs.DISTRICT ?? attrs.district, 8),
    state: text(attrs.state, 40),
    place: null,
    latitude,
    longitude,
    updatedAt: epochMs(attrs.updateTS ?? attrs.updatets),
    snapshot,
  };
}

/**
 * The KY layer mixes in Indiana border cameras. Name that when the record
 * says so; everything else in this feed is carried as Kentucky.
 */
export function cameraPlace(camera) {
  const state = String(camera?.state || '')
    .trim()
    .toLowerCase();
  const label = `${camera?.description || ''} ${camera?.title || ''} ${camera?.name || ''}`;
  if (state === 'in' || state === 'indiana' || INDIANA.test(label))
    return 'Indiana';
  if (state && state !== 'ky' && state !== 'kentucky') return camera.state;
  return 'Kentucky';
}

export function extractCameraFeatures(body) {
  if (Array.isArray(body?.features)) return body.features;
  return [];
}

/** Drop the upstream image address before a camera leaves the server. */
export function publicCamera(camera) {
  if (!camera?.id) return null;
  return {
    id: camera.id,
    title: camera.title,
    highway: camera.highway,
    description: camera.description,
    direction: camera.direction,
    status: camera.status,
    county: camera.county,
    district: camera.district,
    state: camera.state,
    place: cameraPlace(camera),
    latitude: camera.latitude,
    longitude: camera.longitude,
    updatedAt: camera.updatedAt,
    stillUrl: camera.snapshot ? `/api/kytc/webcams/${camera.id}/still` : null,
  };
}

/** OBJECTIDs a client may ask to refresh. Anything else is ignored. */
export function parseStillIds(value) {
  if (typeof value !== 'string' || !value.trim()) return [];
  const ids = [];
  const seen = new Set();
  for (const part of value.split(',')) {
    const id = part.trim();
    if (!/^\d{1,12}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= MAX_CAMERAS) break;
  }
  return ids;
}

export function camerasForQuery(cameras, query) {
  return cameras
    .filter((camera) => cameraInQuery(camera, query))
    .slice(0, MAX_CAMERAS);
}

export function kytcClientMessage(code) {
  switch (code) {
    case 'bad_request':
      return 'That view could not be queried.';
    case 'rate_limited':
      return 'KYTC rate limit. Try again shortly.';
    case 'not_found':
      return 'That camera is no longer in the catalog.';
    default:
      return 'KYTC cameras are temporarily unavailable.';
  }
}
