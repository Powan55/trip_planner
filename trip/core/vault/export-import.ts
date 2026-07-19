/**
 * Trip Vault — whole-trip export / import.
 *
 * The one place UNTRUSTED itinerary data enters the Vault from outside the app
 * (a user-chosen file). The trust boundary is the SAME Zod schema the Vault read
 * path uses (`core/vault/schema.ts`) plus the SAME ordered migration runner
 * (`core/vault/migrations.ts`) — reusing them (never re-implementing) is what
 * guarantees an export→import round-trip is lossless AND that a v2-era export
 * imported into a v3 build migrates exactly as an on-disk v2 array would.
 *
 * Two functions, both framework-free (no React) but browser-facing:
 * - `exportItinerary()` serializes the CURRENT itinerary as a `CURRENT_ITINERARY_VERSION`
 * (currently v4) envelope string (Blob-ready; the download is wired in the UI —
 * client-only, no server).
 * - `importItinerary(rawText)` parses → migrates (if a legacy/older version) →
 * lenient-Zod-validates → on success writes through the Vault path (`savePlans`)
 * and fires the store's change event so the live UI refreshes. On ANY failure it
 * writes NOTHING to the main key, optionally quarantines the bad blob (
 * pattern), and returns `{ ok:false, error }`. A bad/hostile import can therefore
 * never destroy the current trip.
 *
 * v1 SCOPE = itinerary-only. Identity/token/prefs are device-soft, not
 * portable trip data, so they are neither exported nor touched on import.
 */
import type { DayPlan } from '@/lib/trip-data';
import { loadPlans, savePlans } from '@/lib/itinerary-storage';
import { keyFor } from '@/core/storage/gateway';
import { ITINERARY_CHANGED_EVENT } from '@/hooks/use-itinerary';
import { makeEnvelope } from './envelope';
import { parseItineraryPayload } from './schema';
import { CURRENT_ITINERARY_VERSION, runItineraryMigrations } from './migrations';
// Reuse the read path's version detection + payload extraction (exported export-only
// from load-save.ts in) so import makes the IDENTICAL migrate-vs-quarantine
// decision as the on-disk read — ONE source of truth, no re-derived copy to drift.
import { detectVersion, extractPayload } from './load-save';

/** Discriminated result of an import attempt — success carries nothing, failure carries a reason. */
export type ImportResult = { ok: true } | { ok: false; error: string };

/**
 * Discriminated result of PARSING a backup without writing — success carries the validated
 * `DayPlan[]`, failure carries a reason (and has already quarantined the bad blob). This is the
 * seam the tombstone-replace Restore-under-sync needs: it must VALIDATE the backup with the
 * SAME trust boundary as a plain import, then hand the parsed plans to the store's `restorePlans`
 * merge (rather than a blind `savePlans` overwrite that the next server snapshot would unwind).
 */
export type ParseResult = { ok: true; plans: DayPlan[] } | { ok: false; error: string };

/**
 * Serialize the current itinerary as a pretty-printed Vault envelope JSON string at the
 * CURRENT schema version (`CURRENT_ITINERARY_VERSION`, currently v4).
 *
 * Reads the live plans through the Vault (`loadPlans()`), wraps them in the CURRENT
 * envelope (`{ schemaVersion, updatedAt, payload }`) exactly as the write path does,
 * and stringifies. Pure w.r.t. storage (a read only) — the caller turns the string
 * into a Blob/download. Two-space indent so a human who opens the file can read it.
 */
export function exportItinerary(): string {
  const envelope = makeEnvelope(CURRENT_ITINERARY_VERSION, loadPlans(), new Date().toISOString());
  return JSON.stringify(envelope, null, 2);
}

/**
 * Quarantine a rejected import blob verbatim, so a user
 * who imports the wrong/corrupt file can still recover its raw bytes. Uses the itinerary
 * quarantine slot for the ACTIVE pack via `keyFor('itineraryCorrupt')` — so a
 * non-default pack quarantines under `trip:{id}:itineraryCorrupt` rather than bleeding onto
 * the default pack's legacy literal; the default pack grandfathers to that literal, byte-
 * identical. NEVER throws (the preserve attempt is itself guarded); SSR/no-window
 * safe. This does NOT touch the main itinerary key — the live trip is untouched by a failed
 * import.
 */
function quarantineImport(raw: string): void {
  if (typeof window === 'undefined') return;
  const quarantineKey = keyFor('itineraryCorrupt');
  try {
    if (window.localStorage.getItem(quarantineKey) === null) {
      window.localStorage.setItem(quarantineKey, raw);
    }
    console.warn(
      '[trip-vault] rejected itinerary import; original preserved at',
      quarantineKey,
    );
  } catch {
    /* ignore (quota / disabled storage) — never throw from a preserve attempt */
  }
}

/**
 * Import a whole-trip JSON string into the Vault, replacing the current itinerary.
 *
 * Pipeline (fails safe at every step — on ANY failure the main key is NOT written):
 * 1. JSON.parse(rawText) — parse error ⇒ reject + quarantine.
 * 2. detectVersion — unrecognized shape ⇒ reject + quarantine.
 * 3. runItineraryMigrations — a v2/older export migrates to current; a
 * throwing/gap migration ⇒ reject + quarantine.
 * A version GREATER than current is accepted
 * leniently —
 * its payload is validated as-is, not migrated.
 * 4. parseItineraryPayload — lenient Zod (unknown categories/fields kept);
 * a genuinely malformed payload ⇒ reject + quarantine.
 * 5. savePlans(payload) — the ONLY write; goes through the Vault so the
 * on-disk envelope + all hold.
 * 6. dispatch ITINERARY_CHANGED_EVENT — same-tab liveness so the calendar/dashboard
 * re-read immediately, no reload needed.
 *
 * SYNC NOTE: this DORMANT/local
 * path is unchanged — a plain `savePlans` overwrite + same-tab refresh, correct because there is
 * no sync to unwind it. Under sync it is NOT used: the UI (`components/backup-restore.tsx`) instead
 * calls `parseBackup()` (the validate-only seam below, SAME trust boundary) and hands the parsed
 * plans to the store's `restorePlans()`, which expresses the Restore as a tombstone-replace MERGE
 * through `commit()`/outbox so it PROPAGATES to the shared trip and survives the next snapshot
 * (instead of the old ingest-overwrite that the first-snapshot apply reverted). local-only
 * Restore disable is removed; Export stays always-available.
 */
export function importItinerary(rawText: string): ImportResult {
  const parsed = parseBackup(rawText);
  if (!parsed.ok) return parsed;

  // Success — the ONLY place THIS path writes. Vault write path + same-tab refresh (dormant/local).
  savePlans(parsed.plans);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ITINERARY_CHANGED_EVENT));
  }
  return { ok: true };
}

/**
 * Validate a whole-trip JSON string WITHOUT writing — the shared parse/migrate/validate
 * pipeline `importItinerary` delegates to, exposed so a synced Restore can validate the backup with
 * the IDENTICAL trust boundary (schema + migrations + quarantine-on-failure) and then MERGE the
 * result instead of overwriting. Fails safe at every step (on ANY failure the main key is NOT
 * written and the bad blob is quarantined —). Returns the validated `DayPlan[]` on success.
 */
export function parseBackup(rawText: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    quarantineImport(rawText);
    return { ok: false, error: 'That file is not valid JSON. No changes were made to your trip.' };
  }

  const detected = detectVersion(parsed);
  if (detected === null) {
    quarantineImport(rawText);
    return {
      ok: false,
      error: 'That file is not a recognized trip export. No changes were made to your trip.',
    };
  }

  // Migrate up to current (states v2/v3); a future version is read leniently and never
  // down-converted — take its payload as-is.
  let payload: unknown;
  if (detected > CURRENT_ITINERARY_VERSION) {
    payload = extractPayload(parsed, detected);
  } else {
    try {
      payload = runItineraryMigrations(extractPayload(parsed, detected), detected);
    } catch {
      quarantineImport(rawText);
      return {
        ok: false,
        error: 'That trip file could not be upgraded to the current format. No changes were made.',
      };
    }
  }

  // The trust boundary: the SAME lenient schema the Vault read uses.
  const validated = parseItineraryPayload(payload);
  if (validated === null) {
    quarantineImport(rawText);
    return {
      ok: false,
      error: 'That trip file is missing or has malformed data. No changes were made to your trip.',
    };
  }

  return { ok: true, plans: validated };
}
