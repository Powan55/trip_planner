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
 *   - `exportItinerary()` serializes the CURRENT itinerary as a `CURRENT_ITINERARY_VERSION`
 *     (currently v4) envelope string (Blob-ready; the download is wired in the UI —
 *     client-only, no server).
 *   - `importItinerary(rawText)` parses → migrates (if a legacy/older version) →
 *     lenient-Zod-validates → on success writes through the Vault path (`savePlans`)
 *     and fires the store's change event so the live UI refreshes. On ANY failure it
 *     writes NOTHING to the main key, optionally quarantines the bad blob (the
 *     don't-clobber-first pattern), and returns `{ ok:false, error }`. A bad/hostile
 *     import can therefore never destroy the current trip (fail-safe).
 *
 * v1 SCOPE = itinerary-only. Identity/token/prefs are device-soft, not
 * portable trip data, so they are neither exported nor touched on import.
 */
import { loadPlans, savePlans, ITINERARY_QUARANTINE_KEY } from '@/lib/itinerary-storage';
import { ITINERARY_CHANGED_EVENT } from '@/hooks/use-itinerary';
import { makeEnvelope } from './envelope';
import { parseItineraryPayload } from './schema';
import { CURRENT_ITINERARY_VERSION, runItineraryMigrations } from './migrations';
// Reuse the read path's version detection + payload extraction (exported export-only
// from load-save.ts) so import makes the IDENTICAL migrate-vs-quarantine
// decision as the on-disk read — ONE source of truth, no re-derived copy to drift.
import { detectVersion, extractPayload } from './load-save';

/** Discriminated result of an import attempt — success carries nothing, failure carries a reason. */
export type ImportResult = { ok: true } | { ok: false; error: string };

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
 * Quarantine a rejected import blob verbatim (don't-clobber-first), so a user
 * who imports the wrong/corrupt file can still recover its raw bytes. Reuses the
 * itinerary quarantine key. NEVER throws (the preserve attempt is itself guarded);
 * SSR/no-window safe. This does NOT touch the main itinerary key — the live trip is
 * untouched by a failed import.
 */
function quarantineImport(raw: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (window.localStorage.getItem(ITINERARY_QUARANTINE_KEY) === null) {
      window.localStorage.setItem(ITINERARY_QUARANTINE_KEY, raw);
    }
    console.warn(
      '[trip-vault] rejected itinerary import; original preserved at',
      ITINERARY_QUARANTINE_KEY,
    );
  } catch {
    /* ignore (quota / disabled storage) — never throw from a preserve attempt */
  }
}

/**
 * Import a whole-trip JSON string into the Vault, replacing the current itinerary.
 *
 * Pipeline (fails safe at every step — on ANY failure the main key is NOT written):
 *   1. JSON.parse(rawText)            — parse error ⇒ reject + quarantine.
 *   2. detectVersion                  — unrecognized shape ⇒ reject + quarantine.
 *   3. runItineraryMigrations         — a v2/older export migrates to current; a
 *                                       throwing/gap migration ⇒ reject + quarantine.
 *                                       A version GREATER than current is accepted
 *                                       leniently (read-only forward compatibility) —
 *                                       its payload is validated as-is, not migrated.
 *   4. parseItineraryPayload          — lenient Zod (unknown categories/fields kept);
 *                                       a genuinely malformed payload ⇒ reject + quarantine.
 *   5. savePlans(payload)             — the ONLY write; goes through the Vault so the
 *                                       on-disk envelope + persistence invariants all hold.
 *   6. dispatch ITINERARY_CHANGED_EVENT — same-tab liveness so the calendar/dashboard
 *                                       re-read immediately, no reload needed.
 *
 * SYNC NOTE: this import is an
 * INGEST path, not a local commit. It writes via `savePlans` + dispatches the change
 * event, but it does NOT go through the store's `commit()` — and pushes happen ONLY
 * from local commits (never from an applied snapshot/ingest). So on a sync-configured,
 * signed-in build a successful import does NOT propagate to the shared Firestore trip:
 * the next snapshot merge resurrects any items the import removed, and a reload's
 * first-snapshot-authoritative apply reverts the restore wholesale — i.e. it silently
 * does not stick. Because of that, the UI (`components/backup-restore.tsx`) DISABLES
 * Restore whenever sync is configured AND a traveler is signed in (local mode only for
 * now — Export stays available; guests + the dormant build keep Restore). Future work:
 * make Restore a real tombstone-replace that propagates to the shared trip;
 * until then this module's behavior is local write only.
 */
export function importItinerary(rawText: string): ImportResult {
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
  // down-converted (rollback safety) — take its payload as-is.
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

  // Success — the ONLY place we write. Vault write path + same-tab refresh.
  savePlans(validated);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ITINERARY_CHANGED_EVENT));
  }
  return { ok: true };
}
