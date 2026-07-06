/**
 * Trip Vault — the load/save entry that replaces the internals of the itinerary
 * storage contract.
 *
 * `lib/itinerary-storage.ts` delegates its public `loadPlans` / `savePlans` /
 * `hasStoredPlans` internals here, passing its own (byte-identical, unchanged) key
 * constants and the `SAMPLE_ITINERARY` fallback. Keeping the on-disk key strings owned
 * by that module — and keeping this module generic over them — means every caller and
 * test of the public API is untouched. That contained blast radius IS the safety
 * strategy for a LIVE, sync-enabled site where the itinerary is real users' only
 * irreplaceable data.
 *
 * The four on-disk states this resolves (mapped through the envelope):
 *   A — key ABSENT               → seed sample (nothing to quarantine).
 *   B — legacy un-enveloped array (v2) → migrate v2→v3 → validate → payload verbatim (incl. []).
 *   C — valid v3 envelope        → validate payload → verbatim (incl. []).
 *   D — corrupt / parse-fail / lenient-Zod-fail / migrate-throw → quarantine → sample.
 * A future `schemaVersion` > current is read LENIENTLY, NEVER down-converted/quarantined.
 */
import type { DayPlan } from '@/lib/trip-data';
import { makeEnvelope, type VaultEnvelope } from './envelope';
import { parseItineraryPayload } from './schema';
import {
  CURRENT_ITINERARY_VERSION,
  runItineraryMigrations,
} from './migrations';

/**
 * Configuration for a Vault-backed storage slot. The itinerary passes its unchanged
 * key constants + sample here; the Vault stays generic over them.
 */
export interface VaultConfig {
  /** Main localStorage key (e.g. `nepal_japan_itinerary`). */
  storageKey: string;
  /** Quarantine key for corrupt raw bytes (e.g. `nepal_japan_itinerary_corrupt`). */
  quarantineKey: string;
  /** Fallback returned on absent/corrupt (e.g. `SAMPLE_ITINERARY`). */
  fallback: DayPlan[];
  /** Injected clock for the write timestamp; defaults to the real clock. */
  nowISO?: () => string;
}

const defaultNowISO = () => new Date().toISOString();

/**
 * Preserve a corrupt raw payload verbatim so it is never silently lost.
 *
 * - Writes `raw` to the quarantine key ONLY IF that key is currently absent
 *   (don't-clobber-first-capture — the first corruption most likely holds the user's
 *   real, recoverable data).
 * - `console.warn` so the loss is never silent.
 * - NEVER throws — the preserve attempt is itself try/caught (quota / disabled storage
 *   degrade quietly). Fires on ANY failure: parse error, unrecognized shape, failed
 *   lenient Zod validation, or a throwing migration step.
 */
function quarantineCorrupt(quarantineKey: string, raw: string): void {
  try {
    if (window.localStorage.getItem(quarantineKey) === null) {
      window.localStorage.setItem(quarantineKey, raw);
    }
    console.warn(
      '[trip-vault] corrupt itinerary data detected; original preserved at',
      quarantineKey,
    );
  } catch {
    /* ignore (quota / disabled storage) — never throw from a preserve attempt */
  }
}

/**
 * Detect the on-disk schema version of a parsed value.
 *   - array  ⇒ 2 (legacy un-enveloped, state B)
 *   - object with a numeric `schemaVersion` ⇒ that number (state C or a future version)
 *   - anything else ⇒ null (corrupt, state D)
 *
 * EXPORTED so the
 * whole-trip import path (`core/vault/export-import.ts`) makes the identical
 * migrate-vs-quarantine-vs-verbatim decision as this read path, from ONE source of
 * truth instead of a re-derived copy (drift risk on a data-integrity path).
 */
export function detectVersion(parsed: unknown): number | null {
  if (Array.isArray(parsed)) return 2;
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    typeof (parsed as { schemaVersion?: unknown }).schemaVersion === 'number'
  ) {
    return (parsed as { schemaVersion: number }).schemaVersion;
  }
  return null;
}

/**
 * Extract the payload to validate for a given detected version.
 *   - v2 (state B): the parsed array IS the payload (pre-envelope).
 *   - enveloped (state C / future): the envelope's `.payload`.
 *
 * EXPORTED — same
 * rationale as `detectVersion`: the import path reuses this instead of a copy.
 */
export function extractPayload(parsed: unknown, detected: number): unknown {
  if (detected <= 2) return parsed;
  return (parsed as VaultEnvelope<unknown>).payload;
}

/**
 * Vault-backed read — the four-state resolution (replaces the old `loadPlans` body).
 *
 * SSR-safe: returns the fallback under `typeof window === 'undefined'` so first paint
 * matches the post-hydration "first visit" state.
 */
export function loadItinerary(config: VaultConfig): DayPlan[] {
  const { storageKey, quarantineKey, fallback } = config;
  if (typeof window === 'undefined') return fallback;

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(storageKey);
  } catch {
    // Storage unreadable entirely — nothing to quarantine (no raw value read).
    return fallback;
  }
  // State A — key absent: never saved → seed sample.
  if (raw === null) return fallback;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Unparseable (state D): preserve raw, then fall back.
    quarantineCorrupt(quarantineKey, raw);
    return fallback;
  }

  const detected = detectVersion(parsed);
  if (detected === null) {
    // Neither array nor recognized envelope (state D): quarantine, fall back.
    quarantineCorrupt(quarantineKey, raw);
    return fallback;
  }

  // Forward-compat: a version GREATER than current is read leniently
  // and NEVER down-converted or quarantined-on-version — attempt the lenient payload
  // read as-is; only quarantine if that lenient read itself fails.
  let payload: unknown;
  if (detected > CURRENT_ITINERARY_VERSION) {
    payload = extractPayload(parsed, detected);
  } else {
    // States B & C: run the migration chain from the detected version up to current.
    // A throwing migration step (state D) is caught → quarantine → fall back.
    const toMigrate = extractPayload(parsed, detected);
    try {
      payload = runItineraryMigrations(toMigrate, detected);
    } catch {
      quarantineCorrupt(quarantineKey, raw);
      return fallback;
    }
  }

  // Validate the final payload against the CURRENT lenient Zod schema.
  const validated = parseItineraryPayload(payload);
  if (validated === null) {
    // Failed even the lenient schema (state D): quarantine, fall back.
    quarantineCorrupt(quarantineKey, raw);
    return fallback;
  }
  // States B / C / future: return the payload verbatim (incl. []).
  return validated;
}

/**
 * Vault-backed write — always emits the CURRENT envelope (incl. `payload: []`), so the
 * first `commit()` after a v2→v3 migration transparently upgrades the on-disk format.
 *
 * Always writes (no length gate) so "delete everything" is a durable state. SSR-safe
 * no-op when there is no window. Never throws (quota / disabled storage degrade quietly).
 */
export function saveItinerary(plans: DayPlan[], config: VaultConfig): void {
  const { storageKey } = config;
  if (typeof window === 'undefined') return;
  const nowISO = config.nowISO ?? defaultNowISO;
  const envelope = makeEnvelope(CURRENT_ITINERARY_VERSION, plans, nowISO());
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(envelope));
  } catch {
    /* ignore (quota / disabled storage) */
  }
}

/**
 * Has the user ever persisted an itinerary to this browser? True iff the storage key is
 * PRESENT (regardless of value — including an enveloped `[]` or a legacy `[]`). This is
 * the key-presence signal, unchanged by the envelope. SSR-safe: false under
 * no-window.
 */
export function hasStoredItinerary(config: VaultConfig): boolean {
  const { storageKey } = config;
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(storageKey) !== null;
  } catch {
    return false;
  }
}
