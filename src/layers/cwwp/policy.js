/** Caltrans CWWP traffic-camera stills. No API key. */

export const LAYER_ID = 'ca-cwwp-webcams';

/** Pan settle delay. The wiring checklist asks for 300–500 ms. */
export const REQUEST_DEBOUNCE_MS = 400;

/**
 * Fallback radius when the globe has a ground center but no view rectangle.
 * The server clamps anything outside 1–250 km.
 */
export const NEARBY_RADIUS_KM = 80;

/**
 * A wide southern-California view can hold more cameras than a pin layer
 * should draw. The nearest cameras are kept.
 */
export const MAX_CAMERAS = 400;

/**
 * District files update "as necessary." Refresh them on a 10 minute cadence,
 * inside the 5–15 minute handoff window, and again when a view enters California.
 */
export const LIST_CACHE_TTL_MS = 10 * 60 * 1000;

/** A district that failed with nothing cached is retried after a minute. */
export const DISTRICT_FAIL_RETRY_MS = 60 * 1000;

/** Parallel district JSON fetches. Twelve files, a few at a time. */
export const DISTRICT_FETCH_CONCURRENCY = 3;

/**
 * Still cadence for pins in the current view. The feed's common
 * currentImageUpdateFrequency is 2 minutes. Slower cameras wait longer.
 */
export const STILL_REFRESH_MS = 2 * 60 * 1000;

/** Parallel snapshot fetches. Stills only — never a burst of HLS sessions. */
export const STILL_FETCH_CONCURRENCY = 2;

/**
 * Most stills refreshed in one pass. A wide view must not pull a JPEG for
 * every in-service camera in California.
 */
export const STILL_WARM_LIMIT = 40;

/** District JSON is a couple of megabytes. Leave room past the largest file. */
export const DISTRICT_JSON_MAX_BYTES = 4 * 1024 * 1024;

/** Caltrans stills are small JPEGs. Refuse anything that is not one. */
export const STILL_MAX_BYTES = 2 * 1024 * 1024;

/** Handshake drops get a few attempts before the district is marked failed. */
export const UPSTREAM_ATTEMPTS = 3;

export const DISTRICTS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

export const EMPTY_IN_VIEW_LABEL = 'No Caltrans cameras in this view';
export const EMPTY_OUTSIDE_LABEL = 'No Caltrans cameras in this view';
export const LAYER_INFO = 'Caltrans CWWP · California traffic camera stills';
export const AIM_LABEL = 'Aim at the ground';

/**
 * Rough California footprint, padded past the state line so border cameras
 * still count as in range. No key. Fair use: stills only, no bulk HLS.
 */
export const SERVICE_BOUNDS = Object.freeze({
  south: 32.4,
  west: -124.6,
  north: 42.2,
  east: -114.0,
});

/** Minutes from the feed, never faster than the common 2 minute still. */
export function stillRefreshMs(minutes) {
  const value = Number(minutes);
  const clamped = Number.isFinite(value)
    ? Math.min(60, Math.max(2, Math.round(value)))
    : 2;
  return clamped * 60 * 1000;
}
