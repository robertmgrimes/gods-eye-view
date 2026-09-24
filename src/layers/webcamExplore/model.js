import {
  CATEGORY_CHIPS,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  PAGE_HOSTS,
} from './policy.js';

const HOSTS = new Set(PAGE_HOSTS);
const CATEGORIES = new Set(CATEGORY_CHIPS.map((chip) => chip.id));

const PUBLIC_KEYS = Object.freeze([
  'id',
  'title',
  'location',
  'category',
  'trending',
  'popularity_score',
  'thumbnail_url',
  'page_url',
  'is_live',
]);

function text(value, max) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function httpsOnHost(value) {
  if (typeof value !== 'string' || value.length > 2000) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  if (!HOSTS.has(url.hostname)) return null;
  return url.toString();
}

/** Default 10, ceiling 20, matching the MCP tool schema. */
export function clampLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(number)));
}

/**
 * Bare "Georgia" matches the US state and the country. Callers must pick
 * one before a location or search request is sent.
 * @param {unknown} value
 * @returns {{ note: string, choices: Array<{id: string, label: string, query: string}> } | null}
 */
export function ambiguousGeorgia(value) {
  const textValue = text(value, 80).replace(/\.+$/g, '');
  if (!/^georgia$/i.test(textValue)) return null;
  return {
    note: '"Georgia" is both a US state and a country. Pick one before searching.',
    choices: [
      {
        id: 'us',
        label: 'Georgia, United States',
        query: 'Georgia, United States',
      },
      {
        id: 'country',
        label: 'Georgia (country)',
        query: 'Tbilisi, Georgia',
      },
    ],
  };
}

export function isCategorySlug(value) {
  return CATEGORIES.has(
    String(value || '')
      .trim()
      .toLowerCase(),
  );
}

/**
 * One public discovery card. Extra upstream fields, including any stream
 * URL or coordinates, are dropped. A record without a Webcam Explore page
 * is dropped too.
 * @param {object | null | undefined} raw
 */
export function publicWebcam(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = text(raw.id, 64);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  const page = httpsOnHost(raw.page_url);
  if (!page) return null;
  const thumbnail =
    raw.thumbnail_url == null || raw.thumbnail_url === ''
      ? null
      : httpsOnHost(raw.thumbnail_url);
  const score = Number(raw.popularity_score);
  const webcam = {
    id,
    title: text(raw.title, 180) || 'Webcam',
    location: text(raw.location, 180),
    category: text(raw.category, 64).toLowerCase(),
    trending: raw.trending === true,
    popularity_score: Number.isFinite(score)
      ? Math.max(0, Math.min(1_000_000, Math.floor(score)))
      : 0,
    thumbnail_url: thumbnail,
    page_url: page,
    is_live: raw.is_live === true,
  };
  return Object.fromEntries(PUBLIC_KEYS.map((key) => [key, webcam[key]]));
}

/** Read webcams from a JSON-RPC tools/call result. */
export function extractWebcamList(body) {
  const structured = body?.result?.structuredContent?.webcams;
  if (Array.isArray(structured)) return structured;
  const textContent = body?.result?.content?.find(
    (entry) => entry?.type === 'text' && typeof entry.text === 'string',
  )?.text;
  if (!textContent) return [];
  try {
    const parsed = JSON.parse(textContent);
    return Array.isArray(parsed?.webcams) ? parsed.webcams : [];
  } catch {
    return [];
  }
}

export function clientMessage(code) {
  if (code === 'rate_limited')
    return 'Webcam Explore rate limit reached. Wait and try again.';
  if (code === 'ambiguous_location')
    return 'Pick Georgia, United States or Georgia (country).';
  if (code === 'bad_request') return 'That search could not be sent.';
  return 'Webcam Explore is unavailable.';
}
