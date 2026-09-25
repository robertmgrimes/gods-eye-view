/** Curated NPS and nature cameras. No API key. Stills and links only. */

export const LAYER_ID = 'nps-nature-cameras';

/** Share-hash token. Webcam Explore uses 7; this is the next free digit. */
export const SHARE_TOKEN = '8';

/**
 * NPS stills refresh every 30–60 seconds. GEV waits a full minute so a visible
 * card never polls faster than that.
 */
export const STILL_REFRESH_MS = 60 * 1000;

/** The curated set is nine JPEGs. Warm those, not the link-outs. */
export const STILL_WARM_LIMIT = 9;

export const STILL_FETCH_CONCURRENCY = 2;

/** A Yellowstone JPEG is a small still. Refuse anything larger. */
export const STILL_MAX_BYTES = 4 * 1024 * 1024;

export const LAYER_SOURCE = 'National Park Service';

export const LAYER_INFO =
  'NPS stills and links. Positions are approximate. Not an NPS endorsement.';

export const CREDIT_NOTE =
  'Imagery from the National Park Service. God’s Eye View is not endorsed by the NPS.';
