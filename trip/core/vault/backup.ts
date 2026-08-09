/**
 * Full-trip backup / restore — the "lifeboat".
 *
 * whole-trip export/import is itinerary-ONLY by its own letter, and stays that way
 * (`export-import.ts` is untouched). THIS module is the wider "back up my WHOLE trip" that
 * "changes if the scope widens" clause names: one gzip file carrying every LOCAL user domain of the
 * ACTIVE trip — journal, photos (meta + blob bytes), expenses, budget, docs, packing, favorites,
 * day-anchors, share-inbox — plus the itinerary nested as its own existing versioned Vault envelope.
 *
 * PRIVACY: photos are device-local, zero-egress. They are included here ONLY in a file the
 * user explicitly downloads to their own device — never a network egress — and the UI copy
 * (`components/backup-restore.tsx`) states plainly that the backup contains journal AND photos, so a
 * user can never be surprised that a "backup" carried their photos. Export iterates the active trip's
 * photo META ids (NOT `blobStore.list()`), so another trip's blobs can never ride along.
 *
 * NEVER-DESTROY on import:
 * Phase A — parse the whole file into memory with ZERO writes. A non-JSON / unrecognized file is
 * quarantined (via the itinerary corrupt slot) and rejected. A malformed single domain is
 * DROPPED (its current on-disk data left untouched), never aborting the whole restore.
 * Phase B — commit each successfully-parsed domain via its existing accessor. Photo blobs are
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
} from '@/core/storage/gateway';
import { sanitizeEntries } from '@/core/journal/model';
import { sanitizeExpenses } from '@/core/budget/expenses';
import { normalizeModel } from '@/core/budget/model';
import { sanitizeItems as sanitizeDocs } from '@/core/docs/model';
import { sanitizeItems as sanitizePacking } from '@/core/packing/model';
import { sanitizeItems as sanitizeShare } from '@/core/share/model';
import { sanitizePhotos, type PhotoMeta } from '@/core/photos/model';
import { loadPhotos, savePhotos } from '@/core/photos/storage';
import { defaultBlobStore, type BlobStorePort } from '@/core/photos/blob-store';
import { compressToBlob, decompressBlobOrText, supportsCompression } from '@/core/vault/compression';
import { exportItinerary, parseBackup } from '@/core/vault/export-import';
import { savePlans } from '@/lib/itinerary-storage';
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
export type CommitItinerary = (plans: DayPlan[]) => void;

/** The container's magic string — how import tells a full backup from a legacy itinerary-only export. */
export const BACKUP_FORMAT = 'nepal-japan-trip-backup';
export const BACKUP_VERSION = 1;

/** On-disk envelope. `domains` holds each domain's raw JSON value (itinerary nests its Vault envelope);
 * `photos.blobs` maps each meta id → a base64 DATA URL (self-describing MIME, decoded with one line —
 * a superset of "base64" that also round-trips the image type). */
export interface TripBackup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  tripId: string;
  domains: Record<string, unknown>;
  photos: { meta: PhotoMeta[]; blobs: Record<string, string> };
}

export type ImportBackupResult =
  | { ok: true; restored: string[]; photosSkipped: number }
  | { ok: false; error: string };

/** Sentinel telling an absent/corrupt slot from a legitimately-stored value on export (see below). */
const ABSENT = Symbol('absent');

/** True for a plain (non-array, non-null) object — the shape gate for object-valued domains. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * The eight generic (non-itinerary, non-photo) domains. Each entry knows how to READ its raw value for
 * export, WRITE a cleaned value on import, and VALIDATE an imported value — returning `null` to DROP a
 * malformed domain (never-destroy: a drop leaves the live on-disk data untouched). The validate gate is
 * a TOP-LEVEL shape check (array vs object) followed by the domain's own existing sanitizer; the shape
 * check is what turns "garbage that would coerce to an empty default" into a drop instead of a wipe.
 */
type DomainSpec = {
  read: () => unknown;
  write: (cleaned: unknown) => void;
  validate: (parsed: unknown) => unknown | null;
};

const DOMAINS: Record<string, DomainSpec> = {
  journal: {
    read: () => journalStore.get<unknown>(ABSENT),
    write: (v) => journalStore.set(v),
    validate: (v) => (Array.isArray(v) ? sanitizeEntries(v) : null),
  },
  expenses: {
    read: () => expensesStore.get<unknown>(ABSENT),
    write: (v) => expensesStore.set(v),
    validate: (v) => (Array.isArray(v) ? sanitizeExpenses(v) : null),
  },
  budget: {
    read: () => budgetStore.get<unknown>(ABSENT),
    write: (v) => budgetStore.set(v),
    validate: (v) => (isPlainObject(v) ? normalizeModel(v) : null),
  },
  docsChecklist: {
    read: () => docsStore.get<unknown>(ABSENT),
    write: (v) => docsStore.set(v),
    // fallback=[] so an imported empty/garbage array does NOT inject the built-in template here;
    // the docs store re-seeds its template on the next read if the slot ends up empty.
    validate: (v) => (Array.isArray(v) ? sanitizeDocs(v, []) : null),
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
};

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
/**
 * Serialize the ACTIVE trip's every in-scope local domain into one gzip blob (the existing
 * `compressToBlob` pipeline — no new dep, plain-JSON fallback where CompressionStream is absent).
 * `blobStore` is injectable for tests; production uses the native IndexedDB store.
 */
export async function exportTripBackup(blobStore: BlobStorePort = defaultBlobStore): Promise<Blob> {
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
  for (const m of meta) {
    const blob = await blobStore.get(m.id);
    if (blob) blobs[m.id] = await blobToDataUrl(blob);
  }

  const envelope: TripBackup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    tripId: getActiveTripId(),
    domains,
    photos: { meta, blobs },
  };
  return compressToBlob(JSON.stringify(envelope));
}

/**
 * Download the active trip's whole-trip backup as a file ( Ruling 2 — a PURE LIFT of
 * `backup-restore.tsx`'s prior `handleExport`, verbatim: same `exportTripBackup()` call, same
 * `supportsCompression() ?.gz:.json` filename choice, same `createObjectURL` → `<a download>` →
 * `click()` → `revokeObjectURL` dance). Exists so a second caller (the sign-out confirm dialog's
 * backup offer) can reuse it without duplicating those lines.
 *
 * Can THROW (e.g. a `FileReader` failure reading a stored photo, or an unguarded
 * `CompressionStream` failure in `core/vault/compression.ts`) — the CALLER owns try/catch and any
 * user-facing error copy, exactly as `backup-restore.tsx` did before this was lifted out. Returns
 * the filename used, so a caller can build its own success message without recomputing
 * `supportsCompression()` itself.
 */
export async function downloadTripBackup(blobStore: BlobStorePort = defaultBlobStore): Promise<string> {
  const blob = await exportTripBackup(blobStore);
  const filename = supportsCompression() ? EXPORT_FILENAME_GZ : EXPORT_FILENAME;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return filename;
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
 * - a recognized full backup restores every WELL-FORMED domain and drops any malformed one.
 * The caller reloads on `ok:true` to re-hydrate the stores. `blobStore` is injectable for tests.
 */
export async function importTripBackup(
  file: Blob,
  blobStore: BlobStorePort = defaultBlobStore,
  commitItinerary: CommitItinerary = savePlans,
): Promise<ImportBackupResult> {
  let text: string;
  try {
    text = await decompressBlobOrText(file);
  } catch {
    return { ok: false, error: 'Could not read that backup file. No changes were made to your trip.' };
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
    commitItinerary(pr.plans);
    return { ok: true, restored: ['itinerary'], photosSkipped: 0 };
  }

  // ── Phase A — parse everything into memory, ZERO domain writes ──
  const env = parsed;
  const domainWrites: Array<[string, unknown]> = [];
  for (const [slot, spec] of Object.entries(DOMAINS)) {
    if (!(slot in env.domains)) continue;
    const cleaned = spec.validate(env.domains[slot]);
    if (cleaned !== null) domainWrites.push([slot, cleaned]); // else: malformed → drop (never-destroy)
  }

  // Itinerary — validate the nested envelope through the SAME trust boundary (parseBackup); a
  // malformed itinerary is dropped (parseBackup has already quarantined it) and the live one survives.
  let itinPlans: DayPlan[] | null = null;
  if ('itinerary' in env.domains) {
    const pr = parseBackup(JSON.stringify(env.domains.itinerary));
    if (pr.ok) itinPlans = pr.plans;
  }

  // Photos — sanitize meta, decode each present blob.
  const metas = sanitizePhotos(env.photos?.meta);
  const decoded: Array<[string, Blob]> = [];
  for (const m of metas) {
    const dataUrl = env.photos?.blobs?.[m.id];
    if (typeof dataUrl === 'string') {
      try {
        decoded.push([m.id, dataUrlToBlob(dataUrl)]);
      } catch {
        /* malformed data URL → this photo becomes a placeholder (meta kept, blob absent) */
      }
    }
  }

  // ── Phase B — commit ──
  const restored: string[] = [];
  let photosSkipped = 0;

  // Blobs FIRST (id-preserving), so a re-import doesn't duplicate and meta↔blob links hold.
  for (const [id, blob] of decoded) {
    const res = await blobStore.putWithId(id, blob);
    if (!res.ok) photosSkipped++; // stored blob failed → meta stays as a placeholder
  }
  // Any meta whose blob was never provided at all is also a placeholder.
  photosSkipped += metas.filter((m) => env.photos?.blobs?.[m.id] === undefined).length;

  if (env.photos && 'meta' in env.photos) {
    savePhotos(metas);
    if (metas.length > 0) restored.push('photos');
  }

  for (const [slot, cleaned] of domainWrites) {
    DOMAINS[slot].write(cleaned);
    restored.push(slot);
  }

  if (itinPlans !== null) {
    commitItinerary(itinPlans); // dual path: restorePlans under sync, savePlans local
    restored.push('itinerary');
  }

  return { ok: true, restored, photosSkipped };
}
