/**
 * Photo metadata domain — the pure, framework-free `PhotoMeta` core.
 * Gateway key 16 stores a `PhotoMeta[]`; the blob BYTES live only in IndexedDB behind
 * `BlobStorePort` (`core/photos/blob-store.ts`) — this module knows nothing about bytes, storage,
 * React, or the network. Mirrors `core/journal/model.ts` / `core/budget/expenses.ts` exactly (TOTAL,
 * never-throw, pure).
 *
 * THE LINK LIVES HERE, NOWHERE ELSE: a photo's owner (a journal DAY or an expense id) is an
 * `owner` ref ON the `PhotoMeta`, never a field on the `JournalEntry`/`Expense` row. That keeps every
 * synced/Vault schema free of photo data by construction — the zero-egress guarantee is structural.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Who a photo belongs to. Journal photos are DAY-keyed (not entry-keyed) so recap is a
 * pure `owner.date` filter; expense photos are keyed by the `Expense.id` on THIS device. */
export type PhotoOwner =
  | { kind: 'journal'; date: string }
  | { kind: 'expense'; expenseId: string };

/** A single stored photo's metadata (the blob itself lives in IndexedDB, keyed by `id`). */
export interface PhotoMeta {
  /** The `BlobStorePort` id ('ph-…') — also the IndexedDB key of the blob bytes. */
  id: string;
  owner: PhotoOwner;
  /** a11y alt text — prompted (required) at capture; degrades to `caption` then '' on a corrupt slot. */
  altText: string;
  /** Optional user caption. */
  caption?: string;
  /** Stored (post-downscale) pixel dimensions. */
  w: number;
  h: number;
  /** Stored blob size in bytes (feeds the usage UI without opening IndexedDB). */
  bytes: number;
  /** ISO create timestamp — injected by the caller (keeps the core deterministic). */
  createdAt: string;
}

/** True iff `v` is a salvageable `PhotoOwner`. Total. */
export function isPhotoOwner(v: unknown): v is PhotoOwner {
  if (v === null || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (o.kind === 'journal') return typeof o.date === 'string' && DATE_RE.test(o.date);
  if (o.kind === 'expense') return typeof o.expenseId === 'string' && o.expenseId.length > 0;
  return false;
}

/** A non-negative finite number, or 0. Total. */
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

/**
 * Coerce any parsed-from-storage value into a valid `PhotoMeta`, or `null` when too malformed to
 * salvage. IDENTITY is required (a valid `id` + a valid `owner` have no safe default → drop);
 * everything else is repairable: `altText` degrades to `caption ?? ''`, `w`/`h`/`bytes` to 0,
 * `createdAt` to ''. TOTAL — never throws. Mirrors `sanitizeExpense`.
 */
export function sanitizePhoto(value: unknown): PhotoMeta | null {
  if (value === null || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;

  if (typeof v.id !== 'string' || v.id.length === 0) return null;
  if (!isPhotoOwner(v.owner)) return null;

  const caption =
    typeof v.caption === 'string' && v.caption.trim().length > 0 ? v.caption.trim() : undefined;
  const altText =
    typeof v.altText === 'string' && v.altText.trim().length > 0 ? v.altText.trim() : (caption ?? '');

  const meta: PhotoMeta = {
    id: v.id,
    owner: v.owner,
    altText,
    w: num(v.w),
    h: num(v.h),
    bytes: num(v.bytes),
    createdAt: typeof v.createdAt === 'string' ? v.createdAt : '',
  };
  if (caption !== undefined) meta.caption = caption;
  return meta;
}

/**
 * Normalize an unknown (a parsed storage slot) into a valid `PhotoMeta[]`: drop non-arrays, drop each
 * row `sanitizePhoto` cannot salvage, and DEDUPE by `id` (last write wins). TOTAL — never throws.
 */
export function sanitizePhotos(value: unknown): PhotoMeta[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, PhotoMeta>();
  for (const raw of value) {
    const p = sanitizePhoto(raw);
    if (p !== null) byId.set(p.id, p);
  }
  return Array.from(byId.values());
}

/** True iff two owners refer to the same subject. Total. */
export function sameOwner(a: PhotoOwner, b: PhotoOwner): boolean {
  if (a.kind === 'journal' && b.kind === 'journal') return a.date === b.date;
  if (a.kind === 'expense' && b.kind === 'expense') return a.expenseId === b.expenseId;
  return false;
}

/** The photos belonging to `owner`, in stored order. Pure. */
export function photosForOwner(photos: readonly PhotoMeta[], owner: PhotoOwner): PhotoMeta[] {
  if (!Array.isArray(photos)) return [];
  return photos.filter((p) => sameOwner(p.owner, owner));
}

/** Append a photo's meta (returns a NEW array). Pure. */
export function addPhotoMeta(photos: readonly PhotoMeta[], meta: PhotoMeta): PhotoMeta[] {
  return [...(Array.isArray(photos) ? photos : []), meta];
}

/** Remove the meta for `id` (returns a NEW array; non-matching id is a no-op). Pure. */
export function removePhotoMeta(photos: readonly PhotoMeta[], id: string): PhotoMeta[] {
  const list = Array.isArray(photos) ? photos : [];
  return list.filter((p) => p.id !== id);
}

/**
 * Re-point every expense-owned photo from `oldId` to `newId` (returns a NEW array). Used by the
 * sync-on expense Undo: `restoreExpense` re-adds as a FRESH-ID copy, so the receipt meta must
 * follow the new id or it strands. A no-op when `oldId === newId` (dormant restore keeps the same id).
 * Pure — a purely local key-16 rewrite, nowhere near the sync path.
 */
export function repointExpenseOwner(
  photos: readonly PhotoMeta[],
  oldId: string,
  newId: string,
): PhotoMeta[] {
  const list = Array.isArray(photos) ? photos : [];
  if (oldId === newId) return [...list];
  return list.map((p) =>
    p.owner.kind === 'expense' && p.owner.expenseId === oldId
      ? { ...p, owner: { kind: 'expense', expenseId: newId } }
      : p,
  );
}
