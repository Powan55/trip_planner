/**
 * The passport stamp board (issue #5) — which of the lifetime visit set's COUNTRIES the passport
 * page has already greeted, and therefore which one is being stamped for the first time right now.
 *
 * It reads `core/places/visited.ts` and adds one fact of its own (gateway key 35). It is NOT a
 * second visit store: it never records a country, never orders one, and if this key were deleted
 * the passport would still show every stamp — it would just have nothing to celebrate.
 *
 * ── "NEWLY COUNTED" IS A DIFF, AND THE BASELINE IS THE POINT ────────────────────────────────────
 * `getVisited()` cannot tell you a country is new. It is a set with no timestamps: `['Nepal',
 * 'Japan']` reads identically on the visit that first counted Japan and on the two hundredth
 * page view afterwards. So "new" has to be measured against a remembered baseline, and the whole
 * design is the choice of baseline:
 *
 * - **Not mount time.** The realistic flow is another surface adding a country (issue #4's profile
 *   form, or `lib/visit-autocount.ts` crediting a trip day at boot) and the passport being opened
 *   afterwards. A baseline captured when the passport mounts already contains that country, so the
 *   one stamp that should land is the one that never would.
 * - **Not the session.** `entranceLedger` (D-293 rule 7) is the right mechanism for "this SURFACE
 *   has been greeted this session" and is used, unchanged, for this page's entrance via `<Reveal>`.
 *   It is the wrong mechanism for a stamp: a session ledger resets when the tab closes, so
 *   tomorrow's first passport view would re-unlock every country at once. A stamp is a lifetime
 *   event and needs a lifetime record.
 * - **The stamps already shown, on disk.** Which is this module. A country is newly counted iff it
 *   is in the visit set and not in this record; showing it puts it in the record; and the record
 *   outlives reloads, tabs, trip wipes and sign-out exactly as the visit set does.
 *
 * ── SEEDING: AN ABSENT SLOT IS NOT AN EMPTY ONE ─────────────────────────────────────────────────
 * A device that already holds twelve countries and has never opened the passport must not fire
 * twelve unlocks on its first view. `readShown()` therefore answers `null` for "never recorded"
 * and only `[]` for "recorded, and empty", and `newlyStamped(countries, null)` is `[]` — the first
 * read seeds the baseline and celebrates nothing. Same rule, and the same reason, as
 * `crossedIntoComplete`'s `prev === null` guard in `lib/celebration.ts`: the first observation
 * establishes the baseline, it never fires.
 *
 * That also fixes the degraded case in the safe direction. With storage disabled or unreadable
 * every read is `null` and every write no-ops, so the page renders every stamp and celebrates
 * none — never the reverse, which would be a burst on every single view.
 *
 * ── WHY THERE IS NO `fold()` HERE ───────────────────────────────────────────────────────────────
 * Both lists come from `getVisited().countries`, which is already deduped, trimmed, and pinned to
 * the first spelling ever recorded. Comparing those strings to a copy of those strings is exact by
 * construction, so the fold rule stays in the one module that owns it (`visited.ts`) rather than
 * gaining a second, silently divergent home here.
 */

import { readJson, writeJson, STORAGE_KEYS } from '@/core/storage/gateway';
import { getVisited } from '@/core/places/visited';

/** What the passport page renders: every country, and the subset being stamped for the first time. */
export interface StampBoard {
  /** Every country in the lifetime visit set, in first-visit order (`getVisited()`'s order). */
  countries: string[];
  /** The countries newly counted since the last passport view. A subset of `countries`. */
  fresh: string[];
}

/**
 * The already-greeted record, or `null` when this device has never rendered the passport.
 * TOTAL: absent, SSR, disabled storage and a corrupt slot all resolve to `null` (= seed), never a
 * throw. A non-array value is corrupt and seeds; an array is filtered to strings.
 */
function readShown(): string[] | null {
  const raw: unknown = readJson<unknown>('local', STORAGE_KEYS.passportStamps, null);
  if (!Array.isArray(raw)) return null;
  return raw.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * PURE, and the one rule worth unit-testing: the countries in `countries` that `shown` has not
 * greeted, in `countries` order. `shown === null` is the un-seeded device and yields `[]` — history
 * is not an unlock.
 */
export function newlyStamped(
  countries: readonly string[],
  shown: readonly string[] | null,
): string[] {
  if (shown === null) return [];
  const greeted = new Set(shown);
  return countries.filter((country) => !greeted.has(country));
}

/**
 * Read the board and CONSUME the unlock: every country visible now is recorded as greeted, so the
 * next view of this page — after a reload, in a new tab, tomorrow — reports no fresh stamps.
 *
 * Called once per mount (the caller guards with a ref, so a StrictMode double-effect cannot spend
 * the moment on a render nobody saw). The write is the whole current list rather than an append:
 * the record's meaning is "the countries the passport has shown", so re-writing it is also what
 * heals a corrupt or partial slot.
 */
export function claimStamps(): StampBoard {
  const countries = getVisited().countries;
  const fresh = newlyStamped(countries, readShown());
  writeJson('local', STORAGE_KEYS.passportStamps, countries);
  return { countries, fresh };
}
