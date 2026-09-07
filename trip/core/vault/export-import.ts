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
 * - `parseBackup(rawText)` parses → migrates (if a legacy/older version) →
 * lenient-Zod-validates and returns the validated plans. It WRITES NOTHING: on ANY failure it
 * writes nothing to the main key, quarantines the bad blob ( pattern), and returns
 * `{ ok:false, error }`; on success the CALLER owns the commit (`savePlans` locally,
 * `restorePlans` under sync). A bad/hostile file can therefore never destroy the current trip.
 *
 * v1 SCOPE = itinerary-only. Identity/token/prefs are device-soft, not
 * portable trip data, so they are neither exported nor touched on import.
 */
import type { DayPlan } from '@/lib/trip-data';
import { loadPlans } from './storage';
import { keyFor, hasKey, writeString } from '@/core/storage/gateway';
import { makeEnvelope } from './envelope';
import { parseItineraryPayloadStrict } from './schema';
import { CURRENT_ITINERARY_VERSION, runItineraryMigrations } from './migrations';
// Reuse the read path's version detection + payload extraction (exported export-only
// from load-save.ts in) so import makes the IDENTICAL migrate-vs-quarantine
// decision as the on-disk read — ONE source of truth, no re-derived copy to drift.
import { detectVersion, extractPayload } from './load-save';

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
/**
 * How much of a rejected import is preserved (#411). The slot exists so a human can SEE why a
 * file was rejected, and the shape is visible in the first few KB — a version marker, a wrong
 * top-level key, a truncated brace. It is not an archive.
 *
 * Uncapped it was one: a whole-trip backup that lost its `domains` key carries every embedded
 * base64 photo, so a mid-size file that fits could sit on most of the ~5 MB localStorage budget
 * indefinitely. The worst case self-limited only because a file too big to store threw a quota
 * error into a swallowing catch, which is luck, not a design.
 */
const QUARANTINE_MAX_CHARS = 4096;

function quarantineImport(raw: string): void {
  if (typeof window === 'undefined') return;
  const quarantineKey = keyFor('itineraryCorrupt');
  // First rejection wins: an existing slot is the ORIGINAL failure and is more useful than the
  // most recent one, so it is never overwritten.
  if (hasKey('local', quarantineKey)) {
    console.warn('[trip-vault] rejected itinerary import; an earlier one is already preserved at', quarantineKey);
    return;
  }
  // The original length is kept because it is diagnostic in its own right — it is how you tell a
  // truncated 2 KB file apart from a 4 MB photo backup that lost its envelope.
  const preserved =
    raw.length <= QUARANTINE_MAX_CHARS
      ? raw
      : raw.slice(0, QUARANTINE_MAX_CHARS) + '\n… [truncated by trip-vault: ' + raw.length + ' chars total]';
  // Through the gateway, not a raw setItem: writeString is what raises `trip:quota-exceeded`, and
  // the old direct call meant a quarantine write that failed on quota did so completely silently.
  writeString('local', quarantineKey, preserved);
  console.warn('[trip-vault] rejected itinerary import; original preserved at', quarantineKey);
}

/**
 * Validate a whole-trip JSON string WITHOUT writing — the shared parse/migrate/validate
 * pipeline, so every Restore validates the backup with the IDENTICAL trust boundary (schema +
 * migrations + quarantine-on-failure) before it commits. Returns the validated `DayPlan[]` on
 * success; the CALLER owns the write.
 *
 * Pipeline (fails safe at every step — on ANY failure the main key is NOT written):
 * 1. JSON.parse(rawText) — parse error ⇒ reject + quarantine.
 * 2. detectVersion — unrecognized shape ⇒ reject + quarantine.
 * 3. runItineraryMigrations — a v2/older export migrates to current; a
 * throwing/gap migration ⇒ reject + quarantine.
 * A version GREATER than current is accepted
 * leniently —
 * its payload is validated as-is, not migrated.
 * 4. parseItineraryPayloadStrict — lenient-per-FIELD Zod (unknown categories/fields kept) but
 * ALL-OR-NOTHING over the payload; any malformed day or item ⇒ reject + quarantine.
 *
 * SYNC NOTE: the caller's commit is the DUAL PATH. Dormant/local is a plain `savePlans`
 * overwrite + a same-tab refresh, correct because there is no sync to unwind it. Under sync the
 * UI (`components/backup-restore.tsx`) hands the parsed plans to the store's `restorePlans()`,
 * which expresses the Restore as a tombstone-replace MERGE through `commit()`/outbox so it
 * PROPAGATES to the shared trip and survives the next snapshot (instead of the old
 * ingest-overwrite that the first-snapshot apply reverted). Export stays always-available.
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

  // The trust boundary: the same lenient SCHEMA the Vault read uses, but applied STRICTLY.
  // Deliberately NOT `parseItineraryPayload` (the degrading on-disk variant, #123): a partial
  // accept here overwrites the user's live trip with a truncated copy of the file and reports
  // success, and under sync `restorePlans` propagates the missing rows as tombstones. D-098.
  const validated = parseItineraryPayloadStrict(payload);
  if (validated === null) {
    quarantineImport(rawText);
    return {
      ok: false,
      error: 'That trip file is missing or has malformed data. No changes were made to your trip.',
    };
  }

  return { ok: true, plans: validated };
}
