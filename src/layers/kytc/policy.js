/** Kentucky KYTC traffic-camera stills. No API key. */

export const LAYER_ID = 'ky-kytc-webcams';

/** Pan settle delay. The wiring checklist asks for 300–500 ms. */
export const REQUEST_DEBOUNCE_MS = 400;

/**
 * Fallback radius when the globe has a ground center but no view rectangle.
 * The server clamps anything outside 1–250 km.
 */
export const NEARBY_RADIUS_KM = 80;

/** A view can include the whole Kentucky inventory (~226). */
export const MAX_CAMERAS = 300;

/**
 * Catalog cadence from the KYTC handoff: load on first use (process start)
 * and again after a day. The ~226-feature list is not re-queried per pan.
 */
export const LIST_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Still cadence for pins in the current view. The handoff asks for 30–120s
 * and forbids a tight loop over every camera.
 */
export const STILL_REFRESH_MS = 90 * 1000;

/** Parallel snapshot fetches. Keeps a metro view from opening every host at once. */
export const STILL_FETCH_CONCURRENCY = 2;

/** Trimarc stills are about 2 MB. Leave headroom and refuse anything larger. */
export const STILL_MAX_BYTES = 8 * 1024 * 1024;

export const EMPTY_IN_VIEW_LABEL = 'No KYTC cameras in this view';
export const EMPTY_OUTSIDE_LABEL = 'No KYTC cameras in this view';
export const LAYER_INFO =
  'KYTC feed · Kentucky cameras and Indiana border stills';
export const AIM_LABEL = 'Aim at the ground';

/**
 * Rough service footprint, padded past the state line so Ohio River cameras
 * the layer publishes just outside Kentucky still count as in range.
 * Layer questions: kytc.gis.support@KY.Gov
 */
export const SERVICE_BOUNDS = Object.freeze({
  south: 36.4,
  west: -89.8,
  north: 39.3,
  east: -81.8,
});
