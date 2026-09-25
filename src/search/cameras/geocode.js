/**
 * Resolve a place for Find cameras.
 *
 * The app place search is used when it is passed in. That chain calls Google
 * only when a key is configured, then keyless Photon, then the local
 * `/api/geocode` Nominatim proxy. The proxy sends a identifying User-Agent,
 * spaces upstream calls about 1.1 seconds apart, and caches repeats.
 * A missing place search talks to that same proxy directly. No new key.
 */
export async function resolveCameraPlace(
  query,
  {
    placeSearch,
    fetchImpl = (...args) => globalThis.fetch(...args),
    signal,
  } = {},
) {
  const text = String(query || '').trim();
  if (!text) return null;
  signal?.throwIfAborted?.();
  if (typeof placeSearch?.geocode === 'function') {
    const outcome = await placeSearch.geocode(text, { signal });
    const place = outcome?.place;
    if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lng))
      return null;
    return {
      lat: place.lat,
      lon: place.lng,
      label: place.label || place.name || text,
    };
  }
  const response = await fetchImpl(
    `/api/geocode?q=${encodeURIComponent(text)}`,
    { signal },
  );
  signal?.throwIfAborted?.();
  if (!response?.ok) return null;
  const payload = await response.json();
  const hit = payload?.results?.[0];
  const lat = Number(hit?.geometry?.location?.lat);
  const lon = Number(hit?.geometry?.location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    lat,
    lon,
    label: hit.formatted_address || text,
  };
}
