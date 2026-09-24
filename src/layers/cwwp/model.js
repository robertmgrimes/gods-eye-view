import { MAX_CAMERAS, NEARBY_RADIUS_KM, SERVICE_BOUNDS } from './policy.js';

const VIDEO_PATH =
  /\.(?:m3u8|mp4|m4s|ts|mpd)(?:$|[?#])|\/hls(?:\/|$)|playlist/i;
const IMAGE_EXT = /\.(?:jpe?g|png|gif|webp)$/i;
const STILL_HOST = 'cwwp2.dot.ca.gov';
const CAMERA_ID = /^d(?:0[1-9]|1[0-2])-\d{1,6}$/;

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

function midLon(west, east) {
  if (west <= east) return (west + east) / 2;
  const span = east + 360 - west;
  let lon = west + span / 2;
  if (lon > 180) lon -= 360;
  return lon;
}

/**
 * A still the browser can show after the proxy fetches it. Caltrans publishes
 * HTTPS JPEGs on cwwp2. Playlists and any other host are refused — this layer
 * does not open wzmedia HLS.
 */
export function stillImageUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  const path = `${url.pathname}${url.search}`;
  if (VIDEO_PATH.test(path) || !IMAGE_EXT.test(url.pathname)) return null;
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
  if (host.startsWith('::ffff:')) return true;
  return false;
}

/** HTTPS image on the Caltrans CWWP host. Private hosts and HLS are refused. */
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
  if (host !== STILL_HOST) return false;
  if (ipv4Blocked(host) || ipv6Blocked(host)) return false;
  return true;
}

/** District camera id. Indexes repeat across districts, so the district is part of it. */
export function cameraId(district, index) {
  const n = Number(district);
  const idx = text(index, 8);
  if (!Number.isInteger(n) || n < 1 || n > 12) return null;
  if (!/^\d{1,6}$/.test(idx)) return null;
  return `d${String(n).padStart(2, '0')}-${idx}`;
}

export function isCameraId(value) {
  return CAMERA_ID.test(String(value || ''));
}

/**
 * Same-origin still path. The upstream JPEG stays off the page.
 */
export function sameOriginStillUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('/api/cwwp/webcams/'))
    return null;
  const [path, query = ''] = value.split('?');
  if (
    !/^\/api\/cwwp\/webcams\/d(?:0[1-9]|1[0-2])-\d{1,6}\/still$/.test(
      path || '',
    )
  )
    return null;
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

/**
 * One district status file. The directory uses d1…d12; the file uses D01…D12.
 */
export function districtStatusUrl(district) {
  const n = Number(district);
  if (!Number.isInteger(n) || n < 1 || n > 12) return null;
  const nn = String(n).padStart(2, '0');
  return `https://cwwp2.dot.ca.gov/data/d${n}/cctv/cctvStatusD${nn}.json`;
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

/** Camera height in meters to a nearby radius. Street zoom stays tight. */
export function nearbyRadiusForHeight(heightMeters) {
  const km = Number(heightMeters) / 1000;
  if (!Number.isFinite(km) || km <= 0) return NEARBY_RADIUS_KM;
  return Math.max(2, Math.min(NEARBY_RADIUS_KM, Math.round(km)));
}

/** A rectangle big enough to see past a state, including the whole ellipsoid. */
export function viewBoxIsBroad(box) {
  if (!box || box.kind !== 'bbox') return true;
  const latSpan = box.north - box.south;
  let lonSpan = box.east - box.west;
  if (lonSpan < 0) lonSpan += 360;
  return latSpan > 8 || lonSpan > 8;
}

/**
 * Prefer the real view rectangle. Cesium reports the whole globe before the
 * camera settles and while the ellipsoid is hidden, so that case uses a
 * height-scaled circle around the ground center.
 */
export function preferLocalQuery(box, center, heightMeters) {
  if (box && !viewBoxIsBroad(box)) return box;
  if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lon))
    return null;
  return parseNearby({
    lat: center.lat,
    lon: center.lon,
    radiusKm: nearbyRadiusForHeight(heightMeters),
  });
}

export function pointInBBox(lat, lon, box) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !box) return false;
  if (lat < box.south || lat > box.north) return false;
  return lonSpans(box.west, box.east).some(
    ([west, east]) => lon >= west && lon <= east,
  );
}

/** True when the requested view can contain a Caltrans camera. */
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

function queryCenter(query) {
  if (query?.kind === 'nearby') return { lat: query.lat, lon: query.lon };
  return {
    lat: (query.south + query.north) / 2,
    lon: midLon(query.west, query.east),
  };
}

/**
 * One in-service camera the globe can pin. `snapshot` is the upstream still
 * and stays on the server. Out-of-service rows and HLS addresses are dropped.
 * The district argument is the file the row came from, so repeated indexes
 * stay distinct.
 */
export function normalizeCamera(raw, fileDistrict) {
  const cctv = raw?.cctv && typeof raw.cctv === 'object' ? raw.cctv : raw;
  if (!cctv || typeof cctv !== 'object') return null;
  if (cctv.inService !== 'true') return null;
  const location =
    cctv.location && typeof cctv.location === 'object' ? cctv.location : {};
  const id = cameraId(fileDistrict, cctv.index);
  if (!id) return null;
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  )
    return null;
  const still = cctv.imageData?.static?.currentImageURL;
  const snapshot = isAllowedSnapshotUrl(still) ? stillImageUrl(still) : null;
  const frequency = Number(cctv.imageData?.static?.currentImageUpdateFrequency);
  const name = text(location.locationName, 180);
  return {
    id,
    title: name || 'Caltrans camera',
    route: text(location.route, 40),
    direction: text(location.direction, 40),
    county: text(location.county, 80),
    place: text(location.nearbyPlace, 80),
    district: String(Number(fileDistrict)),
    latitude,
    longitude,
    updatedAt: epochMs(cctv.recordTimestamp?.recordEpoch),
    updateFrequencyMinutes:
      Number.isFinite(frequency) && frequency > 0 ? frequency : 2,
    snapshot,
  };
}

export function extractCctvRecords(body) {
  if (Array.isArray(body?.data)) return body.data;
  return [];
}

/** Drop the upstream image address before a camera leaves the server. */
export function publicCamera(camera) {
  if (!camera?.id) return null;
  return {
    id: camera.id,
    title: camera.title,
    route: camera.route,
    direction: camera.direction,
    county: camera.county,
    place: camera.place,
    district: camera.district,
    latitude: camera.latitude,
    longitude: camera.longitude,
    updatedAt: camera.updatedAt,
    stillUrl: camera.snapshot ? `/api/cwwp/webcams/${camera.id}/still` : null,
  };
}

/** Camera ids a client may ask to refresh. Anything else is ignored. */
export function parseStillIds(value) {
  if (typeof value !== 'string' || !value.trim()) return [];
  const ids = [];
  const seen = new Set();
  for (const part of value.split(',')) {
    const id = part.trim();
    if (!isCameraId(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= MAX_CAMERAS) break;
  }
  return ids;
}

export function camerasForQuery(cameras, query) {
  const inside = cameras.filter((camera) => cameraInQuery(camera, query));
  if (inside.length <= MAX_CAMERAS) return inside;
  const center = queryCenter(query);
  inside.sort((a, b) => {
    const da = (a.latitude - center.lat) ** 2 + (a.longitude - center.lon) ** 2;
    const db = (b.latitude - center.lat) ** 2 + (b.longitude - center.lon) ** 2;
    return da - db || (a.id < b.id ? -1 : 1);
  });
  return inside.slice(0, MAX_CAMERAS);
}

export function cwwpClientMessage(code) {
  switch (code) {
    case 'bad_request':
      return 'That view could not be queried.';
    case 'rate_limited':
      return 'Caltrans rate limit. Try again shortly.';
    case 'not_found':
      return 'That camera is no longer in the catalog.';
    default:
      return 'Caltrans cameras are temporarily unavailable.';
  }
}
