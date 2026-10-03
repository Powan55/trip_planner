/**
 * Full-trip backup / restore — the "lifeboat".
 *
 * whole-trip export/import is itinerary-ONLY by its own letter, and stays that way
 * (`export-import.ts` is untouched). THIS module is the wider "back up my WHOLE trip" that
 * "changes if the scope widens" clause names: one gzip file carrying every LOCAL user domain of the
 * ACTIVE trip — journal, photos (meta + blob bytes), expenses, budget, docs, packing, favorites,
 * day-anchors, share-inbox, my-places — plus the itinerary nested as its own
 * existing versioned Vault envelope.
 *
 * PRIVACY: photos are device-local, zero-egress. They are included here ONLY in a file the
 * user explicitly downloads to their own device — never a network egress — and the UI copy
 * (`components/backup-restore.tsx`) states plainly that the backup contains journal AND photos, so a
 * user can never be surprised that a "backup" carried their photos. Export iterates the active trip's
 * photo META ids (NOT `blobStore.list()`), so another trip's blobs can never ride along.
 *
 * NEVER-DESTROY on import:
 * Phase A — parse the whole file into memory with ZERO writes. A non-JSON / unrecognized file is
 * quarantined (via the itinerary corrupt slot) and rejected. A recognized full backup whose
 * `tripId` does not match the currently ACTIVE trip is refused outright (A-5) — export trip A,
 * switch to trip B, restore, and without this check every domain of B silently becomes A's. A
 * legacy itinerary-only file carries no trip id, so the same rule is applied to its DATES. A
 * malformed single domain is DROPPED (its current on-disk data left untouched), never aborting
 * the whole restore.
 * Phase B — commit each successfully-parsed domain via its existing accessor, and for the four
 * SYNCED domains through the outbox-decorated push as well, so a restore is not unwound by the
 * next server snapshot (`enqueueRestored`). Photo blobs are
 * written FIRST (id-preserving `putWithId`, so meta↔blob links survive) then the meta index; a
 * blob that fails to store leaves its meta as a placeholder and increments `photosSkipped`.
 * The caller reloads afterwards to re-hydrate every store.
 *
 * Framework-free: no React. Browser-facing (Blob/FileReader/IndexedDB). Client-only.
 */

import {
  journalStore,
  expensesStore,
  budgetStore,
  docsStore,
  packingStore,
  favoritesStore,
  dayAnchorStore,
  shareInboxStore,
  getActiveTripId,
  getDefaultTripAdopted,
  DEFAULT_TRIP_ID,
  type TripScopedSlot,
} from '@/core/storage/gateway';
import { myPlacesStore } from '@/core/storage/my-places-store';
import { getActiveTrip } from '@/core/trips';
import type { StoragePort, SyncPort } from '@/core/ports';
import { expensesSyncPort, expensesStoragePort } from '@/lib/expenses-ports';
import { budgetSyncPort, budgetStoragePort } from '@/lib/budget-ports';
import { docsSyncPort, docsStoragePort } from '@/lib/docs-ports';
import { placesSyncPort, myPlacesStoragePort } from '@/lib/places-ports';
import { sanitizeEntries, type JournalEntry } from '@/core/journal/model';
import { sanitizeExpenses, type Expense } from '@/core/budget/expenses';
import { getTripId, isRemoteConfigured, isTripRemoteConfigured } from '@/lib/firebase-config';
import { normalizeModel } from '@/core/budget/model';
import { sanitizeItems as sanitizeDocs, type DocItem } from '@/core/docs/model';
import { sanitizeItems as sanitizePacking } from '@/core/packing/model';
import { sanitizeItems as sanitizeShare } from '@/core/share/model';
import { sanitizePlaces, type MyPlace } from '@/core/places/model';
import { sanitizePhotos, repointExpenseOwner, type PhotoMeta } from '@/core/photos/model';
import { loadPhotos, savePhotos, deletePhotoBlobs } from '@/core/photos/storage';
import { defaultBlobStore, type BlobStorePort } from '@/core/photos/blob-store';
import { compressToBlob, decompressBlobOrText, supportsCompression, MAX_IMPORT_BYTES } from '@/core/vault/compression';
import { downloadBlob } from '@/lib/download-blob';
import { exportItinerary, parseBackup } from '@/core/vault/export-import';
import { savePlans } from '@/core/vault/storage';
import type { DayPlan } from '@/lib/trip-data';

/** Export filenames (moved here from `backup-restore.tsx` — Ruling 2 pure lift, so the ONE
 * caller-side download helper below owns the filename choice, not each call site.) */
const EXPORT_FILENAME = 'nepal-japan-trip-backup.json';
// gzip-compressed exports (native CompressionStream) get a `.gz` filename; the bytes stay
// auto-detected on import by gzip magic bytes regardless of what a user renames the file to.
const EXPORT_FILENAME_GZ = 'nepal-japan-trip-backup.json.gz';

/**
 * How the itinerary domain is committed on import — the DUAL PATH. Defaults to the local Vault
 * overwrite (`savePlans`); the UI injects the store's `restorePlans` (tombstone-replace MERGE) when a
 * synced traveler is signed in, so a restore PROPAGATES to the shared trip and survives the next server
 * snapshot instead of being unwound. Same `(plans) => void` shape either way.
 */
export type CommitItinerary = (plans: DayPlan[]) => boolean | void;

/**
 * How the myPlaces domain is committed on import — the SAME dual-path idea as `CommitItinerary`,
 * one domain narrower (issue #239). Absent ⇒ the generic bare write + `enqueueRestored` merge below
 * (unchanged default); the UI injects the store's `restoreMyPlaces` (tombstone-replace, mirroring
 * `restorePlans`/`restoreExpenses`) when a synced traveler is signed in, so a row added to myPlaces
 * after the backup was taken is tombstoned by the restore instead of surviving the next merge.
 */
export type CommitMyPlaces = (places: MyPlace[]) => boolean | void;

/**
 * How the docsChecklist domain is committed on import — issue #295, the deliberately-deferred
 * remainder of #239. NOT the same shape as `CommitMyPlaces`/`CommitItinerary`: docsChecklist's 18
 * ids are a FIXED template with no add/remove path, so there is nothing to tombstone and no id to
 * mint fresh — a same-id UPSERT is the whole restore. Absent ⇒ the generic bare write + merge
 * enqueue below (unchanged default); the UI injects the store's `restoreDocsChecklist`
 * (`mergeItems(current, backup)`, the same row-merge algebra `pushChecklistMerged` already uses
 * remotely) when a synced traveler is signed in, so a row edited after the backup was taken keeps
 * its win instead of being blindly clobbered by the restore's bare write.
 */
export type CommitDocsChecklist = (items: DocItem[]) => boolean | void;

/** How the expenses domain is committed on import — same idea as `CommitMyPlaces`; the UI injects
 * `restoreExpenses` (tombstone-replace) under sync. Absent ⇒ generic bare write + merge. A returned
 * Map names the fresh id each backup expense got, so restored receipt photos follow (D-671). */
export type CommitExpenses = (expenses: Expense[]) => Map<string, string> | boolean | void;

/** The container's magic string — how import tells a full backup from a legacy itinerary-only export. */
export const BACKUP_FORMAT = 'nepal-japan-trip-backup';
/** Container version, read on import: anything HIGHER is refused (see `importTripBackup`). Bump it
 *  only alongside a migration for the shape it names — a bump on its own locks users out of the
 *  backups they already hold. Distinct from the itinerary Vault envelope's own `schemaVersion`
 *  nested at `domains.itinerary`, which has its own runner and its own forward-version rule. */
export const BACKUP_VERSION = 1;

/** On-disk envelope. `domains` holds each domain's raw JSON value (itinerary nests its Vault envelope);
 * `photos.blobs` maps each meta id → a base64 DATA URL (self-describing MIME, decoded with one line —
 * a superset of "base64" that also round-trips the image type). */
export interface TripBackup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  tripId: string;
  /** The shared (remote) trip id at export, '' when unshared. `tripId` is the local pack id, which
   *  every shared copy of the default pack has in common, so it cannot tell two shared trips apart.
   *  Optional: files from before it existed lack it, and older builds ignore it. */
  remoteId?: string;
  domains: Record<string, unknown>;
  photos: { meta: PhotoMeta[]; blobs: Record<string, string> };
}

const NOTHING_WRITTEN =
  'Nothing could be restored — your browser refused every write, likely because storage is full. No changes were made to your trip.';

export type ImportBackupResult =
  | { ok: true; restored: string[]; photosSkipped: number; refused: string[]; dropped: string[] }
  | { ok: false; error: string };

/** Sentinel telling an absent/corrupt slot from a legitimately-stored value on export (see below). */
const ABSENT = Symbol('absent');

/** True for a plain (non-array, non-null) object — the shape gate for object-valued domains. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * The nine generic (non-itinerary, non-photo) domains. Each entry knows how to READ its raw value for
 * export, WRITE a cleaned value on import, and VALIDATE an imported value — returning `null` to DROP a
 * malformed domain (never-destroy: a drop leaves the live on-disk data untouched). The validate gate is
 * a TOP-LEVEL shape check (array vs object) followed by the domain's own existing sanitizer; the shape
 * check is what turns "garbage that would coerce to an empty default" into a drop instead of a wipe.
 */
type DomainSpec = {
  read: () => unknown;
  /** Returns `false` only where the store surfaces `writeJson`'s result — expenses/budget/docs/
   * myPlaces (via `enqueueRestore` below) and journal (its own `journal-remote` push, gated
   * inline). The rest are genuinely fire-and-forget and return `undefined`, which `!== false`
   * gates as OK. */
  write: (cleaned: unknown) => boolean | void;
  validate: (parsed: unknown) => unknown | null;
  /** The 4 SyncPort-backed domains only — see `enqueueRestored`. Captures the pre-restore local
   * state, so it MUST be called before `write`; its returned thunk must fire only once `write`
   * reports success (issue #698 — a refused local write must not reach every member's device).
   * Absent ⇒ either local-only, or (journal) synced through its own path that gates on `write`'s
   * result itself rather than this hook. */
  enqueueRestore?: (cleaned: unknown) => () => void;
};

/**
 * Make a restored domain's value survive the next server snapshot, instead of being silently
 * unwound by it.
 *
 * The bare `spec.write` below is a gateway write: it never reaches `commit()`, so nothing is
 * enqueued in the sync outbox. On the reload that follows a restore, the first remote snapshot
 * takes its "remote is authoritative" branch for every chunk that is present remotely and NOT
 * dirty — which was all of them — and overwrote the just-restored rows while the UI reported
 * success. Only the itinerary escaped that, via the `CommitItinerary` dual path.
 *
 * So route the restored value through the domain's EXISTING outbox-decorated push (`withOutbox`,
 * the same seam every ordinary edit uses): the write-ahead enqueue is synchronous, so the dirty
 * chunks are on disk before the reload, and the first snapshot takes the MERGE branch for them.
 * Self-gating — dormant/guest builds no-op, exactly as before.
 *
 * KNOWN CEILING: merge, not tombstone-replace, for whichever domain has no restore-shaped commit
 * injected. A row the backup DROPPED (present remotely, absent in the file) survives the merge,
 * where the itinerary's `restorePlans` would tombstone it. Fixing that needs a restore-shaped
 * commit on each domain — expenses (`restoreExpenses`, injected via `CommitExpenses`), myPlaces
 * (`restoreMyPlaces`, injected via `CommitMyPlaces`) and docsChecklist (`restoreDocsChecklist`, injected via `CommitDocsChecklist`,
 * issue #295) all have one now. docsChecklist's is NOT a tombstone-replace: its 18 ids are a FIXED
 * template with no add/remove path, so the restore-shaped commit there is a same-id UPSERT
 * (`mergeItems(current, backup)` — whichever side's stamp is newer wins per id) rather than a
 * tombstone + fresh-id re-add. budget's field-level LWW model remains the one domain still on the
 * generic merge path; it needs its own restore design, not a copy of either shape here. Upgrade
 * path for a domain that DOES fit one of the two existing shapes: inject its restore fn the way
 * `commitItinerary`/`commitExpenses`/`commitMyPlaces`/`commitDocsChecklist` are injected.
 */
function enqueueRestored<T>(port: SyncPort<T>, storage: StoragePort<T>): (cleaned: unknown) => () => void {
  return (cleaned) => {
    const prev = storage.load(); // pre-restore state, captured before the caller's `write`
    return () => void port.push(prev, cleaned as T);
  };
}

// Declared with `satisfies` rather than a `: Record<string, DomainSpec>` annotation so `keyof typeof
// DOMAINS` below stays the literal key union instead of widening to `string` — the annotation would
// make the exhaustiveness guard below vacuously true regardless of which keys actually exist.
const DOMAINS = {
  journal: {
    read: () => journalStore.get<unknown>(ABSENT),
    write: (v) => {
      const ok = journalStore.set(v);
      // Re-stamp each restored day so the restore wins on the author's other devices (D-596).
      // Gated on `ok` (#698 follow-up): pushJournalEntry re-reads the LOCAL journal to stamp it,
      // so on a refused write it would re-read the OLD (pre-restore) entry and push that with a
      // fresh HLC — old content wins everywhere, and a date the backup dropped locally gets
      // pushed out as a deletion.
      if (ok && isRemoteConfigured()) {
        const dates = (v as JournalEntry[]).map((e) => e.date);
        void import('@/lib/journal-remote').then((m) => dates.forEach((d) => void m.pushJournalEntry(d)));
      }
      return ok;
    },
    validate: (v) => (Array.isArray(v) ? sanitizeEntries(v) : null),
  },
  expenses: {
    read: () => expensesStore.get<unknown>(ABSENT),
    write: (v) => expensesStore.set(v),
    validate: (v) => (Array.isArray(v) ? sanitizeExpenses(v) : null),
    enqueueRestore: enqueueRestored(expensesSyncPort, expensesStoragePort),
  },
  budget: {
    read: () => budgetStore.get<unknown>(ABSENT),
    write: (v) => budgetStore.set(v),
    validate: (v) => (isPlainObject(v) ? normalizeModel(v) : null),
    enqueueRestore: enqueueRestored(budgetSyncPort, budgetStoragePort),
  },
  docsChecklist: {
    read: () => docsStore.get<unknown>(ABSENT),
    write: (v) => docsStore.set(v),
    // fallback=[] so an imported empty/garbage array does NOT inject the built-in template here;
    // the docs store re-seeds its template on the next read if the slot ends up empty.
    validate: (v) => (Array.isArray(v) ? sanitizeDocs(v, []) : null),
    enqueueRestore: enqueueRestored(docsSyncPort, docsStoragePort),
  },
  packing: {
    read: () => packingStore.get<unknown>(ABSENT),
    write: (v) => packingStore.set(v),
    validate: (v) => (Array.isArray(v) ? sanitizePacking(v, []) : null),
  },
  favorites: {
    read: () => favoritesStore.get<unknown>(ABSENT),
    write: (v) => favoritesStore.set(v),
    validate: (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string') : null),
  },
  dayAnchors: {
    read: () => dayAnchorStore.get<unknown>(ABSENT),
    write: (v) => dayAnchorStore.set(v),
    validate: (v) =>
      isPlainObject(v)
        ? Object.fromEntries(Object.entries(v).filter(([, val]) => typeof val === 'string'))
        : null,
  },
  shareInbox: {
    read: () => shareInboxStore.get<unknown>(ABSENT),
    write: (v) => shareInboxStore.set(v),
    validate: (v) => (Array.isArray(v) ? sanitizeShare(v) : null),
  },
  // A-9: the one TRIP_SCOPED_SLOTS domain the original DOMAINS list omitted. Same read/write/validate
  // shape as every other generic domain, reusing the places domain's own total sanitizer
  // (`core/places/model.ts`) rather than inventing one — an imported place is a `MyPlace[]`, same
  // array-of-rows shape as journal/expenses/etc. `myPlacesStore` is imported from its own module
  // (not `gateway.ts`, which deliberately omits it for bundle-size reasons — see that store's header)
  // since backup.ts is not part of the app-wide First Load chunk.
  myPlaces: {
    read: () => myPlacesStore.get<unknown>(ABSENT),
    write: (v) => myPlacesStore.set(v),
    validate: (v) => (Array.isArray(v) ? sanitizePlaces(v) : null),
    enqueueRestore: enqueueRestored(placesSyncPort, myPlacesStoragePort),
  },
} satisfies Record<string, DomainSpec>;

/**
 * Root-cause guard for A-9: a compile-time tie between `DOMAINS`' keys and every `TripScopedSlot`,
 * the same exhaustiveness idiom `gateway.ts`'s `_ExhaustiveTripScopedSlots` uses. `itinerary` and
 * `photos` are handled OUTSIDE `DOMAINS` (their own sections above/below) rather than missing; the
 * other four are D-227's deliberate exclusions (`weatherCache` regenerable, `syncOutbox` transient
 * sync machinery, `itineraryCorrupt`/`expensesCorrupt` quarantine — #100/A-10 added the latter,
 * same bucket as its sibling: a quarantine slot holds raw corrupt bytes, not a domain worth
 * restoring). Add a member to `TripScopedSlot` without adding it to one of these buckets and `tsc`
 * fails here — so a slot can never again silently ride along in `TRIP_SCOPED_SLOTS` (and therefore
 * get wiped by the sign-out "back up first" button) without this backup module knowing to carry it.
 */
type _ExhaustiveBackupDomains = [TripScopedSlot] extends
  [
    | keyof typeof DOMAINS
    | 'itinerary'
    | 'photos'
    | 'weatherCache'
    | 'syncOutbox'
    | 'itineraryCorrupt'
    | 'expensesCorrupt'
    // #330 — a device fact (which leg the backup nudge already fired for), not user content;
    // same bucket as weatherCache/syncOutbox above.
    | 'backupPromptLeg'
    // D-536 — the concierge thread stays on the device that had it.
    | 'conciergeChat'
    // D-596 — the journal's per-entry sync stamps: sync machinery, like syncOutbox.
    | 'journalSync',
  ]
  ? true
  : never;
const _exhaustiveBackupDomains: _ExhaustiveBackupDomains = true;
void _exhaustiveBackupDomains;

// ── base64 (large-blob safe) ────────────────────────────────────────────────
/**
 * Blob → base64 data URL via `FileReader.readAsDataURL`. This is the large-blob-safe encoder — it does
 * NOT do `btoa(String.fromCharCode(...bytes))`, whose argument spread overflows the call stack on a
 * multi-hundred-KB photo. Rejects only if the underlying read fails.
 */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error ?? new Error('read failed'));
    fr.readAsDataURL(blob);
  });
}

/**
 * base64 data URL → Blob via chunked `atob` (NOT a byte spread — same overflow trap in reverse). Reads
 * the MIME back out of the data URL header so the restored blob keeps its image type. Throws on a
 * malformed data URL (the caller catches and skips that one photo).
 */
function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  if (comma < 0 || !dataUrl.startsWith('data:')) throw new Error('not a data URL');
  const mime = /^data:([^;,]+)/.exec(dataUrl)?.[1] || 'application/octet-stream';
  const bin = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// ── Export ──────────────────────────────────────────────────────────────────
/** Headroom under the import cap for gzip header / envelope slack. */
const EXPORT_HEADROOM_BYTES = 1024 * 1024;

export type TripBackupExport = {
  blob: Blob;
  /** Photos whose metadata exists but whose bytes were not in the blob store. */
  missing: number;
  /** Photos left out (metadata kept) so the file stays under the import cap. */
  omitted: number;
};

/**
 * Serialize the ACTIVE trip's every in-scope local domain into one gzip blob (the existing
 * `compressToBlob` pipeline — no new dep, plain-JSON fallback where CompressionStream is absent).
 * Photos are inlined until a running byte budget (`maxBytes` minus headroom minus everything else) is
 * spent; the rest keep metadata only, which restore already treats as a placeholder, so the file
 * stays within what `importTripBackup` will open. `blobStore`/`maxBytes` are injectable for tests.
 */
export async function buildTripBackup(
  blobStore: BlobStorePort = defaultBlobStore,
  maxBytes: number = MAX_IMPORT_BYTES,
): Promise<TripBackupExport> {
  const domains: Record<string, unknown> = {};

  // Itinerary — nest its OWN existing versioned Vault envelope.
  domains.itinerary = JSON.parse(exportItinerary());

  // Generic domains — capture each slot's raw on-disk value; skip an absent/corrupt slot.
  for (const [slot, spec] of Object.entries(DOMAINS)) {
    const value = spec.read();
    if (value !== ABSENT) domains[slot] = value;
  }

  // Photos — iterate the active trip's META ids ONLY (never blobStore.list(), which would leak other
  // trips' blobs), inlining each present blob as a base64 data URL.
  const meta = loadPhotos();
  const blobs: Record<string, string> = {};
  const envelope: TripBackup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    tripId: getActiveTripId(),
    remoteId: getTripId(),
    domains,
    photos: { meta, blobs },
  };
  // KNOWN CEILING: budget uses uncompressed JSON size, so a few photos that would fit gzipped are omitted
  // (it bounds the gzip output, and equals it in the plain-JSON fallback).
  let budget = maxBytes - EXPORT_HEADROOM_BYTES - new Blob([JSON.stringify(envelope)]).size;
  let missing = 0;
  let omitted = 0;
  for (const m of meta) {
    const blob = await blobStore.get(m.id);
    if (!blob) {
      missing++;
      continue;
    }
    // base64 length + data-URL header + JSON key/quotes, checked before the read allocates it.
    const cost = Math.ceil(blob.size / 3) * 4 + m.id.length + 64;
    if (cost > budget) {
      omitted++;
      continue;
    }
    blobs[m.id] = await blobToDataUrl(blob);
    budget -= cost;
  }

  const out = await compressToBlob(JSON.stringify(envelope));
  if (out.size > maxBytes) {
    throw new Error('This trip is too large to back up in one file (over ' + Math.round(maxBytes / (1024 * 1024)) + ' MB).');
  }
  return { blob: out, missing, omitted };
}

export async function exportTripBackup(blobStore: BlobStorePort = defaultBlobStore): Promise<Blob> {
  return (await buildTripBackup(blobStore)).blob;
}

/**
 * Download the active trip's whole-trip backup as a file; shared by `backup-restore.tsx` and the
 * sign-out confirm dialog's backup offer.
 *
 * Can THROW (a `FileReader` failure, a `CompressionStream` failure, or a trip too large for one
 * file) — the CALLER owns try/catch and the user-facing error copy. Returns the filename plus how
 * many photos were absent from storage (`missing`) or left out for size (`omitted`).
 */
export async function downloadTripBackup(
  blobStore: BlobStorePort = defaultBlobStore,
): Promise<{ filename: string; missing: number; omitted: number }> {
  const { blob, missing, omitted } = await buildTripBackup(blobStore);
  const filename = supportsCompression() ? EXPORT_FILENAME_GZ : EXPORT_FILENAME;
  downloadBlob(blob, filename);
  return { filename, missing, omitted };
}

// ── Import ──────────────────────────────────────────────────────────────────
/** Narrow an unknown parse to a full-trip backup envelope by its magic `format`. */
function isTripBackup(v: unknown): v is TripBackup {
  return isPlainObject(v) && v.format === BACKUP_FORMAT && isPlainObject(v.domains);
}

/**
 * Restore a whole-trip backup into the ACTIVE trip, replacing it. Fails safe:
 * - a non-JSON / unrecognized file OR a legacy itinerary-only export is routed to the importer,
 * which quarantines-or-imports the ITINERARY only and never touches another domain;
 * - a container stamped with a version this build does not know is refused outright, rather than
 * read as if it were a v1 one;
 * - a recognized full backup restores every WELL-FORMED domain and drops any malformed one, and
 * names what it committed in `restored` so the caller can report the truth rather than a fixed
 * success string.
 * The caller reloads on `ok:true` to re-hydrate the stores. `blobStore` is injectable for tests.
 */
export async function importTripBackup(
  file: Blob,
  blobStore: BlobStorePort = defaultBlobStore,
  commitItinerary: CommitItinerary = savePlans,
  commitMyPlaces?: CommitMyPlaces,
  commitDocsChecklist?: CommitDocsChecklist,
  commitExpenses?: CommitExpenses,
): Promise<ImportBackupResult> {
  // #570: under sync a restore tombstones every live row and pushes, so it must be tied to THIS
  // shared trip. The pack id can't do that (all shared copies of the default pack share it); the
  // remote id can. A file without one can't prove where it came from, so it only restores unshared.
  const synced = isTripRemoteConfigured();
  const UNMATCHED: ImportBackupResult = {
    ok: false,
    error:
      "This backup isn't tied to this shared trip (it was made before trip matching, or on an unshared copy), so restoring it here could overwrite everyone's data. Restore it on an unshared copy instead. No changes were made to your trip.",
  };
  let text: string;
  try {
    text = await decompressBlobOrText(file);
  } catch (e) {
    const tooLarge = e instanceof Error && e.message.startsWith('That file is too large');
    return {
      ok: false,
      error: tooLarge
        ? `${e.message} No changes were made to your trip.`
        : 'Could not read that backup file. No changes were made to your trip.',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }

  // Not a full-trip backup → treat as a legacy itinerary-only export (or garbage). Validate through the
  // SAME trust boundary (`parseBackup` quarantines on failure, writing AT MOST the corrupt slot)
  // and commit through the DUAL PATH — so a legacy file imported under sync also propagates (never the
  // savePlans-overwrite hole). Every non-itinerary domain is untouched.
  if (!isTripBackup(parsed)) {
    const pr = parseBackup(text);
    if (!pr.ok) return { ok: false, error: pr.error };
    if (synced) return UNMATCHED;
    // A-5 on the COMMIT, not on the envelope field. The legacy itinerary-only envelope
    // (`{schemaVersion, updatedAt, payload}`) carries no trip identity at all, so it used to sail
    // past the `env.tripId` check three lines below and replace whatever trip happened to be
    // active — and under sync `commitItinerary` is `restorePlans`, which propagates that
    // replacement to every other member. The only identity such a file carries is its DATES, so
    // that is what gets checked: at least one day has to fall inside the active trip's span. A
    // legitimate same-trip restore costs nothing (every day is in span, by construction); an empty
    // payload is refused too, since committing it is the whole-trip wipe D-098 exists to prevent.
    const trip = getActiveTrip();
    if (!pr.plans.some((d) => d.date >= trip.start && d.date <= trip.end)) {
      return {
        ok: false,
        error: 'This backup is from a different trip. Switch to that trip, then restore it there.',
      };
    }
    if (commitItinerary(pr.plans) === false) return { ok: false, error: NOTHING_WRITTEN };
    return { ok: true, restored: ['itinerary'], photosSkipped: 0, refused: [], dropped: [] };
  }

  // A-5: refuse a cross-trip restore rather than silently overwriting the active trip. `env.tripId`
  // is stamped by `exportTripBackup` (above) at export time; comparing it to the CURRENTLY active
  // trip is the only signal in the envelope naming which trip it belongs to. Without this, exporting
  // trip A, switching to trip B, and restoring silently replaces every domain of B with A's — and
  // under sync propagates to B's other members. Zero writes have happened yet (still Phase A).
  const env = parsed;

  // `version` was stamped on export and never read, so a v2 container was restored as if it were a
  // v1 one — `DOMAINS` has no spec for a slot it does not know, so the loop below never visits it and
  // the domain vanished into the success string. Checked BEFORE `tripId`: a format this build cannot
  // claim to understand is not one whose fields it should be reading. The copy says NEWER rather than
  // corrupt because those send the user hunting two different things, and only one of them exists.
  if (env.version > BACKUP_VERSION) {
    return {
      ok: false,
      error:
        'That backup was made by a newer version of this app, so this version cannot read it safely. No changes were made to your trip.',
    };
  }

  if (env.tripId !== getActiveTripId()) {
    return {
      ok: false,
      error: 'This backup is from a different trip. Switch to that trip, then restore it there.',
    };
  }

  if (synced) {
    // A custom pack's id IS its shared id, so an older custom-trip file is already proven by tripId.
    const remoteId =
      typeof env.remoteId === 'string' ? env.remoteId : env.tripId !== DEFAULT_TRIP_ID ? env.tripId : '';
    if (!remoteId) {
      // D-651: this device's own default pack became this trip, and the file predates that.
      const adopted = env.tripId === DEFAULT_TRIP_ID ? getDefaultTripAdopted() : null;
      const exportedAt = typeof env.exportedAt === 'string' ? Date.parse(env.exportedAt) : NaN;
      if (!adopted || adopted.shareId !== getTripId() || !(exportedAt <= Date.parse(adopted.at))) {
        return UNMATCHED;
      }
    } else if (remoteId !== getTripId()) {
      return {
        ok: false,
        error:
          'This backup is from a different shared trip. Switch to that trip, then restore it there. No changes were made to your trip.',
      };
    }
  }

  // ── Phase A — parse everything into memory, ZERO domain writes ──
  const domainWrites: Array<[string, unknown]> = [];
  // Present in the file but malformed, so left as they are — named so the caller can say so.
  const dropped: string[] = [];
  for (const [slot, spec] of Object.entries(DOMAINS)) {
    if (!(slot in env.domains)) continue;
    const cleaned = spec.validate(env.domains[slot]);
    if (cleaned !== null) domainWrites.push([slot, cleaned]); // else: malformed → drop (never-destroy)
    else dropped.push(slot);
  }

  // Itinerary — validate the nested envelope through the SAME trust boundary (parseBackup); a
  // malformed itinerary is dropped (parseBackup has already quarantined it) and the live one survives.
  let itinPlans: DayPlan[] | null = null;
  if ('itinerary' in env.domains) {
    const pr = parseBackup(JSON.stringify(env.domains.itinerary));
    if (pr.ok) itinPlans = pr.plans;
    else dropped.push('itinerary');
  }

  // Photos — sanitize meta, decode each present blob. `hasMeta` is the shape gate the generic
  // domains get from `spec.validate` above: photos are the only domain with no remote copy, so a
  // malformed `meta` must DROP (leave the live index and its blobs alone), not commit an empty set.
  // An EMPTY meta is treated as absent too (#751): replacing with nothing would delete every photo
  // on this device, and they exist nowhere else.
  const rawMeta = env.photos?.meta;
  const metas = Array.isArray(rawMeta) ? sanitizePhotos(rawMeta) : [];
  const hasMeta = metas.length > 0;
  if (!hasMeta && rawMeta !== undefined && !(Array.isArray(rawMeta) && rawMeta.length === 0)) dropped.push('photos');
  const decoded: Array<[string, Blob]> = [];
  let photosSkipped = 0;
  for (const m of metas) {
    const dataUrl = env.photos?.blobs?.[m.id];
    if (typeof dataUrl === 'string') {
      try {
        decoded.push([m.id, dataUrlToBlob(dataUrl)]);
      } catch {
        photosSkipped++; // malformed data URL → this photo becomes a placeholder (meta kept, blob absent)
      }
    }
  }

  // Nothing survived validation — refuse before Phase B touches anything, so this can honestly
  // promise no write happened.
  if (domainWrites.length === 0 && itinPlans === null && metas.length === 0) {
    return {
      ok: false,
      error:
        'Nothing in that file could be restored — no itinerary, journal, photos or other trip data was found in it. No changes were made to your trip.',
    };
  }

  // ── Phase B — commit ──
  const restored: string[] = [];
  // Domains whose local write was refused (e.g. quota): named so the caller can say so, never claimed.
  const refused: string[] = [];

  // Blobs FIRST (id-preserving), so a re-import doesn't duplicate and meta↔blob links hold.
  const putIds = new Set<string>();
  for (const [id, blob] of decoded) {
    const res = await blobStore.putWithId(id, blob);
    if (res.ok) putIds.add(id);
    else photosSkipped++; // stored blob failed → meta stays as a placeholder
  }
  // Any meta whose blob was never provided at all is also a placeholder.
  photosSkipped += metas.filter((m) => env.photos?.blobs?.[m.id] === undefined).length;

  // Backup expense id → the fresh id it was restored under (sync mints new ones, D-671).
  let expenseIds = new Map<string, string>();

  // `slot` here is a runtime string key (built from `Object.entries` above), not one of DOMAINS'
  // literal keys — the cast is safe because `slot` only ever came FROM `Object.entries(DOMAINS)`.
  const domainsBySlot = DOMAINS as Record<string, DomainSpec>;
  for (const [slot, cleaned] of domainWrites) {
    // myPlaces' injected dual path (issue #239): when the caller supplies `commitMyPlaces` (the
    // UI passes the store's `restoreMyPlaces` under sync), route through it INSTEAD of the bare
    // write + generic merge enqueue — same idea as `commitItinerary`, one domain narrower. Absent
    // ⇒ unchanged default behavior below.
    // Only an explicit `false` is a refusal, so a commit that returns nothing still counts as landed.
    if (slot === 'expenses' && commitExpenses) {
      const res = commitExpenses(cleaned as Expense[]);
      if (res instanceof Map) expenseIds = res;
      (res === false ? refused : restored).push(slot);
      continue;
    }
    if (slot === 'myPlaces' && commitMyPlaces) {
      (commitMyPlaces(cleaned as MyPlace[]) === false ? refused : restored).push(slot);
      continue;
    }
    // docsChecklist's injected dual path (issue #295): a same-id UPSERT via `mergeItems`, not a
    // tombstone-replace — the fixed 18-id template has no add/remove path. Same idea as the
    // myPlaces branch above, one domain narrower.
    if (slot === 'docsChecklist' && commitDocsChecklist) {
      (commitDocsChecklist(cleaned as DocItem[]) === false ? refused : restored).push(slot);
      continue;
    }
    // Capture BEFORE the write: it reads the pre-restore local state as the push's `prev`. The
    // returned thunk only fires below, once `write` reports the local save actually landed
    // (issue #698) — a refused write (e.g. quota) must not queue a push that overwrites every
    // other member's copy with data this device never kept.
    const pushRestored = domainsBySlot[slot].enqueueRestore?.(cleaned);
    const ok = domainsBySlot[slot].write(cleaned);
    if (ok === false) {
      refused.push(slot); // refused local write: don't claim it, don't queue it (#698)
      continue;
    }
    pushRestored?.();
    restored.push(slot);
  }

  // Photos AFTER the domains, so receipt metas can follow their expense to its restored id.
  const repoint = (list: PhotoMeta[]) =>
    [...expenseIds].reduce((acc, [from, to]) => repointExpenseOwner(acc, from, to), list);
  if (hasMeta) {
    // #344: the meta rollback is a tombstone-replace (restore wins), so any LIVE meta id absent
    // from the restored set is being dropped here — without this, its blob orphans forever in the
    // app-scoped IndexedDB store (nothing else names it back to a trip to GC it later).
    const keptIds = new Set(metas.map((m) => m.id));
    const live = loadPhotos();
    if (savePhotos(repoint(metas))) {
      const orphaned = live.filter((m) => !keptIds.has(m.id));
      if (orphaned.length > 0) await deletePhotoBlobs(orphaned, blobStore);
      restored.push('photos');
    } else {
      // Index write refused: the live index still names its blobs, so keep every one of them.
      // Only the blobs put above that no live photo owns are strays — drop those.
      refused.push('photos');
      const liveIds = new Set(live.map((m) => m.id));
      const strays = metas.filter((m) => putIds.has(m.id) && !liveIds.has(m.id));
      if (strays.length > 0) await deletePhotoBlobs(strays, blobStore);
    }
  } else if (expenseIds.size > 0) {
    // Live photos are kept, so their receipts follow the restored expenses instead.
    if (!savePhotos(repoint(loadPhotos()))) refused.push('photos');
  }

  if (itinPlans !== null) {
    // dual path: restorePlans under sync, savePlans local
    (commitItinerary(itinPlans) === false ? refused : restored).push('itinerary');
  }

  // Content existed but every write was refused, so nothing changed on disk.
  if (restored.length === 0) return { ok: false, error: NOTHING_WRITTEN };

  return { ok: true, restored, photosSkipped, refused, dropped };
}
