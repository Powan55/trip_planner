// Google Maps link-out scheme (free-only rule — a URL, not an API). Exported
// so the detail sheet and any custom-add trigger build the exact same query string.
// `query = encodeURIComponent(title [+ ' ' + location])`. Returns null when there is
// nothing to search yet (empty title), so the caller can disable the link.
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

// Coordinate-first Google Maps search link-out. Text search
// (buildMapsSearchUrl above) is unreliable for small or non-Latin venues; when a real pin is known
// (both lat/lng finite — e.g. a resolved link or a manually-dropped pin) it beats the title guess.
// Falls back to buildMapsSearchUrl(title, location) whenever either coordinate is missing/non-finite,
// so every existing call site keeps working byte-identically until a pin is actually available.
export function buildMapsPlaceUrl(title: string, lat?: number, lng?: number, location?: string): string | null {
  if (typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)) {
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  }
  return buildMapsSearchUrl(title, location);
}

// Google Maps directions link-out. Destination-only:
// origin defaults to the user's current location inside Google Maps, so we never
// read/inject/persist the user's own coordinates. Pure/React-free, same shape as
// buildMapsSearchUrl above, so it never drags an eager import into a first-load
// bundle.
export function buildMapsDirectionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}
