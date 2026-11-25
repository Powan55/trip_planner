/**
 * Whole-trip backup and restore: one gzip file with every local domain of the active trip,
 * photos included, and the itinerary nested as its own Vault envelope. (export-import.ts stays
 * itinerary-only.) Photos only leave the device in a file the user downloads; export walks the
 * active trip's photo meta, so other trips' blobs can't ride along.
 *
 * Import never destroys:
 * - Phase A parses everything with zero writes. Unrecognized files are quarantined. A backup of
 *   a different trip is refused (for legacy files, by checking the dates). A malformed domain
 *   is dropped and its current data left alone.
 * - Phase B commits each domain; synced domains also go through the outbox so the next server
 *   snapshot doesn't undo the restore. Photo blobs are written before the meta index.
 * The caller reloads afterwards.
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
import { markJournalDirty } from '@/lib/journal-dirty';
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
 * Itinerary commit on import. Defaults to a local overwrite; under sync the UI injects the store's
 * `restorePlans` (tombstone-replace) so the restore propagates and survives the next snapshot.
 */
export type CommitItinerary = (plans: DayPlan[]) => boolean | void;

/** Same idea for myPlaces: tombstones rows added after the backup instead of merging them. */
export type CommitMyPlaces = (places: MyPlace[]) => boolean | void;

/**
 * docsChecklist is a fixed template, so its restore is a per-id upsert (newer stamp wins), not a
 * tombstone-replace. A row edited after the backup keeps its edit.
 */
export type CommitDocsChecklist = (items: DocItem[]) => boolean | void;

/** How the expenses domain is committed on import — same idea as `CommitMyPlaces`; the UI injects
 * `restoreExpenses` (tombstone-replace) under sync. Absent ⇒ generic bare write + merge. A returned
 * Map names the fresh id each backup expense got, so restored receipt photos follow (D-671). */
export type CommitExpenses = (expenses: Expense[]) => Map<string, string> | boolean | void;

/** The container's magic string — how import tells a full backup from a legacy itinerary-only export. */
export const BACKUP_FORMAT = 'nepal-japan-trip-backup';
/** Higher versions are refused on import. Only bump alongside a migration. Separate from the
 *  nested itinerary envelope's schemaVersion. */
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
 * Generic domains. `validate` returns null to drop a malformed domain. The top-level shape check
 * comes first so garbage is dropped rather than coerced to an empty default and wiping data.
 */
type DomainSpec = {
  read: () => unknown;
  /** `false` means the write was refused; `undefined` counts as success. */
  write: (cleaned: unknown) => boolean | void;
  validate: (parsed: unknown) => unknown | null;
  /** Synced domains only. Call before `write` (it captures the pre-restore state) and fire the
   * thunk only after `write` succeeds, so a refused local write never reaches other members. */
  enqueueRestore?: (cleaned: unknown) => () => boolean;
};

/**
 * A bare gateway write doesn't mark anything dirty, so the first snapshot after the reload would
 * overwrite the restored rows. Pushing through the domain's outbox-wrapped push marks the chunks
 * dirty first, so the snapshot merges instead.
 *
 * KNOWN CEILING: this is a merge, so rows the backup lacks survive. Budget is the one domain
 * still on this path; the others inject a restore-shaped commit.
 */
function enqueueRestored<T>(port: SyncPort<T>, storage: StoragePort<T>): (cleaned: unknown) => () => boolean {
  return (cleaned) => {
    const prev = storage.load(); // pre-restore state, captured before the caller's `write`
    return () => {
      if (port.push(prev, cleaned as T) !== false) return true;
      // The outbox could not record it, so the first snapshot after the reload would erase the
      // restore (#1045): put the old copy back and report it refused, as `commit` does (#982).
      return storage.save(prev) === false;
    };
  };
}

// Declared with `satisfies` rather than a `: Record<string, DomainSpec>` annotation so `keyof typeof
// DOMAINS` below stays the literal key union instead of widening to `string` — the annotation would
// make the exhaustiveness guard below vacuously true regardless of which keys actually exist.
const DOMAINS = {
  journal: {
    read: () => journalStore.get<unknown>(ABSENT),
    write: (v) => {
      const before = sanitizeEntries(journalStore.get<unknown>([])).map((e) => e.date);
      const ok = journalStore.set(v);
      // Re-stamp restored days so they win on other devices (D-596). Only if the write landed:
      // the push re-reads the local journal, and would otherwise push the old entry as newest.
      if (ok && isRemoteConfigured()) {
        // Union with the pre-restore dates: a day the backup dropped gets a tombstone (#857).
        const dates = [...new Set([...before, ...(v as JournalEntry[]).map((e) => e.date)])];
        dates.forEach(markJournalDirty);
        void import('@/lib/journal-remote').then(
          (m) => dates.forEach((d) => void m.pushJournalEntry(d)),
          (e) => {
            if (navigator.onLine !== false) throw e;
          },
        );
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
  // myPlacesStore comes from its own module; gateway.ts leaves it out for bundle size.
  myPlaces: {
    read: () => myPlacesStore.get<unknown>(ABSENT),
    write: (v) => myPlacesStore.set(v),
    validate: (v) => (Array.isArray(v) ? sanitizePlaces(v) : null),
    enqueueRestore: enqueueRestored(placesSyncPort, myPlacesStoragePort),
  },
} satisfies Record<string, DomainSpec>;

/**
 * Compile-time check that every TripScopedSlot is either backed up or deliberately excluded
 * (D-227: weather cache, outbox, quarantine slots). A new slot fails tsc here until it's handled.
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
    | 'journalSync'
    // key 53 — an unsaved editor draft, device-local like the concierge thread.
    | 'journalDraft'
    // D-725 — raw unreadable bytes, a quarantine slot like itineraryCorrupt.
    | 'localRescue'
    // D-790 — medical and contact details never leave the device, backup file included.
    | 'ice'
    // D-801 — values lost in a merge, ephemeral and device-local.
    | 'conflicts',
  ]
  ? true
  : never;
const _exhaustiveBackupDomains: _ExhaustiveBackupDomains = true;
void _exhaustiveBackupDomains;

// base64
/** Via FileReader: spreading bytes into String.fromCharCode overflows the stack on big photos. */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error ?? new Error('read failed'));
    fr.readAsDataURL(blob);
  });
}

/** Data URL to Blob, keeping the MIME type. Throws on a malformed URL; the caller skips it. */
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
 * Serialize the active trip into one gzip blob. Photos are inlined until the byte budget runs out;
 * the rest keep metadata only (restored as placeholders), so the file stays importable.
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
 * Download the backup. Can throw; the caller owns the error copy. Reports photos missing from
 * storage and photos left out for size.
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

/** A backup this many days old or older earns the "made on" warning in the restore confirm. */
export const STALE_BACKUP_DAYS = 7;

/** Age of a backup in whole days, or null if unreadable. Best-effort, only drives a warning. */
export async function backupAgeDays(file: Blob, now: number = Date.now()): Promise<number | null> {
  try {
    const parsed: unknown = JSON.parse(await decompressBlobOrText(file));
    if (!isTripBackup(parsed) || typeof parsed.exportedAt !== 'string') return null;
    const at = Date.parse(parsed.exportedAt);
    return Number.isNaN(at) ? null : Math.max(0, Math.floor((now - at) / 86_400_000));
  } catch {
    return null;
  }
}

/**
 * Restore a backup into the active trip. Unrecognized and legacy files go to the itinerary
 * importer only; unknown versions are refused; malformed domains are dropped and `restored` lists
 * what landed. Caller reloads on ok.
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

  // Legacy itinerary-only export (or garbage): parseBackup quarantines on failure.
  if (!isTripBackup(parsed)) {
    const pr = parseBackup(text);
    if (!pr.ok) return { ok: false, error: pr.error };
    if (synced) return UNMATCHED;
    // Legacy files have no trip id, so check the dates: at least one day must fall in the active
    // trip. An empty payload is refused too; committing it would wipe the trip (D-098).
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

  // Refuse a backup of a different trip; it would replace this one everywhere under sync.
  const env = parsed;

  // Checked before tripId: don't read fields of a format this build doesn't know. The copy says
  // "newer", not "corrupt", because that's what the user needs to act on.
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

  // Photos exist nowhere else, so malformed or empty meta is dropped rather than committed.
  const rawMeta = env.photos?.meta;
  // Any invalid row rejects the whole photo set (#912): the replace would delete that row's live
  // photo and its bytes, and the originals exist nowhere else.
  const metaOk = Array.isArray(rawMeta) && rawMeta.every((r) => sanitizePhotos([r]).length === 1);
  const metas = metaOk ? sanitizePhotos(rawMeta) : [];
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
  // Originals this import is about to overwrite, put back if the index write is refused (#913).
  const originals = new Map<string, Blob>();
  for (const [id, blob] of decoded) {
    const prev = await blobStore.get(id);
    if (prev) originals.set(id, prev);
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
    // Injected restore commits replace the generic write + merge. Only an explicit false is a refusal.
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
    // Before the write (captures prev); fired only if the write lands.
    const pushRestored = domainsBySlot[slot].enqueueRestore?.(cleaned);
    const ok = domainsBySlot[slot].write(cleaned);
    if (ok === false) {
      refused.push(slot); // refused local write: don't claim it, don't queue it (#698)
      continue;
    }
    if (pushRestored?.() === false) {
      refused.push(slot); // outbox refused the record; the thunk put the old copy back (#1045)
      continue;
    }
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
      for (const [id, blob] of originals) if (putIds.has(id)) await blobStore.putWithId(id, blob);
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
