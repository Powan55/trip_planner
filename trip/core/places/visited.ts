/**
 * Lifetime visit set — every city and country this person has EVER been to, as two unique,
 * insertion-ordered lists (issue #29). Gateway key 32 stores
 * `{ cities: string[]; countries: string[] }` at `tripPlannerLifetimeVisits`.
 *
 * LIFETIME-SCOPED, and that is the whole point of the module. This is NOT trip data: it lives
 * outside the trip key namespace and outside `wipeAllTripData()`, so clearing a trip or signing
 * out of this device leaves the record standing (D-314). The obvious implementation — file it with
 * the trip, next to `myPlaces` — would let a routine teardown erase a permanent record that no trip
 * owns and nothing can reconstruct. Pinned by `lib/__tests__/visited-lifetime.test.ts`, which runs
 * the REAL wipe and the real `signOut()` and asserts the set is still there afterwards.
 *
 * Unrelated to `core/places/model.ts`'s `MyPlace` despite the shared directory: that is a
 * trip-scoped list of imported Google places, this is a lifetime log of where you have been.
 *
 * Composes the gateway primitives (`readJson`/`writeJson`) rather than raw storage, so D-097 holds:
 * the key literal is declared only in `STORAGE_KEYS`, raw web storage is touched only in
 * `gateway.ts`. It is a separate module rather than an accessor inside `gateway.ts` for the same
 * bundle reason as `core/storage/my-places-store.ts` — the gateway sits in the app-wide First Load
 * chunk and only the visit surfaces consume this.
 *
 * Rules, all four of them:
 * - **Unique.** A city or country appears at most once.
 * - **Idempotent adds.** Re-adding a place already recorded is a no-op on the list.
 * - **Case- and whitespace-insensitive matching, first spelling wins.** `' kathmandu '` matches an
 *   existing `'Kathmandu'` and does not add a second entry; the stored display string stays the one
 *   recorded first.
 * - **Stable ordering = insertion order.** First visit first, forever. The list is never re-sorted,
 *   so a caller can rely on index stability across reads and across adds.
 *
 * The CALLER owns the vocabulary: whatever string identity it passes (a display city name, a
 * country name) is what is stored and compared. This module does not geocode, translate, or map to
 * ISO codes. Every function is TOTAL — SSR, disabled storage and a corrupt slot all degrade to an
 * empty set, never a throw (inherited from the gateway).
 *
 * No cap and no envelope, deliberately: a lifetime of human travel is a few hundred short strings,
 * which is nowhere near a quota concern, and there is no shape here to migrate.
 */

import { readJson, writeJson, STORAGE_KEYS } from '@/core/storage/gateway';

/** The lifetime set: unique cities and unique countries, each in first-visit order. */
export interface VisitedPlaces {
  cities: string[];
  countries: string[];
}

/** The one comparison key — trimmed + case-folded, so `' kathmandu '` and `'Kathmandu'` are one place. */
function fold(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Narrow an on-disk value to a clean list: strings only, trimmed, blanks dropped, deduped by
 * `fold`, order preserved. Anything that is not an array of strings resolves to `[]`.
 */
function cleanList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const value = entry.trim();
    if (!value || seen.has(fold(value))) continue;
    seen.add(fold(value));
    out.push(value);
  }
  return out;
}

/** Append `value` unless it is blank or already present (the idempotent add). Returns a NEW array. */
function append(list: string[], value: string | undefined): string[] {
  if (typeof value !== 'string') return list;
  const next = value.trim();
  if (!next) return list;
  if (list.some((entry) => fold(entry) === fold(next))) return list;
  return [...list, next];
}

/**
 * Read the lifetime set. Returns a fresh object every call (callers may keep or mutate it freely),
 * empty when absent / SSR / corrupt. This is the read API #30 and #31 build on.
 */
export function getVisited(): VisitedPlaces {
  const raw: unknown = readJson<unknown>('local', STORAGE_KEYS.lifetimeVisits, {});
  const shape = (typeof raw === 'object' && raw !== null ? raw : {}) as {
    cities?: unknown;
    countries?: unknown;
  };
  return { cities: cleanList(shape.cities), countries: cleanList(shape.countries) };
}

/**
 * Record a visit and return the resulting set. Either half may be omitted (a country-only or
 * city-only visit is legal). Idempotent: adding a place already recorded leaves the lists
 * unchanged, though the write still runs, which is what heals a corrupt slot.
 */
export function addVisit(visit: { city?: string; country?: string }): VisitedPlaces {
  const current = getVisited();
  const next: VisitedPlaces = {
    cities: append(current.cities, visit.city),
    countries: append(current.countries, visit.country),
  };
  writeJson('local', STORAGE_KEYS.lifetimeVisits, next);
  return next;
}

/**
 * Membership tests. They exist so the fold rule lives in ONE place: a caller comparing raw strings
 * against `getVisited()` would silently disagree with what `addVisit` considers a duplicate.
 */
export function hasVisitedCity(city: string): boolean {
  return getVisited().cities.some((entry) => fold(entry) === fold(city));
}

export function hasVisitedCountry(country: string): boolean {
  return getVisited().countries.some((entry) => fold(entry) === fold(country));
}
