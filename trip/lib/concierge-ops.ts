// Concierge agent ops — the CLIENT half of the `{reply, ops[]}` contract.
//
// The Worker emits a `{reply, ops}` envelope where each op is a FLAT, nullable-superset
// object. This module owns the two client-side responsibilities the Worker can't:
// - `validateOps` — STATE-validity: run against the LIVE itinerary and reject-and-DROP any
// op that fails one of the 8 rules, SILENTLY (never surface a raw validation error; one bad op
// must not nuke a good reply). Pure over `(rawOps, livePlans)` → the surviving `Op[]`.
// - `applyOp` — EXECUTION: turn one confirmed op into the matching `useItinerary()` CRUD
// call (addItem MINTS a fresh id — never trust an agent-supplied id) and return the undo
// message + pre-state restore fn for `showUndoToast`. Nothing here mutates until a caller
// invokes it on an explicit user confirm (proposals-only, the load-bearing safety property).
//
// nothing is logged here (no ops, no reply, no context).

import type { DayPlan, ItineraryCategory, ItineraryItem } from '@/lib/trip-data';
import { TRIP_DATES, formatDate, formatTimeAmPm } from '@/core/dates';
import type { ItineraryStore } from '@/hooks/use-itinerary';
import { generateItemId } from '@/lib/item-id';

export type OpType = 'addItem' | 'updateItem' | 'removeItem' | 'moveItem';

/**
 * The wire shape of one op: a SINGLE FLAT object — a `type` enum plus the
 * nullable-superset of every field any verb uses. Everything past `type` is optional here
 * because the Worker sends every property (with `null` for the ones a given verb doesn't use);
 * `validateOps` enforces per-type presence + typing. Kept as a plain interface so it renders to
 * both provider dialects on the Worker side and validates cheaply here.
 */
export interface Op {
  type: OpType;
  itemId?: string | null;
  date?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  title?: string | null;
  category?: string | null;
  notes?: string | null;
  location?: string | null;
  startMinutes?: number | null;
  durationMinutes?: number | null;
}

// The category 10-set. Duplicated as literals from `ItineraryCategory`
// (lib/trip-data.ts) — the source of truth — because a Set membership check is what validation
// needs; a `satisfies` tie keeps the two from drifting silently.
const CATEGORIES = [
  'sightseeing',
  'food',
  'photography',
  'shopping',
  'nature',
  'cultural',
  'transportation',
  'hotel',
  'free',
  'nightlife',
] as const satisfies readonly ItineraryCategory[];
const CATEGORY_SET: ReadonlySet<string> = new Set(CATEGORIES);

// Content fields a patch/add can carry (everything except the addressing fields).
const CONTENT_KEYS = ['title', 'category', 'notes', 'location', 'startMinutes', 'durationMinutes'] as const;

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const isTripDate = (v: unknown): v is string => typeof v === 'string' && TRIP_DATES.includes(v);
const isCategory = (v: unknown): v is ItineraryCategory =>
  typeof v === 'string' && CATEGORY_SET.has(v);

/** A LIVE (non-tombstoned) item on `date`, or undefined. `plans` is the exposed/tombstone-filtered
 * selector (`useItinerary().plans`), but we re-guard `deleted` defensively so a raw list is safe. */
function liveItem(plans: DayPlan[], date: string, itemId: string): ItineraryItem | undefined {
  return plans.find((d) => d.date === date)?.items.find((i) => i.id === itemId && i.deleted !== true);
}

// shared range guard — applies whenever the field is present + non-null, for any verb.
function timeFieldsValid(o: Record<string, unknown>): boolean {
  if (o.startMinutes != null) {
    if (!Number.isInteger(o.startMinutes) || (o.startMinutes as number) < 0 || (o.startMinutes as number) > 1439) {
      return false;
    }
  }
  if (o.durationMinutes != null) {
    if (!Number.isInteger(o.durationMinutes) || (o.durationMinutes as number) <= 0) return false;
  }
  return true;
}

/**
 * — validate a single raw op against the LIVE itinerary. Returns true only if EVERY applicable
 * rule holds; any failure = drop (the caller filters). No throw, no log.
 */
function isValidOp(raw: unknown, plans: DayPlan[]): raw is Op {
  if (!raw || typeof raw !== 'object') return false;
  const o = raw as Record<string, unknown>;

  // Rule 2 — type ∈ the four verbs.
  const type = o.type;
  if (type !== 'addItem' && type !== 'updateItem' && type !== 'removeItem' && type !== 'moveItem') {
    return false;
  }
  // Rule 7 — startMinutes/durationMinutes ranges (any verb that carries them).
  if (!timeFieldsValid(o)) return false;

  switch (type) {
    case 'addItem':
      // Rule 3 (add: date,title,category) + Rule 4 (date ∈ TRIP_DATES) + Rule 5 (category ∈ set).
      return isTripDate(o.date) && isNonEmptyString(o.title) && isCategory(o.category);

    case 'updateItem': {
      // Rule 3 (itemId,date,≥1 patch) + Rule 4 + Rule 6 (target exists) + Rule 8 (≥1 non-null patch).
      if (!isNonEmptyString(o.itemId) || !isTripDate(o.date)) return false;
      // Any present patch field must be well-typed; collect whether ≥1 valid patch exists (Rule 8).
      let patchCount = 0;
      for (const k of CONTENT_KEYS) {
        if (o[k] == null) continue;
        if (k === 'title' && !isNonEmptyString(o[k])) return false;
        if (k === 'category' && !isCategory(o[k])) return false; // Rule 5
        if ((k === 'notes' || k === 'location') && typeof o[k] !== 'string') return false;
        // startMinutes/durationMinutes already range-checked by timeFieldsValid.
        patchCount += 1;
      }
      if (patchCount === 0) return false; // Rule 8
      return liveItem(plans, o.date, o.itemId) !== undefined; // Rule 6
    }

    case 'removeItem':
      // Rule 3 (itemId,date) + Rule 4 + Rule 6.
      if (!isNonEmptyString(o.itemId) || !isTripDate(o.date)) return false;
      return liveItem(plans, o.date, o.itemId) !== undefined;

    case 'moveItem':
      // Rule 3 (itemId,fromDate,toDate) + Rule 4 (both dates) + Rule 6 (exists on fromDate).
      // toDate ≠ fromDate.
      if (!isNonEmptyString(o.itemId) || !isTripDate(o.fromDate) || !isTripDate(o.toDate)) return false;
      if (o.fromDate === o.toDate) return false;
      return liveItem(plans, o.fromDate as string, o.itemId) !== undefined;
  }
}

/**
 * — filter raw ops (whatever the Worker sent) to the ones valid against `livePlans`. Rule 1:
 * a non-array (or absent) `ops` yields `[]` (pure chat). Order preserved; invalid ops dropped
 * silently. Run this at CHIP-RENDER time against the live plans so a chip never shows for an op
 * that has gone stale (e.g. its target was deleted after the reply arrived).
 */
export function validateOps(rawOps: unknown, livePlans: DayPlan[]): Op[] {
  if (!Array.isArray(rawOps)) return [];
  return rawOps.filter((op): op is Op => isValidOp(op, livePlans));
}

/** Non-null content patch derived from an op (for updateItem / addItem construction). */
function contentPatch(op: Op): Partial<ItineraryItem> {
  const patch: Partial<ItineraryItem> = {};
  if (op.title != null) patch.title = op.title;
  if (op.category != null) patch.category = op.category as ItineraryCategory;
  if (op.notes != null) patch.notes = op.notes;
  if (op.location != null) patch.location = op.location;
  if (op.startMinutes != null) patch.startMinutes = op.startMinutes;
  if (op.durationMinutes != null) patch.durationMinutes = op.durationMinutes;
  return patch;
}

/**
 * A human-readable chip label for a proposal. update/remove/move resolve the target's live title
 * from `plans` (the op only carries an id); addItem uses its own title. Time (if any) is shown as
 * a 12h clock label via the shared `formatTimeAmPm`.
 */
export function describeOp(op: Op, plans: DayPlan[]): string {
  const timeSuffix = op.startMinutes != null ? ` · ${formatTimeAmPm(op.startMinutes)}` : '';
  switch (op.type) {
    case 'addItem':
      return `Add “${op.title}” to ${formatDate(op.date as string)}${timeSuffix}`;
    case 'updateItem': {
      const title = liveItem(plans, op.date as string, op.itemId as string)?.title ?? 'item';
      return `Update “${title}” on ${formatDate(op.date as string)}${timeSuffix}`;
    }
    case 'removeItem': {
      const title = liveItem(plans, op.date as string, op.itemId as string)?.title ?? 'item';
      return `Remove “${title}” from ${formatDate(op.date as string)}`;
    }
    case 'moveItem': {
      const title = liveItem(plans, op.fromDate as string, op.itemId as string)?.title ?? 'item';
      return `Move “${title}” to ${formatDate(op.toDate as string)}`;
    }
  }
}

/**
 * — EXECUTE one (already-validated) op through `useItinerary()` and return the undo message +
 * a restore fn capturing PRE-STATE at apply time. The caller feeds these to `showUndoToast`.
 * addItem MINTS a fresh id (`generateItemId`) — the agent NEVER supplies a new-item id.
 * Routing through the store earns attribution + rev/hlc sync stamping for free.
 *
 * ASSUMES the op passed `validateOps` against `plans` — required fields are present, the target
 * exists, dates are in range. (The component only ever calls this on a chip built from validated ops.)
 */
export function applyOp(
  op: Op,
  store: Pick<ItineraryStore, 'addItem' | 'updateItem' | 'removeItem' | 'moveItem' | 'restoreItem'>,
  plans: DayPlan[],
): { message: string; undo: () => void } {
  switch (op.type) {
    case 'addItem': {
      const date = op.date as string;
      const item: ItineraryItem = {
        id: generateItemId(), // MINT — never trust an agent-supplied id for a new item
        title: op.title as string,
        category: op.category as ItineraryCategory,
        ...contentPatch(op),
      };
      // contentPatch re-sets title/category (harmless — same values) plus any time/notes/location.
      store.addItem(date, item);
      return { message: `Added “${item.title}”`, undo: () => store.removeItem(date, item.id) };
    }
    case 'updateItem': {
      const date = op.date as string;
      const itemId = op.itemId as string;
      const prev = liveItem(plans, date, itemId);
      const patch = contentPatch(op);
      // Capture the PRIOR value of exactly the patched keys so undo restores them (including
      // undefined → back to untimed/cleared). prev is guaranteed present.
      const prevPatch: Partial<ItineraryItem> = {};
      for (const k of Object.keys(patch) as (keyof ItineraryItem)[]) {
        (prevPatch as Record<string, unknown>)[k] = prev ? prev[k] : undefined;
      }
      store.updateItem(date, itemId, patch);
      return {
        message: `Updated “${prev?.title ?? 'item'}”`,
        undo: () => store.updateItem(date, itemId, prevPatch),
      };
    }
    case 'removeItem': {
      const date = op.date as string;
      const itemId = op.itemId as string;
      const prev = liveItem(plans, date, itemId); // capture full item BEFORE removing (undo restores it)
      store.removeItem(date, itemId);
      return {
        message: `Removed “${prev?.title ?? 'item'}”`,
        undo: () => {
          if (prev) store.restoreItem(date, prev);
        },
      };
    }
    case 'moveItem': {
      const fromDate = op.fromDate as string;
      const toDate = op.toDate as string;
      const itemId = op.itemId as string;
      const prev = liveItem(plans, fromDate, itemId);
      store.moveItem(itemId, fromDate, toDate);
      // ponytail: undo moves back by the ORIGINAL id — correct in the dormant/default build where
      // moveItem preserves the id. Under sync moveItem mints a fresh target id, so an inverse by the
      // original id no-ops (the toast shows but does nothing). Fix when needed: have moveItem return
      // the minted target id and invert against that. The shipped/portfolio build is dormant.
      return {
        message: `Moved “${prev?.title ?? 'item'}”`,
        undo: () => store.moveItem(itemId, toDate, fromDate),
      };
    }
  }
}
