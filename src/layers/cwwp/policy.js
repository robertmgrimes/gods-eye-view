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

/**
 * In-service camera extents measured from each district file, padded so a
 * camera on the district edge still selects that file. A view fetches only
 * the districts that intersect it.
 */
export const DISTRICT_BOUNDS = Object.freeze({
  1: { south: 38.55, west: -124.4, north: 42.2, east: -122.4 },
  2: { south: 39.55, west: -123.2, north: 42.2, east: -119.85 },
  3: { south: 37.9, west: -122.35, north: 40.0, east: -119.75 },
  4: { south: 36.7, west: -123.0, north: 38.75, east: -121.3 },
  5: { south: 34.2, west: -122.25, north: 37.35, east: -119.3 },
  6: { south: 34.6, west: -120.95, north: 37.55, east: -118.6 },
  7: { south: 33.55, west: -119.5, north: 35.0, east: -117.5 },
  8: { south: 33.25, west: -117.95, north: 35.8, east: -114.35 },
  9: { south: 34.8, west: -119.65, north: 38.55, east: -117.65 },
  10: { south: 36.8, west: -121.9, north: 38.6, east: -119.75 },
  11: { south: 32.35, west: -117.6, north: 33.55, east: -115.3 },
  12: { south: 33.2, west: -118.3, north: 34.15, east: -117.4 },
});

/** Oblique views stay inside this radius instead of the horizon rectangle. */
export const GROUND_FOOTPRINT_CAP_KM = 50;

/** Disk copies older than this are discarded and fetched again. */
export const DISTRICT_DISK_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Oldest district files are evicted past this cap. */
export const DISTRICT_DISK_MAX_BYTES = 50 * 1024 * 1024;

/** Background warm at dev-server start. Low so it does not stampede Caltrans. */
export const DISTRICT_WARM_CONCURRENCY = 2;

/** Find cameras waits longer for Caltrans than for the other sources. */
export const CWWP_SEARCH_TIMEOUT_MS = 12_000;

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
