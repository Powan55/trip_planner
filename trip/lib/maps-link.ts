// Google Maps link-out scheme (a plain URL, not an API — keeps this free to use).
// Exported so the detail sheet and any custom-add trigger build the exact same
// query string. `query = encodeURIComponent(title [+ ' ' + location])`. Returns
// null when there is nothing to search yet (empty title), so the caller can
// disable the link.
//
// Pure, React-free string logic — imports nothing from React/framer/components — so
// eager consumers (e.g. the calendar on `/plan`) can use it without dragging the
// otherwise-lazy add-to-itinerary dialog + framer-motion into their first-load bundle.
export function buildMapsSearchUrl(title: string, location?: string): string | null {
  const t = title.trim();
  if (!t) return null;
  const loc = (location ?? '').trim();
  const query = loc ? `${t} ${loc}` : t;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

// Google Maps directions link-out (a plain URL, not an API). Destination-only:
// origin defaults to the user's current location inside Google Maps, so we never
// read/inject/persist the user's own coordinates. Pure/React-free, same shape as
// buildMapsSearchUrl above, so it never drags an eager import into a first-load
// bundle.
export function buildMapsDirectionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}
