import type { DayPlan } from './trip-data';
import { SAMPLE_ITINERARY } from './sample-itinerary';
import {
  loadItinerary,
  saveItinerary,
  hasStoredItinerary,
  type VaultConfig,
} from '@/core/vault/load-save';

/**
 * Single source of truth for the itinerary localStorage contract.
 *
 * The calendar planner and the dashboard MUST both go through these helpers so they
 * agree on exactly when SAMPLE_ITINERARY is seeded vs. when stored data is respected.
 *
 * The internals delegate to the framework-free
 * Trip Vault (`core/vault/`): a versioned `{ schemaVersion, updatedAt, payload }`
 * envelope, Zod-validated, with an ordered migration runner. The public API here —
 * exported function signatures and the two key constants — is BYTE-IDENTICAL to the
 * pre-Vault contract, so every caller (`hooks/use-itinerary.ts`, `lib/itinerary-remote.ts`,
 * every component and test) is untouched. This module owns the on-disk key strings and
 * the sample fallback; the Vault stays generic over them.
 *
 * The key insight is preserved and generalized by the Vault: distinguish states by the
 * KEY (and now the on-disk version), not by array length —
 *   1. key ABSENT                     -> first visit / never saved -> seed SAMPLE_ITINERARY.
 *   2. legacy bare array (v2)          -> migrate v2->v3 (lossless identity) -> return verbatim, incl. [].
 *   3. valid v3 envelope               -> return payload verbatim, incl. [].
 *   4. corrupt / parse-fail / Zod-fail / migrate-throw -> quarantine raw -> SAMPLE_ITINERARY.
 *
 * A deliberately-emptied itinerary ([]) is a legitimate, persisted state and must
 * survive reloads AND the migration — it must NOT be treated as "no data" and
 * overwritten with samples.
 */
export const ITINERARY_STORAGE_KEY = 'nepal_japan_itinerary';

/**
 * Quarantine key for corrupt itinerary payloads (generalized by the Vault).
 *
 * `loadPlans()` falls back to SAMPLE_ITINERARY whenever the stored value is corrupt
 * (non-array/non-envelope JSON, a parse error, a failed lenient Zod validation, or a
 * throwing migration step). Historically that fallback discarded the raw bytes outright —
 * and because the store's single write path (`commit()` in
 * `hooks/use-itinerary.ts`) always derives its next state from `loadPlans()` and then
 * `savePlans()`s it back to the MAIN key, the very next edit would silently and
 * permanently overwrite the user's real (corrupt-but-recoverable) trip with
 * sample-derived data.
 *
 * This key preserves the raw, corrupt string verbatim (don't-clobber-first) so it is
 * never lost — a future recovery UI (or manual devtools inspection) can still get the
 * user's bytes back. The Trip Vault folds every migrate/validate failure into this
 * same preserve-before-fallback discipline.
 */
export const ITINERARY_QUARANTINE_KEY = 'nepal_japan_itinerary_corrupt';

/** The Vault slot config for the itinerary — the unchanged keys + the sample fallback. */
const ITINERARY_VAULT: VaultConfig = {
  storageKey: ITINERARY_STORAGE_KEY,
  quarantineKey: ITINERARY_QUARANTINE_KEY,
  fallback: SAMPLE_ITINERARY,
};

/**
 * Load itinerary plans from localStorage (Vault-backed).
 *
 * - SSR / non-browser: returns SAMPLE_ITINERARY (no window) so first paint matches
 *   the post-hydration "first visit" state.
 * - Key absent: SAMPLE_ITINERARY (nothing to quarantine — there was never real data).
 * - Legacy bare array (v2): migrated losslessly to v3 and returned verbatim, incl. [].
 * - Valid v3 envelope: its payload verbatim, incl. [].
 * - Corrupt / unparseable / non-array-non-envelope / lenient-Zod-fail / migrate-throw:
 *   the raw string is quarantined (don't-clobber-first) before falling back to
 *   SAMPLE_ITINERARY, so the corrupt-but-recoverable bytes are never destroyed.
 */
export function loadPlans(): DayPlan[] {
  return loadItinerary(ITINERARY_VAULT);
}

/**
 * Has the user ever persisted an itinerary to this browser?
 *
 * True iff the storage key is PRESENT (regardless of value — including `[]`, whether a
 * legacy bare array or a v3 envelope). This is the key-presence signal from the contract
 * above, exposed so the remote-sync layer can distinguish "this client holds the
 * untouched SAMPLE_ITINERARY seed" (key absent ⇒ false) from "this client holds the
 * user's own edits, possibly a deliberate empty" (key present ⇒ true) when deciding what
 * to seed up to a never-synced remote.
 *
 * SSR-safe: returns false under no-window (matches loadPlans() returning the sample).
 */
export function hasStoredPlans(): boolean {
  return hasStoredItinerary(ITINERARY_VAULT);
}

/**
 * Persist itinerary plans to localStorage (Vault-backed).
 *
 * Always writes the CURRENT v3 envelope — including an empty array — so "delete
 * everything" is a durable state and the on-disk format upgrades transparently on the
 * first save after a migration. No length gate. SSR-safe no-op when there is no window.
 */
export function savePlans(plans: DayPlan[]): void {
  saveItinerary(plans, ITINERARY_VAULT);
}
