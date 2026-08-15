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
 *
 * **Issue #30 added a second half at the bottom of this file** — gateway key 34, the record of which
 * visits a one-shot location check confirmed and when (D-320). It is a SEPARATE key so the
 * `{ cities, countries }` bytes above stay exactly two fields, and it is the only place in the app
 * that persists anything derived from a device position. Read its own docblock before touching it:
 * the shape is the privacy contract, not a convenience.
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

// ── The GPS-confirmation half (issue #30, gateway key 34, D-320 amends D-158) ─────────────────────
/**
 * Everything below records WHICH of the visits above a one-shot location check confirmed, and when.
 * It lives in this module because a confirmation is an attribute of a lifetime visit, and in its own
 * gateway key because #29's `{ cities, countries }` bytes must stay exactly two fields on disk.
 *
 * **The privacy contract is the SHAPE, and it is the whole reason this is a decision and not a
 * refactor.** `VisitConfirmation` can hold a place name and an instant, and there is nowhere in it
 * to put a coordinate. The device fix is matched in memory (`lib/visit-autocount.ts`) against the
 * table the app already ships and is then discarded; `confirmVisit` never sees a latitude. Do not
 * "improve" this by storing the fix for a later, better matcher — that is the guarantee D-158 made
 * and D-320 amended by exactly this much and no more.
 */
export interface VisitConfirmation {
  /** The matched place — a display city name from the app's own coordinate table, never free text. */
  city: string;
  /**
   * That day's country LABEL. May be `''`: a single-leg custom trip has no country label worth
   * recording (`lib/leg-label.ts`'s composition rule 2), and a city with no country is a better
   * record than a city with a wrong one.
   */
  country: string;
  /** ISO 8601 instant the confirmation was recorded. */
  at: string;
}

export interface VisitConfirmations {
  /**
   * The trip-clock day (`YYYY-MM-DD`) the one-shot check last RAN, or `null` if it never has.
   * Written on every ATTEMPT, including one that is denied, unavailable or times out — that is
   * what makes a refusal cost one prompt per day change rather than one per page load.
   */
  checkedOn: string | null;
  /** One entry per confirmed city, first confirmation kept, insertion-ordered like the sets above. */
  confirmed: VisitConfirmation[];
}

/**
 * Narrow one on-disk entry, or `null`. `city` and `at` must both be non-blank strings — an entry
 * missing either is dropped whole rather than defaulted, because a half-built confirmation is worse
 * than none. `country` may legitimately be blank (see the field's doc) and a non-string one folds
 * to blank rather than voiding the entry.
 */
function cleanConfirmation(raw: unknown): VisitConfirmation | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { city, country, at } = raw as { city?: unknown; country?: unknown; at?: unknown };
  if (typeof city !== 'string' || typeof at !== 'string') return null;
  if (!city.trim() || !at.trim()) return null;
  return {
    city: city.trim(),
    country: typeof country === 'string' ? country.trim() : '',
    at: at.trim(),
  };
}

/**
 * Read the confirmation record. TOTAL like `getVisited()`: absent, SSR, disabled storage and a
 * corrupt slot all resolve to `{ checkedOn: null, confirmed: [] }`, never a throw. A corrupt
 * `checkedOn` reads as `null`, which costs at most one extra prompt on one day.
 */
export function getVisitConfirmations(): VisitConfirmations {
  const raw: unknown = readJson<unknown>('local', STORAGE_KEYS.visitConfirmations, {});
  const shape = (typeof raw === 'object' && raw !== null ? raw : {}) as {
    checkedOn?: unknown;
    confirmed?: unknown;
  };
  const checkedOn =
    typeof shape.checkedOn === 'string' && shape.checkedOn.trim() ? shape.checkedOn : null;
  const rawList: unknown[] = Array.isArray(shape.confirmed) ? (shape.confirmed as unknown[]) : [];
  const seen = new Set<string>();
  const confirmed: VisitConfirmation[] = [];
  for (const entry of rawList) {
    const clean = cleanConfirmation(entry);
    if (clean === null || seen.has(fold(clean.city))) continue;
    seen.add(fold(clean.city));
    confirmed.push(clean);
  }
  return { checkedOn, confirmed };
}

/**
 * Record that the one-shot check RAN on `date`, whatever its outcome. Called BEFORE the async
 * position request, deliberately: a tab closed mid-prompt, a crash inside the callback, or a
 * permission dialog left unanswered must all still count as "asked today".
 */
export function markVisitCheck(date: string): void {
  const current = getVisitConfirmations();
  writeJson('local', STORAGE_KEYS.visitConfirmations, { ...current, checkedOn: date });
}

/**
 * Confirm a place, and record the lifetime visit while we are here. Idempotent per city under the
 * same fold rule as `addVisit`, and the FIRST confirmation's timestamp is the one kept — the
 * interesting instant is when you were first known to be somewhere, not most recently.
 *
 * `at` is injected rather than read from a clock so this stays a pure store write.
 */
export function confirmVisit(place: { city: string; country: string }, at: string): VisitConfirmations {
  addVisit(place); // a confirmed visit is a visit; harmless when planned counting already added it
  const current = getVisitConfirmations();
  const city = place.city.trim();
  const country = place.country.trim(); // may be '' — a city with no country beats a wrong one
  if (!city || !at.trim()) return current;
  if (current.confirmed.some((entry) => fold(entry.city) === fold(city))) return current;
  const next: VisitConfirmations = {
    checkedOn: current.checkedOn,
    confirmed: [...current.confirmed, { city, country, at }],
  };
  writeJson('local', STORAGE_KEYS.visitConfirmations, next);
  return next;
}
