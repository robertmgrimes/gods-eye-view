/**
 * Webcam Explore is a discovery catalog. Search runs when the operator asks.
 * Results stay cached for half an hour. Nothing here is a video feed.
 */

export const LAYER_ID = 'webcam-explore';

export const MCP_URL = 'https://www.webcamexplore.com/api/mcp';

/** Tool schema default. */
export const DEFAULT_LIMIT = 10;

/** Tool schema ceiling. */
export const MAX_LIMIT = 20;

/**
 * Discovery cache. The handoff asks for minutes to hours, not a tile cadence.
 */
export const LIST_CACHE_TTL_MS = 30 * 60 * 1000;

/** Observed `x-ratelimit-limit` on the public MCP endpoint. */
export const RATE_LIMIT_LIMIT = 1000;

export const PAGE_HOSTS = Object.freeze([
  'www.webcamexplore.com',
  'webcamexplore.com',
]);

export const LAYER_SOURCE = 'Webcam Explore';

export const DISCOVERY_NOTE =
  'Discovery only. Thumbnails are previews. Open goes to Webcam Explore. GEV does not play these cameras. Results cache for 30 minutes (about 1000 requests per window).';

export const IDLE_MESSAGE =
  'Search a place or title, or browse trending, popular, and categories.';

export const EMPTY_MESSAGE =
  'No webcams matched. Try a title or place name, or browse trending.';

export const CATEGORY_CHIPS = Object.freeze([
  Object.freeze({ id: 'beaches', label: 'Beaches' }),
  Object.freeze({ id: 'cities', label: 'Cities' }),
  Object.freeze({ id: 'nature', label: 'Nature' }),
  Object.freeze({ id: 'traffic', label: 'Traffic' }),
  Object.freeze({ id: 'weather', label: 'Weather' }),
]);
