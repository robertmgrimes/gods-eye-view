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
 * The catalog is small and stable. Refreshing it on a short timer, then
 * filtering to the current view, keeps KYTC off the per-frame path.
 */
export const LIST_CACHE_TTL_MS = 3 * 60 * 1000;

/** Trimarc stills are about 2 MB. Leave headroom and refuse anything larger. */
export const STILL_MAX_BYTES = 8 * 1024 * 1024;

export const EMPTY_IN_VIEW_LABEL = 'No KYTC cameras in view';
export const EMPTY_OUTSIDE_LABEL = 'No KYTC cameras outside Kentucky';
export const AIM_LABEL = 'Aim at the ground';

/**
 * Rough service footprint, padded past the state line so Ohio River cameras
 * the layer publishes just outside Kentucky still count as in range.
 */
export const SERVICE_BOUNDS = Object.freeze({
  south: 36.4,
  west: -89.8,
  north: 39.3,
  east: -81.8,
});
