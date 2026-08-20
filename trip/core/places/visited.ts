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
 * Rules, all five of them:
 * - **Unique.** A city or country appears at most once.
 * - **Idempotent adds.** Re-adding a place already recorded is a no-op on the list.
 * - **Case- and whitespace-insensitive matching, first spelling wins.** `' kathmandu '` matches an
 *   existing `'Kathmandu'` and does not add a second entry; the stored display string stays the one
 *   recorded first.
 * - **Stable ordering = insertion order.** First visit first, forever. The list is never re-sorted,
 *   so a caller can rely on index stability across reads and across adds.
 * - **Removable, under the same matching rule** (`removeVisit`, issue #4). A removal preserves the
 *   other four: `filter` cannot reorder or duplicate what it keeps.
 *
 * The CALLER owns the vocabulary: whatever string identity it passes (a display city name, a
 * country name) is what is stored and compared. This module does not geocode, translate, or map to
 * ISO codes. Every function is TOTAL — SSR, disabled storage and a corrupt slot all degrade to an
 * empty set, never a throw (inherited from the gateway).
 *
 * No LIST cap and no envelope, deliberately: a lifetime of human travel is a few hundred short
 * strings, which is nowhere near a quota concern, and there is no shape here to migrate. There IS
 * a per-name bound — see `tidyPlaceName`/`PLACE_NAME_MAX`, which is the trust boundary the
 * free-text city field on `/profile` (issue #4) writes through, and through which every other
 * caller's adds are funnelled too so that no second normalisation can grow somewhere else.
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

/**
 * The one comparison key — whitespace-collapsed, trimmed and case-folded, so `' kathmandu '`,
 * `'Kathmandu'` and `'Kath  mandu'` are one place.
 *
 * Exported as `foldPlaceName` (issue #4) because a UI that offers a list of places to add has to
 * ask "is this one already recorded?" about many candidates at once, and answering it by string
 * comparison at the call site would be a SECOND normalisation that can disagree with this one.
 * `hasVisitedCity`/`hasVisitedCountry` remain the answer for a single place; this is the same rule
 * for a caller that needs a Set.
 */
function fold(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

export { fold as foldPlaceName };

/**
 * The longest name that may be stored, in characters AFTER tidying. Generous on purpose: the
 * longest real entry in the app's own country list is 44 ("Saint Helena, Ascension and Tristan da
 * Cunha") and the longest city names people actually write are shorter still, so 80 rejects a
 * paste without ever rejecting a place. It is a bound on the bytes, not a style rule.
 */
export const PLACE_NAME_MAX = 80;

/** Why a typed-in name was refused. Each maps to one sentence the user reads (issue #4). */
export type PlaceNameRejection = 'blank' | 'too-long' | 'unreadable';

export type TidiedPlaceName =
  | { ok: true; value: string }
  | { ok: false; reason: PlaceNameRejection };

/**
 * Every character class that must not reach storage, replaced (not deleted) by a space so the
 * collapse below turns a zero-width space inside a word into a word break rather than silently
 * welding the two halves together.
 *
 * Written as Unicode PROPERTY escapes rather than a hand-listed code-point range, because the
 * hand-listed version is the one that goes stale: `\p{Cc}` is every C0/C1 control and DEL,
 * `\p{Cf}` is every format character — the zero-width set, the soft hyphen, the BOM, and the
 * bidi embeddings and OVERRIDES — and `\p{Zl}`/`\p{Zp}` are the line and paragraph separators.
 *
 * The bidi overrides are the interesting ones: they are display-spoofing characters, and a place
 * name is rendered in a list next to other place names.
 */
const CONTROL_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/**
 * THE TRUST BOUNDARY (issue #4). Free-typed text becomes a storable place name, or a stated
 * reason it cannot. The whole policy, in the order it applies:
 *
 * 1. **Control and invisible characters become spaces.** See `CONTROL_CHARS`.
 * 2. **Internal whitespace collapses, and the ends are trimmed.** `'  New   York '` → `'New York'`.
 * 3. **Blank is rejected**, never stored as an empty entry.
 * 4. **Longer than `PLACE_NAME_MAX` is rejected, never truncated.** A truncated name is a
 *    different place with a plausible spelling; a refusal the user can see is honest.
 * 5. **A name with no letter or digit anywhere is rejected** — `'...'`, `'!!!'` and a lone emoji
 *    are paste accidents, not places. One letter or digit is enough (`1770` is a real town).
 *
 * The user's own spelling and case SURVIVE all five: nothing here title-cases or otherwise
 * "corrects" a name. Case-insensitivity is a matter for `fold`, at comparison time only.
 *
 * `append` runs every add through this, so the policy cannot be bypassed by a caller that
 * forgot — the UI calls it first only to learn WHICH rejection to say out loud.
 */
export function tidyPlaceName(raw: unknown): TidiedPlaceName {
  if (typeof raw !== 'string') return { ok: false, reason: 'blank' };
  const value = raw.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
  if (!value) return { ok: false, reason: 'blank' };
  if (value.length > PLACE_NAME_MAX) return { ok: false, reason: 'too-long' };
  if (!/[\p{L}\p{N}]/u.test(value)) return { ok: false, reason: 'unreadable' };
  return { ok: true, value };
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

/**
 * Append `value` unless it is unstorable or already present (the idempotent add). Returns a NEW
 * array.
 *
 * Every add in the app funnels through here, which is why `tidyPlaceName` is applied HERE rather
 * than in the form that collects the text: a guard at one call site is a guard the next call site
 * does not have (issue #4). A rejected name is silently not added — this module is total and does
 * not throw — and the UI knows which rejection it was because it asked `tidyPlaceName` itself
 * first, for the wording.
 */
function append(list: string[], value: string | undefined): string[] {
  const tidy = tidyPlaceName(value);
  if (!tidy.ok) return list;
  if (list.some((entry) => fold(entry) === fold(tidy.value))) return list;
  return [...list, tidy.value];
}

/** Drop every entry matching `value` under the fold rule. Order of the survivors is untouched. */
function drop(list: string[], value: string | undefined): string[] {
  if (typeof value !== 'string') return list;
  const key = fold(value);
  if (!key) return list;
  return list.filter((entry) => fold(entry) !== key);
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
 * Un-record a visit and return the resulting set (issue #4). Either half may be omitted, exactly
 * like `addVisit`, and removing something that was never there is a no-op that still writes.
 *
 * **This exists because people mistype.** A lifetime record with no way back is a record that
 * accumulates other people's typos forever, and the free-text city field guarantees there will be
 * some. The three guarantees the set is built on all survive a removal by construction: `filter`
 * cannot reorder the survivors (insertion order holds), cannot introduce a duplicate (uniqueness
 * holds), and the fold rule decides what "matching" means here exactly as it does for an add, so
 * `removeVisit({ city: ' KATHMANDU ' })` removes the entry stored as `'Kathmandu'`.
 *
 * Removing a CITY also forgets its GPS confirmation (key 34), because a confirmation is an
 * attribute of a lifetime visit (D-320) and a deleted visit must not leave a shadow record of the
 * place behind it. Removing a COUNTRY does not touch confirmations: a confirmation's `country` is
 * that day's label, not a claim about the country set, and matching on it would delete a city's
 * confirmation for a reason the user did not ask for.
 *
 * KNOWN CEILING, and it is a real one: a city or country the ACTIVE TRIP itself passes through
 * comes back on the next visit count (`lib/visit-autocount.ts` re-adds every trip place through
 * today on load, by design — it keeps no "already counted" bookkeeping because `addVisit` is
 * idempotent). Removal is therefore permanent only for places the trip does not claim, which is
 * every manually-added one. Making it stick for a trip place would need a suppression list, and
 * that is a decision (which record wins — the itinerary or the person?), not a patch.
 */
export function removeVisit(visit: { city?: string; country?: string }): VisitedPlaces {
  const current = getVisited();
  const next: VisitedPlaces = {
    cities: drop(current.cities, visit.city),
    countries: drop(current.countries, visit.country),
  };
  writeJson('local', STORAGE_KEYS.lifetimeVisits, next);
  if (typeof visit.city === 'string') forgetConfirmation(visit.city);
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

/**
 * Forget the confirmation for one city — the #30 half of `removeVisit` (issue #4).
 *
 * Module-private: a confirmation is not independently removable, and must not become so. It is an
 * attribute of a lifetime visit, so the only thing that may delete one is the deletion of the
 * visit it describes; an exported "unconfirm" would be a way to keep the visit while erasing the
 * evidence, which is a shape nothing in this app has a use for.
 *
 * `checkedOn` is preserved deliberately: it records that the check RAN on that day, which is still
 * true after the user edits their own history, and rewriting it would buy them an extra permission
 * prompt for nothing. No matching entry means no write at all.
 */
function forgetConfirmation(city: string): void {
  const key = fold(city);
  if (!key) return;
  const current = getVisitConfirmations();
  const confirmed = current.confirmed.filter((entry) => fold(entry.city) !== key);
  if (confirmed.length === current.confirmed.length) return;
  writeJson('local', STORAGE_KEYS.visitConfirmations, { ...current, confirmed });
}
