/**
 * Local-only booking-override store (issue #228).
 *
 * `lib/booking-data.ts` is read-only presentation data (D-034): a `Journey`/`Stay` flagged
 * `status: 'to-book'` there can only become a real booking by editing that module and
 * redeploying — not a realistic path for a booking made mid-trip. This module is the additive
 * fix. It is a separate, local-only layer keyed by the SAME id space `booking-data.ts` already
 * exports (`Journey.id` / `Stay.id`), edited from `/flights` (`components/booking-override-editor.tsx`)
 * and merged onto the static data AT RENDER TIME by `components/flights-section.tsx`.
 *
 * `lib/booking-data.ts` is NEVER imported here for its VALUES and NEVER written to — this module
 * only borrows its `Journey`/`Stay` TYPES to shape a pure, non-mutating merge. `applyJourneyOverride`
 * / `applyStayOverride` always return a NEW object (or the exact same input reference when there is
 * no override to apply) — the source objects are never touched.
 *
 * TRIP-SCOPED (gateway key 40, `keyFor('bookingOverrides')`): a booking belongs to the trip it was
 * made for, exactly like `favorites`/`myPlaces`. Local-only, no sync — mirrors `favoritesStore`
 * exactly (one JSON blob, no remote fan-out, no attribution).
 */
import { readJson, writeJson, hasKey, keyFor, type Store } from '@/core/storage/gateway';
import type { StoragePort } from '@/core/ports';
import type { Journey, Stay } from '@/lib/booking-data';

const STORE: Store = 'local';

/**
 * One override record. Fields are deliberately generic free text shared across journeys and
 * stays (never a `Date`/parsed value — mirrors `booking-data.ts`'s own verbatim-label rule):
 * `primaryLabel`/`secondaryLabel` read as "depart/arrive" for a flight or "check-in/check-out"
 * for a stay, decided by the caller's `kind`, never by this module.
 */
export interface BookingOverride {
  /** Free text — carrier + flight number for a journey, or the property name for a stay. */
  provider?: string;
  confirmationNumber?: string;
  /** Verbatim label, never parsed. */
  primaryLabel?: string;
  /** Verbatim label, never parsed. */
  secondaryLabel?: string;
  note?: string;
  /** ISO instant of the last edit — display/debug only, never parsed for logic. */
  updatedAt: string;
}

export type BookingOverrideMap = Record<string, BookingOverride>;

const EMPTY_MAP: BookingOverrideMap = {};

/**
 * Coerce any parsed-from-storage value into a safe `BookingOverrideMap`. Never throws. Exported
 * (not just internal) so `lib/trip-backup.ts`'s import `validate` step reuses this SAME sanitizer
 * rather than re-deriving the shape rule — the same reason every other backup domain reuses its
 * own model's sanitizer (`sanitizePlaces`, `sanitizeDocs`, ...).
 */
export function sanitizeBookingOverrides(raw: unknown): BookingOverrideMap {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return EMPTY_MAP;
  const out: BookingOverrideMap = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!id || typeof v !== 'object' || v === null) continue;
    const o = v as Record<string, unknown>;
    if (typeof o.updatedAt !== 'string') continue;
    const entry: BookingOverride = { updatedAt: o.updatedAt };
    if (typeof o.provider === 'string') entry.provider = o.provider;
    if (typeof o.confirmationNumber === 'string') entry.confirmationNumber = o.confirmationNumber;
    if (typeof o.primaryLabel === 'string') entry.primaryLabel = o.primaryLabel;
    if (typeof o.secondaryLabel === 'string') entry.secondaryLabel = o.secondaryLabel;
    if (typeof o.note === 'string') entry.note = o.note;
    out[id] = entry;
  }
  return out;
}

/**
 * Raw byte-transport accessor (gateway key 40, TRIP-scoped) — generic over `T` and NOT sanitizing,
 * exactly like `favoritesStore`/`dayAnchorStore`/`myPlacesStore`. This is the shape
 * `lib/trip-backup.ts` needs: `get(ABSENT)` tells a genuinely-absent slot from a stored `{}` on
 * export, and `set` writes an already-validated value verbatim on import. Declared here (not
 * inside `gateway.ts`) for the SAME bundle reason as `myPlacesStore` — only the `/flights` route
 * (a `dynamic({ssr:false})` island) and `trip-backup.ts` (itself lazy, off the `backup-restore.tsx`
 * island) consume it.
 */
export const bookingOverridesStore = {
  get<T>(fallback: T): T {
    return readJson<T>(STORE, keyFor('bookingOverrides'), fallback);
  },
  set<T>(map: T): void {
    writeJson(STORE, keyFor('bookingOverrides'), map);
  },
} as const;

/** Load + sanitize the persisted overrides (`{}` when absent/SSR/corrupt). */
export function loadBookingOverrides(): BookingOverrideMap {
  return sanitizeBookingOverrides(bookingOverridesStore.get<unknown>(EMPTY_MAP));
}

/** Sanitize + persist the whole map as JSON. No-op / never-throws under SSR or storage failure. */
export function saveBookingOverrides(map: BookingOverrideMap): void {
  bookingOverridesStore.set<BookingOverrideMap>(sanitizeBookingOverrides(map));
}

/** The `StoragePort<BookingOverrideMap>` for `createReactiveStore` — same load/save contract the
 * hook uses, plus raw key-presence to satisfy the port. Mirrors `myPlacesStoragePort` exactly. */
export const bookingOverridesPort: StoragePort<BookingOverrideMap> = {
  load: loadBookingOverrides,
  save: saveBookingOverrides,
  has: () => hasKey(STORE, keyFor('bookingOverrides')),
};

/** Pure upsert — returns a NEW map, stamping `updatedAt` here so every writer is honest about when. */
export function upsertOverride(
  map: BookingOverrideMap,
  id: string,
  patch: Omit<BookingOverride, 'updatedAt'>,
): BookingOverrideMap {
  return { ...map, [id]: { ...patch, updatedAt: new Date().toISOString() } };
}

/** Pure delete — returns the SAME reference when `id` was already absent (no-op cost). */
export function removeOverride(map: BookingOverrideMap, id: string): BookingOverrideMap {
  if (!(id in map)) return map;
  const next = { ...map };
  delete next[id];
  return next;
}

// ---- pure display-merge helpers ---------------------------------------------------------------
// Each returns a NEW Journey/Stay (or the EXACT SAME input reference when there is no override),
// never mutating the input — so `lib/booking-data.ts`'s exported consts can never be touched by
// calling these, and a no-override render (every entry today) costs nothing extra.

/**
 * Overlay a `BookingOverride` onto a `Journey` for display. Flips `status` to `'booked'` and
 * overlays the override's fields onto the FIRST leg only (a booking added mid-trip is a single
 * new flight, not a multi-leg itinerary this form was never meant to reconstruct); every other
 * leg/layover/journey field is untouched. Absent override -> the SAME `journey` reference back.
 */
export function applyJourneyOverride(journey: Journey, override?: BookingOverride): Journey {
  if (!override) return journey;
  const [firstLeg, ...restLegs] = journey.legs;
  if (!firstLeg) return { ...journey, status: 'booked' };
  return {
    ...journey,
    status: 'booked',
    legs: [
      {
        ...firstLeg,
        flightNumber: override.provider || firstLeg.flightNumber,
        departLabel: override.primaryLabel || firstLeg.departLabel,
        arriveLabel: override.secondaryLabel || firstLeg.arriveLabel,
      },
      ...restLegs,
    ],
  };
}

/**
 * Overlay a `BookingOverride` onto a `Stay` for display. Flips `status` to `'booked'` and
 * overlays the override's fields onto the Stay's existing displayable fields (`name`/`checkIn`/
 * `checkOut`/`note`). Absent override -> the SAME `stay` reference back.
 */
export function applyStayOverride(stay: Stay, override?: BookingOverride): Stay {
  if (!override) return stay;
  return {
    ...stay,
    status: 'booked',
    name: override.provider || stay.name,
    checkIn: override.primaryLabel || stay.checkIn,
    checkOut: override.secondaryLabel || stay.checkOut,
    note: override.note || stay.note,
  };
}
