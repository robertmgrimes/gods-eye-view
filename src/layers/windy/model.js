import { IMAGE_URL_MAX_AGE_MS, NEARBY_RADIUS_KM } from './policy.js';

export const WINDY_TESTING_DISCLAIMER =
  'Testing/demo data — Windy Testing tier may shuffle or modify these numbers.';

const COMPASS = Object.freeze([
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
]);

/** True while a tokenized still is young enough to display. */
export function imageUrlFresh(imagesAt, now = Date.now()) {
  const at = Number(imagesAt);
  if (!Number.isFinite(at)) return false;
  const age = now - at;
  // A few minutes of clock skew still counts as fresh. Past the max age the
  // token is treated as expired and must be fetched again.
  return age < IMAGE_URL_MAX_AGE_MS && age > -5 * 60 * 1000;
}

/**
 * HTTPS stills only. Playlist and HLS paths are refused — this API tier
 * does not provide a live video stream.
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
  const path = `${url.pathname}${url.search}`.toLowerCase();
  if (
    path.includes('.m3u8') ||
    path.includes('/hls') ||
    path.includes('playlist') ||
    path.includes('.mp4')
  )
    return null;
  return url.toString();
}

function scrubString(value, secrets) {
  if (typeof value !== 'string') return value;
  return secrets.some((secret) => secret && value.includes(secret))
    ? ''
    : value;
}

/** Drop credential material from an untrusted JSON tree before it is stored or sent. */
export function scrubSecrets(value, secrets = []) {
  const banned = secrets.map((secret) => String(secret || '')).filter(Boolean);
  if (!banned.length) return value;
  if (typeof value === 'string') return scrubString(value, banned);
  if (Array.isArray(value))
    return value.map((entry) => scrubSecrets(entry, banned));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (/^(key|apikey|api_key|x-windy-api-key)$/i.test(key)) continue;
    out[key] = scrubSecrets(child, banned);
  }
  return out;
}

function text(value, max = 180) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function statusToken(value) {
  const token = text(value, 32).toLowerCase();
  return /^[a-z0-9_-]{1,32}$/.test(token) ? token : '';
}

/**
 * One webcam the globe can pin. Image URLs are included only for a fresh
 * detail response; the nearby list keeps location and title.
 */
export function normalizeWebcam(
  raw,
  { includeImages = false, now = Date.now() } = {},
) {
  if (!raw || typeof raw !== 'object') return null;
  const id = text(raw.webcamId ?? raw.id, 12);
  if (!/^\d{1,12}$/.test(id)) return null;
  const location =
    raw.location && typeof raw.location === 'object' ? raw.location : {};
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  )
    return null;
  const images = raw.images && typeof raw.images === 'object' ? raw.images : {};
  const current =
    images.current && typeof images.current === 'object' ? images.current : {};
  const daylight =
    images.daylight && typeof images.daylight === 'object'
      ? images.daylight
      : {};
  const urls = raw.urls && typeof raw.urls === 'object' ? raw.urls : {};
  const webcam = {
    id,
    title: text(raw.title, 180) || 'Windy webcam',
    status: statusToken(raw.status),
    latitude,
    longitude,
    city: text(location.city, 80),
    region: text(location.region, 80),
    country: text(location.country, 80),
    detailUrl: httpsPage(urls.detail),
    preview: null,
    thumbnail: null,
    imagesAt: null,
  };
  if (includeImages) {
    webcam.preview =
      stillImageUrl(current.preview) ||
      stillImageUrl(daylight.preview) ||
      stillImageUrl(current.thumbnail) ||
      stillImageUrl(daylight.thumbnail);
    webcam.thumbnail =
      stillImageUrl(current.thumbnail) || stillImageUrl(daylight.thumbnail);
    webcam.imagesAt = webcam.preview || webcam.thumbnail ? now : null;
  }
  return webcam;
}

function httpsPage(value) {
  if (typeof value !== 'string' || !value) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const path = `${url.pathname}${url.search}`.toLowerCase();
  if (path.includes('.m3u8') || path.includes('/hls') || path.includes('.mp4'))
    return null;
  return url.toString();
}

export function extractWebcamList(body) {
  if (Array.isArray(body?.webcams)) return body.webcams;
  if (Array.isArray(body)) return body;
  return [];
}

export function extractWebcamRecord(body) {
  if (!body || typeof body !== 'object') return null;
  if (Array.isArray(body.webcams)) return body.webcams[0] || null;
  if (body.webcam && typeof body.webcam === 'object') return body.webcam;
  if (body.webcamId != null || body.id != null) return body;
  return null;
}

/** Validate a nearby query. Null is a 400. Omitted radius starts at 50 km. */
export function parseNearbyQuery({ lat, lon, radiusKm } = {}) {
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)
    return null;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)
    return null;
  const radius =
    radiusKm === undefined || radiusKm === null || radiusKm === ''
      ? NEARBY_RADIUS_KM
      : Number(radiusKm);
  if (!Number.isFinite(radius) || radius < 1 || radius > 250) return null;
  return {
    lat: Math.round(latitude * 10000) / 10000,
    lon: Math.round(longitude * 10000) / 10000,
    radiusKm: Math.round(radius),
  };
}

/** Point Forecast wants coordinates rounded to 2 decimal degrees. */
export function parseForecastPoint({ lat, lon } = {}) {
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)
    return null;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)
    return null;
  return {
    lat: Math.round(latitude * 100) / 100,
    lon: Math.round(longitude * 100) / 100,
  };
}

function epochMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
}

function temperatureC(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const name = String(unit || 'K').toLowerCase();
  if (name === 'k' || name === 'kelvin') return n - 273.15;
  if (name === 'f' || name === 'fahrenheit') return ((n - 32) * 5) / 9;
  return n;
}

function pressureHpa(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const name = String(unit || 'Pa').toLowerCase();
  if (name === 'pa') return n / 100;
  if (name === 'hpa' || name === 'mbar' || name === 'mb') return n;
  return n > 2000 ? n / 100 : n;
}

function precipMm(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const name = String(unit || 'mm').toLowerCase();
  if (name === 'm' || name === 'meter' || name === 'meters') return n * 1000;
  return n;
}

/** Meteorological direction the wind comes FROM, degrees clockwise from north. */
export function windFromDegrees(u, v) {
  if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
  if (u === 0 && v === 0) return null;
  const degrees = (Math.atan2(-u, -v) * 180) / Math.PI;
  return (degrees + 360) % 360;
}

export function compassLabel(degrees) {
  if (!Number.isFinite(degrees)) return '';
  return COMPASS[Math.round(degrees / 22.5) % 16];
}

/**
 * Compact the upstream point-forecast document. `testing` stays true: the
 * Windy Testing tier is allowed to shuffle numbers, and the UI must say so.
 */
export function summarizePointForecast(
  payload,
  point,
  { fetchedAt = Date.now() } = {},
) {
  const body = payload && typeof payload === 'object' ? payload : {};
  const units = body.units && typeof body.units === 'object' ? body.units : {};
  const times = Array.isArray(body.ts) ? body.ts : [];
  const temps = Array.isArray(body['temp-surface']) ? body['temp-surface'] : [];
  const windU = Array.isArray(body['wind_u-surface'])
    ? body['wind_u-surface']
    : [];
  const windV = Array.isArray(body['wind_v-surface'])
    ? body['wind_v-surface']
    : [];
  const gusts = Array.isArray(body['gust-surface']) ? body['gust-surface'] : [];
  const pressures = Array.isArray(body['pressure-surface'])
    ? body['pressure-surface']
    : [];
  const precips = Array.isArray(body['precip-surface'])
    ? body['precip-surface']
    : [];
  const steps = [];
  const count = Math.min(times.length, 6);
  for (let index = 0; index < count; index += 1) {
    const u = Number(windU[index]);
    const v = Number(windV[index]);
    steps.push({
      time: epochMs(times[index]),
      tempC: temperatureC(temps[index], units['temp-surface']),
      windMps:
        Number.isFinite(u) && Number.isFinite(v) ? Math.hypot(u, v) : null,
      windFromDeg: windFromDegrees(u, v),
      gustMps: Number.isFinite(Number(gusts[index]))
        ? Number(gusts[index])
        : null,
      pressureHpa: pressureHpa(pressures[index], units['pressure-surface']),
      precipMm: precipMm(precips[index], units['precip-surface']),
    });
  }
  return {
    lat: point.lat,
    lon: point.lon,
    model: 'gfs',
    testing: true,
    disclaimer: WINDY_TESTING_DISCLAIMER,
    fetchedAt,
    steps,
  };
}

export function formatTempC(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}°C` : '—';
}

export function formatWind(step) {
  if (!Number.isFinite(step?.windMps)) return 'Wind —';
  const from = compassLabel(step.windFromDeg);
  const gust = Number.isFinite(step.gustMps)
    ? ` · gust ${step.gustMps.toFixed(1)} m/s`
    : '';
  return `Wind ${step.windMps.toFixed(1)} m/s${from ? ` from ${from}` : ''}${gust}`;
}

export function formatForecastTime(ms) {
  if (!Number.isFinite(ms)) return '';
  return `${new Date(ms).toISOString().slice(5, 16).replace('T', ' ')} UTC`;
}

export function formatPressure(value) {
  return Number.isFinite(value) ? `${Math.round(value)} hPa` : '—';
}

export function formatPrecip(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)} mm` : '—';
}

/** Fixed client copy. Upstream bodies are never interpolated into these strings. */
export function windyClientMessage(code) {
  switch (code) {
    case 'no_key':
      return 'KEY REQUIRED';
    case 'unauthorized':
      return 'Windy rejected the key. Refresh it in Provider Settings.';
    case 'rate_limited':
      return 'Windy rate limit. Try again shortly.';
    case 'no_data':
      return 'No forecast for this point.';
    case 'bad_request':
      return 'That point is outside the forecast query.';
    default:
      return 'Windy is temporarily unavailable.';
  }
}
