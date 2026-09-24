/**
 * Alabama ALGO Traffic camera stills.
 *
 * WARNING: the upstream JSON is undocumented. It has no API key today and no
 * published developer terms. It may change, require auth, throttle, or
 * disappear. This layer stays off unless `GEV_ALGO_CAMERAS=1` (or `true`) is
 * set before the dev server starts. Do not enable it in production until
 * CAPS/ALDOT clearance. Mac Path 2 verify: export the variable, restart, then
 * turn on Data Layers → Cameras → ALGO (experimental). Stills only.
 */

export const LAYER_ID = 'al-algo-webcams';

/** Pan settle delay. The wiring checklist asks for 300–500 ms. */
export const REQUEST_DEBOUNCE_MS = 400;

/**
 * Fallback radius when the globe has a ground center but no view rectangle.
 * The server clamps anything outside 1–250 km.
 */
export const NEARBY_RADIUS_KM = 80;

/**
 * A wide Alabama view can hold the whole public catalog (~600). The nearest
 * cameras are kept so a state-sized frame does not draw every pin.
 */
export const MAX_CAMERAS = 400;

/**
 * Catalog cadence from the handoff: one full list every 15–60 minutes.
 * The list is not re-queried on every pan.
 */
export const LIST_CACHE_TTL_MS = 30 * 60 * 1000;

/**
 * Still cadence for pins in the current view. The handoff asks for 30–60s
 * and forbids opening Wowza HLS or DASH.
 */
export const STILL_REFRESH_MS = 45 * 1000;

/** Parallel snapshot fetches. Stills only — never a burst of video sessions. */
export const STILL_FETCH_CONCURRENCY = 2;

/**
 * Most stills refreshed in one pass. A wide view must not pull a JPEG for
 * every public camera in Alabama.
 */
export const STILL_WARM_LIMIT = 40;

/** The catalog is under a megabyte today. Leave room for growth. */
export const CATALOG_MAX_BYTES = 2 * 1024 * 1024;

/** ALGO stills are JPEGs. Refuse anything that is not an image of this size. */
export const STILL_MAX_BYTES = 2 * 1024 * 1024;

/** Handshake drops get a few attempts before the catalog is marked failed. */
export const UPSTREAM_ATTEMPTS = 3;

export const EMPTY_IN_VIEW_LABEL = 'No ALGO cameras in this view';
export const EMPTY_OUTSIDE_LABEL = 'No ALGO cameras in this view';
export const LAYER_INFO =
  'WARNING: Experimental. Undocumented ALGO JSON, not a stable API, not cleared for production. Stills only.';
export const AIM_LABEL = 'Aim at the ground';

/**
 * Rough Alabama footprint, padded past the state line so border cameras still
 * count as in range. No key. Fair use: stills only, no Wowza HLS or DASH.
 */
export const SERVICE_BOUNDS = Object.freeze({
  south: 30.0,
  west: -88.8,
  north: 35.1,
  east: -84.7,
});

export const CATALOG_URL = 'https://api.algotraffic.com/v4.0/cameras';
export const STILL_HOST = 'api.algotraffic.com';
