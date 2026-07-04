// Trip date constants and utilities
export const TRIP_START = new Date('2026-12-09T00:00:00');
export const TRIP_END = new Date('2027-01-09T23:59:59');
export const NEPAL_START = new Date('2026-12-09T00:00:00');
export const NEPAL_END = new Date('2026-12-18T23:59:59');
export const JAPAN_START = new Date('2026-12-19T00:00:00');
export const JAPAN_END = new Date('2027-01-09T23:59:59');

// Derive the inclusive day sequence from TRIP_START/TRIP_END. We iterate in UTC
// so the produced 'YYYY-MM-DD' strings are identical regardless of build-machine
// timezone (and match the original '2026-12-09'...'2027-01-09' sequence).
export const TRIP_DATES: string[] = (() => {
  const dates: string[] = [];
  const d = new Date(Date.UTC(TRIP_START.getFullYear(), TRIP_START.getMonth(), TRIP_START.getDate()));
  const end = new Date(Date.UTC(TRIP_END.getFullYear(), TRIP_END.getMonth(), TRIP_END.getDate()));
  while (d <= end) {
    dates.push(d.toISOString().split('T')[0]);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
})();

// Centralized human-readable trip-date label. Derived from TRIP_START/TRIP_END so
// the year is configured in one place. Built from explicit parts to
// guarantee the exact rendered string ("December 9, 2026 – January 9, 2027", en-dash)
// independent of the runtime's Intl/locale data.
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
function formatLabelPart(d: Date): string {
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
export const TRIP_DATE_LABEL = `${formatLabelPart(TRIP_START)} – ${formatLabelPart(TRIP_END)}`;

// Country classification must be timezone-independent. An earlier implementation
// parsed the incoming 'YYYY-MM-DD' with `new Date(dateStr)` — the ES spec treats
// date-ONLY strings as UTC midnight, while NEPAL_END above is a LOCAL datetime. At
// any negative UTC offset (e.g. America/New_York) Dec 19's UTC midnight lands
// BEFORE Dec 18 23:59:59 local, misclassifying Dec 19 as 'nepal'. Fix: compare
// calendar-day strings lexicographically — ISO 'YYYY-MM-DD' sorts in date order and
// the input is never Date-parsed at all. The boundary is derived from NEPAL_END's
// local parts (a local-datetime literal has the same parts on every machine), so the
// trip dates stay configured in one place.
const NEPAL_END_DAY = `${NEPAL_END.getFullYear()}-${String(NEPAL_END.getMonth() + 1).padStart(2, '0')}-${String(NEPAL_END.getDate()).padStart(2, '0')}`; // '2026-12-18'

export function getCountryForDate(dateStr: string): 'nepal' | 'japan' {
  return dateStr <= NEPAL_END_DAY ? 'nepal' : 'japan';
}

export function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatDateLong(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

export type ItineraryCategory = 'sightseeing' | 'food' | 'photography' | 'shopping' | 'nature' | 'cultural' | 'transportation' | 'hotel' | 'free' | 'nightlife';

export interface ItineraryItem {
  id: string;
  title: string;
  category: ItineraryCategory;
  time?: string;
  duration?: string;
  notes?: string;
  location?: string;
  // Optional back-link to the source record a card-created item came from.
  // Both optional, so existing sample/calendar items (no sourceId) stay valid.
  // `findPlacements(sourceId)` matches every plan item whose sourceId equals a card's id.
  sourceId?: string;
  sourceType?: 'recommendation' | 'photo' | 'map' | 'featured';
  // Cross-friend attribution: who created / last-edited an item. Populated only when
  // remote sync is active; optional so every existing item stays valid.
  createdBy?: string;
  updatedBy?: string;
  updatedAt?: string; // ISO timestamp
}

export interface DayPlan {
  date: string;
  city: string;
  country: 'nepal' | 'japan';
  items: ItineraryItem[];
}

export const CATEGORY_COLORS: Record<ItineraryCategory, { bg: string; text: string; border: string }> = {
  sightseeing: { bg: 'bg-blue-500/20', text: 'text-blue-300', border: 'border-blue-500/30' },
  food: { bg: 'bg-orange-500/20', text: 'text-orange-300', border: 'border-orange-500/30' },
  photography: { bg: 'bg-purple-500/20', text: 'text-purple-300', border: 'border-purple-500/30' },
  shopping: { bg: 'bg-pink-500/20', text: 'text-pink-300', border: 'border-pink-500/30' },
  nature: { bg: 'bg-green-500/20', text: 'text-green-300', border: 'border-green-500/30' },
  cultural: { bg: 'bg-amber-500/20', text: 'text-amber-300', border: 'border-amber-500/30' },
  transportation: { bg: 'bg-cyan-500/20', text: 'text-cyan-300', border: 'border-cyan-500/30' },
  hotel: { bg: 'bg-indigo-500/20', text: 'text-indigo-300', border: 'border-indigo-500/30' },
  free: { bg: 'bg-gray-500/20', text: 'text-gray-300', border: 'border-gray-500/30' },
  nightlife: { bg: 'bg-fuchsia-500/20', text: 'text-fuchsia-300', border: 'border-fuchsia-500/30' },
};

export const CATEGORY_ICONS: Record<ItineraryCategory, string> = {
  sightseeing: 'MapPin',
  food: 'UtensilsCrossed',
  photography: 'Camera',
  shopping: 'ShoppingBag',
  nature: 'Trees',
  cultural: 'Landmark',
  transportation: 'Plane',
  hotel: 'Hotel',
  free: 'Coffee',
  nightlife: 'Music',
};
