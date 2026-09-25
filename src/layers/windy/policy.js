/** Windy Webcams layer. Map Forecast is intentionally not a layer here. */

export const LAYER_ID = 'windy-webcams';

/** Pan settle delay. The wiring checklist asks for 300–500 ms. */
export const REQUEST_DEBOUNCE_MS = 400;

/** Phase 1 nearby radius. The server clamps anything outside 1–250 km. */
export const NEARBY_RADIUS_KM = 50;

export const NEARBY_LIMIT = 50;

/**
 * Free-tier image URLs expire at about 10 minutes. Drop them before that
 * so a preview never paints a token that is already stale.
 */
export const IMAGE_URL_MAX_AGE_MS = 8 * 60 * 1000;

/** Nearby list metadata may be reused; image URLs are not part of that cache. */
export const LIST_CACHE_TTL_MS = IMAGE_URL_MAX_AGE_MS;
