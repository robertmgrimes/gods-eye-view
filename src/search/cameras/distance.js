/** Mean Earth radius in kilometres. */
const EARTH_RADIUS_KM = 6371.0088;

/**
 * Great-circle distance between two WGS84 points, in kilometres.
 * @param {number} latA
 * @param {number} lonA
 * @param {number} latB
 * @param {number} lonB
 */
export function distanceKm(latA, lonA, latB, lonB) {
  const φ1 = (latA * Math.PI) / 180;
  const φ2 = (latB * Math.PI) / 180;
  const Δφ = ((latB - latA) * Math.PI) / 180;
  const Δλ = ((lonB - lonA) * Math.PI) / 180;
  const h =
    Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Sort geo hits nearest-first. Equal distances keep their incoming order.
 * @param {Array<{ lat: number, lon: number }>} hits
 * @param {{ lat: number, lon: number }} origin
 */
export function sortByDistance(hits, origin) {
  return hits
    .map((hit, index) => ({
      hit: {
        ...hit,
        distanceKm: distanceKm(origin.lat, origin.lon, hit.lat, hit.lon),
      },
      index,
    }))
    .sort((a, b) => a.hit.distanceKm - b.hit.distanceKm || a.index - b.index)
    .map(({ hit }) => hit);
}
