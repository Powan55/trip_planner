// Trip date constants and utilities.
//
// The framework-free date BACKBONE (constants, `TRIP_DATES`, `TRIP_DATE_LABEL`,
// the TZ-safe `getCountryForDate`, and `formatDate`/`formatDateLong`) lives in the
// framework-free `core/dates/` package. This module RE-EXPORTS every
// one of those symbols byte-identically so the many `@/lib/trip-data` callers (components,
// hooks, tests) are untouched — the `itinerary-storage.ts`→Vault delegate pattern.
// One implementation in core, the same public surface here.
//
// The itinerary DOMAIN types + category maps below (`ItineraryItem`, `DayPlan`,
// `CATEGORY_COLORS`, `CATEGORY_ICONS`, …) intentionally STAY here — they are not date
// backbone and belong to the itinerary domain, not `core/dates`.
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
  // Sync v2 per-item merge fields (additive; every existing item
  // stays valid with all three absent). See core/sync/{hlc,merge-day}.ts. Defaulted
  // losslessly at the Vault v3→v4 migration / read boundary.
  rev?: number; // monotonic per-item revision counter; starts at 1 on create.
  hlc?: string; // Hybrid Logical Clock stamp (serialized) — the primary cross-client order key.
  deleted?: boolean; // tombstone; true ⇒ deleted-but-retained so the delete can propagate + win.
  // Done-tracking (additive OPTIONAL, NO Vault migration / version bump). Absent
  // = not done (falsy); `done === true` = checked off on the Today screen. Toggled via the
  // existing `updateItem(date, id, { done })` path, so sync-on it rides rev/hlc for free (LWW).
  // No backfill needed (unlike the sync fields), so the lenient passthrough schema
  // tolerates it and the on-disk envelope stays at v4 (see core/vault/schema.ts).
  done?: boolean;
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
