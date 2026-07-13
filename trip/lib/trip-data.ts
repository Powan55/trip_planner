// Trip date constants and utilities.
//
// The framework-free date BACKBONE (constants, `TRIP_DATES`, `TRIP_DATE_LABEL`,
// the TZ-safe `getCountryForDate`, and `formatDate`/`formatDateLong`) lives in the
// framework-free `core/dates/` package. This module RE-EXPORTS every
// one of those symbols byte-identically so the many `@/lib/trip-data` callers (components,
// hooks, tests) are untouched — the same delegate pattern `itinerary-storage.ts` uses for
// the Vault. One implementation in core, the same public surface here.
//
// The itinerary DOMAIN types + category maps below (`ItineraryItem`, `DayPlan`,
// `CATEGORY_COLORS`, `CATEGORY_ICONS`, …) intentionally STAY here — they are not date
// backbone and belong to the itinerary layer, not `core/dates`.
export {
  TRIP_START,
  TRIP_END,
  NEPAL_START,
  NEPAL_END,
  JAPAN_START,
  JAPAN_END,
  TRIP_DATES,
  TRIP_DATE_LABEL,
  getCountryForDate,
  formatDate,
  formatDateLong,
} from '@/core/dates';

export type ItineraryCategory = 'sightseeing' | 'food' | 'photography' | 'shopping' | 'nature' | 'cultural' | 'transportation' | 'hotel' | 'free' | 'nightlife';

export interface ItineraryItem {
  id: string;
  title: string;
  category: ItineraryCategory;
  time?: string;
  duration?: string;
  // Structured time model — additive-optional; every existing item
  // stays valid with both absent. `startMinutes` = 0–1439 minutes-from-midnight, wall-clock
  // at the day's place (never TZ-converted for display). `durationMinutes` = elapsed
  // minutes, > 0. `time?`/`duration?` are RETAINED FOREVER (fallback display + migration
  // source + mixed-fleet surface). Range is enforced at ONE runtime point
  // (`effectiveStartMinutes`, core/dates/item-time.ts) — an out-of-range value degrades to
  // untimed, never quarantines. Backfilled losslessly at the relevant Vault migration
  // and via the runtime fallback parser for sync-ingest/seed items that bypass migrations.
  startMinutes?: number;
  durationMinutes?: number;
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
  // Sync v2 per-item merge fields — additive; every existing item
  // stays valid with all three absent. See core/sync/{hlc,merge-day}.ts. Not yet wired
  // into the store. Defaulted losslessly at the relevant Vault migration / read boundary.
  rev?: number; // monotonic per-item revision counter; starts at 1 on create.
  hlc?: string; // Hybrid Logical Clock stamp (serialized) — the primary cross-client order key.
  deleted?: boolean; // tombstone; true ⇒ deleted-but-retained so the delete can propagate + win.
  // Trip OS done-tracking — additive OPTIONAL, no Vault migration / version bump needed. Absent
  // = not done (falsy); `done === true` = checked off on the Today screen. Toggled via the
  // existing `updateItem(date, id, { done })` path, so sync-on it rides rev/hlc for free
  // (last-write-wins). No backfill needed (unlike the sync fields), so the lenient passthrough
  // schema tolerates it and the on-disk envelope stays at v4 (see core/vault/schema.ts).
  done?: boolean;
  // Manual pin-drop — additive OPTIONAL, no Vault migration / version bump, mirrors the
  // `done` precedent above. Absent = un-pinned (the item plots, if at all, via the existing
  // sourceId/name-match join in lib/itinerary-map.ts). When BOTH are defined the item plots at
  // these exact WGS84 coords instead — a pin always beats a fuzzy name match (buildItineraryStops).
  // Toggled via the existing `updateItem(date, id, { lat, lng })` path, so it rides rev/hlc for
  // free like every other field here. Range (lat -90..90, lng -180..180) is validated in the
  // ItemEditor UI, not here — the type itself stays a plain optional number, same as `done`.
  lat?: number;
  lng?: number;
  // Multi-day span — additive OPTIONAL, no Vault migration / version bump, mirrors the
  // `lat`/`lng` precedent above. ISO `YYYY-MM-DD`, the INCLUSIVE last day the item spans.
  // Absent = single-day (today's behavior, unchanged). THE MERGE INVARIANT: a spanning
  // item stays stored in EXACTLY ONE DayPlan.items[] — its start day (the DayPlan.date whose
  // items[] holds it) — and is NEVER copied/multi-homed onto the other days it covers. The span
  // across [startDay..endDate] is a PURE view-layer render derivation (calendar-planner), never
  // an on-disk duplication. Only ever written strictly after the start day, so its mere presence
  // means "genuine span" (used by the clash-exclusion in lib/sort-items-by-time.ts). Rides the
  // existing updateItem path (rev/hlc) for free like every other field here.
  endDate?: string;
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
