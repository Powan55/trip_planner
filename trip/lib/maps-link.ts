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
