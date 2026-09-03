// Trip date constants and utilities.
//
// As of the framework-free date BACKBONE (constants, `TRIP_DATES`, `TRIP_DATE_LABEL`,
// the TZ-safe `getCountryForDate`, and `formatDate`/`formatDateLong`) lives in the
// framework-free `core/dates/` package. This module RE-EXPORTS every
// one of those symbols byte-identically so the many `@/lib/trip-data` callers (components,
// hooks, tests) are untouched — the `itinerary-storage.ts`→Vault delegate pattern.
// One implementation in core, the same public surface here.
//
// The itinerary DOMAIN types + category maps below (`ItineraryItem`, `DayPlan`,
// `CATEGORY_COLORS`, …) intentionally STAY here — they are not date
// backbone and belong to the itinerary change, not `core/dates`.
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

// imported (for local use below, e.g. `ItineraryItem.category`) AND re-exported (for the
// many `@/lib/trip-data` callers) from the zero-import leaf, not re-declared — see
// lib/itinerary-category.ts for why re-declaring the union here instead would silently detach
// concierge-ops.ts's guard.
import type { ItineraryCategory } from './itinerary-category';
export type { ItineraryCategory };

export interface ItineraryItem {
  id: string;
  title: string;
  category: ItineraryCategory;
  time?: string;
  duration?: string;
  // Structured time model ( — additive-optional per; every existing item
  // stays valid with both absent). `startMinutes` = 0–1439 minutes-from-midnight, wall-clock
  // at the day's place. `durationMinutes` = elapsed
  // minutes, > 0. `time?`/`duration?` are RETAINED FOREVER (fallback display + migration
  // source + mixed-fleet surface,). Range is enforced at ONE runtime point
  // (`effectiveStartMinutes`, core/dates/item-time.ts) — an out-of-range value degrades to
  // untimed, never quarantines. Backfilled losslessly at the Vault v4→v5 migration
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
  // Sync v2 per-item merge fields (additive-optional; existing items stay valid without
  // them). hooks/use-itinerary.ts stamps local mutations when isTripRemoteConfigured()
  // is true. See core/sync/{stamp,hlc,merge-day}.ts. Legacy merge fields are defaulted
  // losslessly at the Vault v3→v4 migration / read boundary; ord needs no migration.
  rev?: number; // monotonic per-item revision counter; starts at 1 on create.
  hlc?: string; // Hybrid Logical Clock stamp (serialized) — the cross-client CONFLICT key.
  // The day-ORDER key, split off `hlc` so a content edit can advance the conflict key without
  // also moving the row. Same serialized-HLC shape, so `ord ?? hlc` is a type-compatible
  // fallback and a row that has never been edited or dragged since the split sorts exactly
  // where it does today — additive-optional, NO migration and NO Vault version bump.
  ord?: string;
  deleted?: boolean; // tombstone; true ⇒ deleted-but-retained so the delete can propagate + win.
  // done-tracking. Absent
  // = not done (falsy); `done === true` = checked off on the Today screen. Toggled via the
  // existing `updateItem(date, id, { done })` path, so sync-on it rides rev/hlc for free (LWW,
  //). No backfill needed (unlike the sync fields), so the lenient passthrough schema
  // tolerates it and the on-disk envelope stays at v4 (see core/vault/schema.ts).
  done?: boolean;
  // Completion attribution.
  // Stamped on the `done` false→true transition, CLEARED on true→false, untouched on any other
  // edit — unlike `updatedBy` which every edit overwrites, so it durably answers "who
  // checked this off". `doneBy` = the getUserName() display nickname (SAME identity as updatedBy,
  //), rendered verbatim (NO uid→name lookup). `doneAt` = ISO via toISOString(). Both
  // absent = no completion attribution.
  doneBy?: string;
  doneAt?: string; // ISO timestamp of the completion
  // Manual pin-drop ( — additive OPTIONAL, NO Vault migration / version bump, mirrors the
  // `done` precedent above). Absent = un-pinned (the item plots, if at all, via the existing
  // sourceId/name-match join in lib/itinerary-map.ts). When BOTH are defined the item plots at
  // these exact WGS84 coords instead — a pin always beats a fuzzy name match (buildItineraryStops).
  // Toggled via the existing `updateItem(date, id, { lat, lng })` path, so it rides rev/hlc for
  // free like every other field here. Range (lat -90..90, lng -180..180) is validated in the
  // ItemEditor UI, not here — the type itself stays a plain optional number, same as `done`.
  lat?: number;
  lng?: number;
  // Multi-day span ( — additive OPTIONAL, NO Vault migration / version bump, mirrors the
  // `lat`/`lng` precedent above). ISO `YYYY-MM-DD`, the INCLUSIVE last day the item spans.
  // Absent = single-day (today's behavior, unchanged). THE MERGE INVARIANT: a spanning
  // item stays stored in EXACTLY ONE DayPlan.items[] — its start day (the DayPlan.date whose
  // items[] holds it) — and is NEVER copied/multi-homed onto the other days it covers. The span
  // across [startDay..endDate] is a PURE view-layer render derivation (calendar-planner), never
  // an on-disk duplication. Only ever written strictly after the start day, so its mere presence
  // means "genuine span" (used by the clash-exclusion in lib/sort-items-by-time.ts). Rides the
  // existing updateItem path (rev/hlc) for free like every other field here.
  endDate?: string;
  // Per-item place-offset override ( — additive OPTIONAL, NO Vault migration / version
  // bump, mirrors the `lat`/`lng`/`endDate` precedent above). Minutes east of UTC for the ONE
  // item whose wall-clock time is physically in a different place than the day's `country`
  // (e.g. a Guangzhou layover logged on a Japan day). Absent = today's behavior unchanged: the
  // UTC-instant math (`core/dates/item-time.ts`'s `effectiveOffsetMin`) falls back to the day's
  // `offsetForCountry`. Display is UNAFFECTED (: the badge stays day-country-derived,
  // never per-item) — this only corrects Travel Mode's now/next/progress instant compare.
  tzOffsetMin?: number;
}

export interface DayPlan {
  date: string;
  city: string;
  // Leg id of the day (: `string`, not the `'nepal' | 'japan'` union — a custom trip's
  // single leg is `'main'`). For the DEFAULT pack the values are still exactly nepal/japan.
  country: string;
  // DISPLAY-ONLY override for the country half of the day's "City, Country" line — set
  // when the day is not spent in its leg's country (Dec 9 is spent in Syracuse/JFK/the air and is
  // named New York, so 'USA' while `country` stays the 'nepal' LEG ID driving currency + offset). Absent
  // on nearly every day; `lib/leg-label.ts` falls back to the leg's own label. NEVER read as
  // behaviour — no currency, offset, filtering or colour branch may key off it.
  countryLabel?: string;
  items: ItineraryItem[];
}

// These 30 class names live in `lib/`, which Tailwind only scans because
// `tailwind.config.ts` includes './lib/**/*.{js,ts,jsx,tsx,mdx}' in `content`. That glob is
// load-bearing for this table: without it these utilities emit CSS only when some component
// happens to contain the byte-identical string, which is how four categories once shipped with
// no colour at all. See the note on the glob itself before touching it.
//
// Do not "fix" a row by copying its classes into a component — that accidental coupling is what
// made the original breakage invisible.
export const CATEGORY_COLORS: Record<ItineraryCategory, { bg: string; text: string; border: string }> = {
  sightseeing: { bg: 'bg-blue-500/20', text: 'text-blue-300', border: 'border-blue-500/30' },
  food: { bg: 'bg-orange-500/20', text: 'text-orange-300', border: 'border-orange-500/30' },
  photography: { bg: 'bg-purple-500/20', text: 'text-purple-300', border: 'border-purple-500/30' },
  shopping: { bg: 'bg-pink-500/20', text: 'text-pink-300', border: 'border-pink-500/30' },
  nature: { bg: 'bg-green-500/20', text: 'text-green-300', border: 'border-green-500/30' },
  cultural: { bg: 'bg-amber-500/20', text: 'text-amber-300', border: 'border-amber-500/30' },
  // KNOWN CEILING: cyan-500 is hsl(189), the interaction signal's own hue. It was moved to lime
  // once to clear that; the cards read as olive and the owner reverted it. Separate flight cards
  // from focus by something other than hue.
  transportation: { bg: 'bg-cyan-500/20', text: 'text-cyan-300', border: 'border-cyan-500/30' },
  hotel: { bg: 'bg-indigo-500/20', text: 'text-indigo-300', border: 'border-indigo-500/30' },
  free: { bg: 'bg-gray-500/20', text: 'text-gray-300', border: 'border-gray-500/30' },
  nightlife: { bg: 'bg-fuchsia-500/20', text: 'text-fuchsia-300', border: 'border-fuchsia-500/30' },
};
