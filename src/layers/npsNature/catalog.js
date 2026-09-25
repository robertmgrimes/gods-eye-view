/**
 * Curated NPS / nature cameras. There is no bulk cameras API.
 *
 * Coordinates are approximate place locations, not surveyed camera masts.
 * Yellowstone entrance and Old Faithful values are the NAD83 degrees published
 * on https://www.nps.gov/yell/planyourvisit/maps.htm (converted from DMS).
 * Mount Washburn is the UNAVCO WASH mark (44.7977, -110.4339).
 * Mammoth Hot Springs is the public place 44°58′29″N 110°42′08″W.
 * Brooks Falls is the public place 58°33′20″N 155°47′31″W.
 * A paired camera at the same place is offset by about 0.004° so both pins
 * can be selected. Every pin stays marked approximate.
 *
 * Yosemite Conservancy cameras are not in this catalog.
 */

export const YELLOWSTONE_PAGE =
  'https://www.nps.gov/yell/learn/photosmultimedia/webcams.htm';

export const COORDINATE_SOURCES = Object.freeze({
  yellowstoneMaps: 'https://www.nps.gov/yell/planyourvisit/maps.htm',
  washburn: 'UNAVCO monument WASH, Mount Washburn',
  mammoth: 'Public place location, Mammoth Hot Springs',
  brooksFalls: 'Public place location, Brooks Falls',
});

const APPROXIMATE = true;

function still(id, name, latitude, longitude, file, place) {
  return Object.freeze({
    id,
    name,
    kind: 'still',
    park: 'Yellowstone',
    place,
    latitude,
    longitude,
    approximate: APPROXIMATE,
    stillUrl: `https://www.nps.gov/webcams-yell/${file}`,
    pageUrl: YELLOWSTONE_PAGE,
    refreshSec: 60,
  });
}

function link(id, name, latitude, longitude, pageUrl, extra) {
  return Object.freeze({
    id,
    name,
    kind: 'link',
    latitude,
    longitude,
    approximate: latitude == null ? false : APPROXIMATE,
    stillUrl: null,
    pageUrl,
    ...extra,
  });
}

/** Ten Yellowstone webcams from the NPS page. Nine stills, one link-out. */
export const YELLOWSTONE_CAMERAS = Object.freeze([
  still(
    'yell-north-out',
    'North Entrance - Out of the Park',
    45.02955,
    -110.7087,
    'mammoth_arch.jpg',
    'North Entrance',
  ),
  still(
    'yell-north-electric',
    'North Entrance - Electric Peak',
    45.03355,
    -110.7087,
    'mammoth_electric.jpg',
    'North Entrance',
  ),
  still(
    'yell-mammoth-travertine',
    'Mammoth Hot Springs - Travertine Terraces',
    44.97472,
    -110.70222,
    'mammoth_parade.jpg',
    'Mammoth Hot Springs',
  ),
  still(
    'yell-washburn-ne',
    'Mount Washburn - Northeastern View',
    44.7977,
    -110.4339,
    'washburn_ne.jpg',
    'Mount Washburn',
  ),
  still(
    'yell-washburn-s',
    'Mount Washburn - Southern View',
    44.7937,
    -110.4339,
    'washburn_sw.jpg',
    'Mount Washburn',
  ),
  still(
    'yell-west-out',
    'West Entrance - Out of the Park',
    44.65841,
    -111.09719,
    'west_gate.jpg',
    'West Entrance',
  ),
  still(
    'yell-west-in',
    'West Entrance - Into the Park',
    44.66241,
    -111.09719,
    'west_into.jpg',
    'West Entrance',
  ),
  still(
    'yell-east-out',
    'East Entrance - Out of Park',
    44.48845,
    -110.00383,
    'east_out.jpg',
    'East Entrance',
  ),
  still(
    'yell-east-in',
    'East Entrance - Into Park',
    44.49245,
    -110.00383,
    'east_in.jpg',
    'East Entrance',
  ),
  link(
    'yell-of-livestream',
    'Old Faithful & Upper Geyser Basin Livestream',
    44.46036,
    -110.82822,
    YELLOWSTONE_PAGE,
    {
      park: 'Yellowstone',
      place: 'Old Faithful',
      note: 'Livestream stays on the NPS page. GEV does not embed it.',
    },
  ),
]);

/**
 * Directory and seasonal link-outs. No bulk ingest and no Explore.org scrape.
 * Katmai is one seasonal pin; the other two are panel links without a pin.
 */
export const NATURE_LINK_OUTS = Object.freeze([
  Object.freeze({
    id: 'nps-wildlife-index',
    name: 'NPS wildlife webcams',
    kind: 'link',
    pin: false,
    pageUrl: 'https://www.nps.gov/subjects/watchingwildlife/webcams.htm',
    note: 'Directory of park webcams. Not ingested.',
  }),
  Object.freeze({
    id: 'explore-org',
    name: 'Explore.org live cams',
    kind: 'link',
    pin: false,
    pageUrl: 'https://explore.org/livecams',
    note: 'Link only. Explore.org has no public API and is not scraped.',
  }),
  link(
    'nps-katmai-bears',
    'Katmai bear cams',
    58.55556,
    -155.79194,
    'https://www.nps.gov/katm/learn/photosmultimedia/webcams.htm',
    {
      park: 'Katmai',
      place: 'Brooks Falls',
      pin: true,
      seasonal: 'late June to early October',
      note: 'Seasonal Explore.org partnership. Link only; the stream is not ingested.',
    },
  ),
]);

export const NPS_NATURE_CATALOG = Object.freeze([
  ...YELLOWSTONE_CAMERAS,
  ...NATURE_LINK_OUTS,
]);

const YOSEMITE_MARKERS = Object.freeze([
  'yosemite.org',
  'yosemite-falls',
  'half-dome',
  'half dome',
  'el capitan',
  'el-capitan',
  'high sierra',
  'high-sierra',
  'pixelcaster',
  'jotform.com/201336316228044',
]);

/** Ids and URLs that must never appear in the curated catalog. */
export function yosemiteConservancyHits(records = NPS_NATURE_CATALOG) {
  const hits = [];
  for (const record of records) {
    const blob = [
      record?.id,
      record?.name,
      record?.stillUrl,
      record?.pageUrl,
      record?.note,
      record?.place,
      record?.park,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    for (const marker of YOSEMITE_MARKERS) {
      if (blob.includes(marker)) hits.push(`${record?.id}:${marker}`);
    }
  }
  return hits;
}
