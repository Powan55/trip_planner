/**
 * Share-inbox domain — the pure, framework-free triage-item core. Gateway key 23
 * stores a `ShareItem[]` (`nepal_japan_share_inbox`).
 *
 * FRAMEWORK-FREE: plain TypeScript — no
 * React, no window, no storage. Every function is TOTAL (a bad/missing/corrupt input degrades to
 * a safe value, never a throw). `id` generation + `receivedAt` timestamping are I/O concerns and
 * stay in the domain hook (`hooks/use-share.ts`), NOT here — this module only shapes, sanitizes,
 * and transforms already-materialized items.
 *
 * Parse-don't-validate: `shareItemSchema` is the ONE read-boundary
 * schema. It is deliberately LENIENT: every content field is optional and unknown
 * keys pass through, so a share from a future build is never dropped wholesale. `sanitizeItem`
 * then narrows a parsed value to a clean `ShareItem`, dropping an out-of-trip `day` (bounds via
 * `core/dates` `TRIP_DATES`) rather than rejecting the whole item.
 *
 * EMPTY STATE by design (unlike packing's fixed template): a fresh visitor has an empty inbox —
 * items only ever arrive from the OS share sheet. Cap at 100 (`SHARE_CAP`), drop-oldest on
 * overflow, so the gateway value can never grow unbounded. Items are held NEWEST-FIRST.
 */

import { z } from 'zod';
import { TRIP_DATES } from '@/core/dates';

/** Hard cap on stored inbox items; overflow drops the oldest. */
export const SHARE_CAP = 100;

export interface ShareItem {
  id: string;
  title?: string;
  text?: string;
  url?: string;
  /** ISO-8601 instant the item was received (set by the hook at add time). */
  receivedAt: string;
  /** Assigned trip day (`YYYY-MM-DD`), always within `TRIP_DATES`; absent = unassigned. */
  day?: string;
}

/**
 * Lenient read-boundary schema: required `id` + `receivedAt`, everything else optional,
 * unknown keys pass through. A value that fails even this is genuinely corrupt → dropped by
 * `sanitizeItem`.
 */
const shareItemSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().optional(),
    text: z.string().optional(),
    url: z.string().optional(),
    receivedAt: z.string().min(1),
    day: z.string().optional(),
  })
  .passthrough();

/** True iff `day` is a real trip day (`core/dates` `TRIP_DATES` — Dec 9 … Jan 9). TOTAL. */
export function isTripDay(day: unknown): day is string {
  return typeof day === 'string' && TRIP_DATES.includes(day);
}

/** A non-empty trimmed string, or `undefined`. Keeps blank/whitespace content out of storage. */
function cleanStr(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}

/**
 * Narrow an unknown (a parsed-from-storage slot entry, or a freshly-built item) into a clean
 * `ShareItem`, or `null` when too malformed to salvage: no id, no receivedAt, or NO content at all
 * (an item with neither title, text, nor url is noise). An out-of-trip `day` is DROPPED (the item
 * survives as unassigned) rather than rejecting the whole item. TOTAL — never throws.
 */
export function sanitizeItem(value: unknown): ShareItem | null {
  const parsed = shareItemSchema.safeParse(value);
  if (!parsed.success) return null;
  const v = parsed.data;
  const id = v.id.trim();
  const receivedAt = v.receivedAt.trim();
  if (id === '' || receivedAt === '') return null;

  const title = cleanStr(v.title);
  const text = cleanStr(v.text);
  const url = cleanStr(v.url);
  if (title === undefined && text === undefined && url === undefined) return null;

  const item: ShareItem = { id, receivedAt };
  if (title !== undefined) item.title = title;
  if (text !== undefined) item.text = text;
  if (url !== undefined) item.url = url;
  if (isTripDay(v.day)) item.day = v.day;
  return item;
}

/**
 * Normalize an unknown (a parsed storage slot) into a valid `ShareItem[]`, deduped by id (FIRST
 * write wins — the array is newest-first, so the first occurrence is the most recent), preserving
 * order, and capped to the newest `SHARE_CAP`. Returns `[]` for a non-array / all-corrupt input
 * (the empty inbox is the honest first-load state). TOTAL — never throws.
 */
export function sanitizeItems(value: unknown): ShareItem[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, ShareItem>();
  for (const raw of value) {
    const item = sanitizeItem(raw);
    if (item !== null && !byId.has(item.id)) byId.set(item.id, item);
  }
  return Array.from(byId.values()).slice(0, SHARE_CAP);
}

/**
 * Prepend a new item (newest-first), dropping any prior item with the same id, then cap to the
 * newest `SHARE_CAP` (drop-oldest). Returns a NEW array. TOTAL.
 */
export function addShareItem(list: readonly ShareItem[], item: ShareItem): ShareItem[] {
  const base = Array.isArray(list) ? list : [];
  return [item, ...base.filter((i) => i.id !== item.id)].slice(0, SHARE_CAP);
}

/** Remove the item with `id`. Returns a NEW array; a non-matching id is a no-op. TOTAL. */
export function removeShareItem(list: readonly ShareItem[], id: string): ShareItem[] {
  const base = Array.isArray(list) ? list : [];
  return base.filter((i) => i.id !== id);
}

/**
 * Assign (or clear) the trip day for `id`. An out-of-bounds `day` clears the assignment (defensive
 * — the UI only offers valid options, but a bad value must never persist). Returns a NEW array; a
 * non-matching id is a no-op. TOTAL.
 */
export function assignDay(list: readonly ShareItem[], id: string, day: string | undefined): ShareItem[] {
  const base = Array.isArray(list) ? list : [];
  const next = isTripDay(day) ? day : undefined;
  return base.map((i) => {
    if (i.id !== id) return i;
    const { day: _drop, ...rest } = i;
    return next === undefined ? rest : { ...rest, day: next };
  });
}
