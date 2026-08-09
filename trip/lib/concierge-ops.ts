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
import { formatDurationText } from '@/lib/time-picker-format';

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
// (lib/itinerary-category.ts, re-exported via lib/trip-data.ts) — the source of truth — because a
// Set membership check is what validation needs.
//
// `as const satisfies readonly ItineraryCategory[]` below only catches an INVALID member of this
// list; it is silent when a category is instead ADDED to `ItineraryCategory` and NOT to this list
// — the direction this function (dropping ops for unknown categories) actually depends on. That
// used to be "guarded" by a comment claiming a `satisfies` tie kept the two from drifting; it did
// not, and is the rule this file now carries: a comment naming a mechanism is only as good
// as a check that actually runs. The `Exclude` guard right after the array is that check.
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
// Fails to compile — naming the offending category in the error — if `ItineraryCategory` gains a
// member absent from `CATEGORIES` (the direction the `satisfies` above misses).
type _MissingFromCategories = Exclude<ItineraryCategory, (typeof CATEGORIES)[number]>;
const _assertNoMissingCategories: _MissingFromCategories extends never ? true : _MissingFromCategories = true;
const CATEGORY_SET: ReadonlySet<string> = new Set(CATEGORIES);

// Content fields a patch/add can carry (everything except the addressing fields).
const CONTENT_KEYS = ['title', 'category', 'notes', 'location', 'startMinutes', 'durationMinutes'] as const;

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const isTripDate = (v: unknown): v is string => typeof v === 'string' && TRIP_DATES.includes(v);
const isCategory = (v: unknown): v is ItineraryCategory =>
  typeof v === 'string' && CATEGORY_SET.has(v);

/**
 * The LIVE (non-tombstoned) item with `itemId` ANYWHERE in `plans`, plus the date it actually sits
 * on — the single target resolver for update/remove/move.
 *
 * GLOBAL BY ID, not (date,id): item ids are globally unique — `generateItemId()` mints a uuid and
 * the merge invariant keeps a given id in exactly ONE `DayPlan.items[]` (multi-day items are
 * a render-time span, never multi-homed). Requiring the model to also restate the item's CURRENT
 * date was therefore a pure liability: it dropped otherwise-perfect ops whenever the model echoed a
 * wrong-year/non-ISO date or put the NEW date on an updateItem. The op's `date`
 * is now a hint only. `deleted` is re-guarded defensively so a raw (unfiltered) list is safe.
 */
function resolveLive(plans: DayPlan[], itemId: string): { date: string; item: ItineraryItem } | undefined {
  for (const day of plans) {
    const item = day.items.find((i) => i.id === itemId && i.deleted !== true);
    if (item) return { date: day.date, item };
  }
  return undefined;
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
      // Rule 3 (itemId + ≥1 patch) + Rule 6 (target resolves by id) + Rule 8 (≥1 non-null patch).
      // No Rule 4 date check: the target's date comes from the ITINERARY, not from the op.
      if (!isNonEmptyString(o.itemId)) return false;
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
      return resolveLive(plans, o.itemId) !== undefined; // Rule 6
    }

    case 'removeItem':
      // Rule 3 (itemId) + Rule 6.
      if (!isNonEmptyString(o.itemId)) return false;
      return resolveLive(plans, o.itemId) !== undefined;

    case 'moveItem': {
      // Rule 3 (itemId,toDate) + Rule 4 (toDate — a REAL new date, so it must be a trip date) +
      // Rule 6 (target resolves). `fromDate` is a hint;'s toDate ≠ fromDate is enforced
      // against the item's RESOLVED current day, which is the day the move would actually leave.
      if (!isNonEmptyString(o.itemId) || !isTripDate(o.toDate)) return false;
      const found = resolveLive(plans, o.itemId);
      return found !== undefined && found.date !== o.toDate;
    }
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
 *-B — a short, human summary of WHAT an updateItem actually changes, derived from the SAME
 * `contentPatch(op)` that `applyOp` writes. Reusing that one extraction (rather than re-reading the
 * op's fields here) is the point: the chip can never name a field the Confirm won't write, or stay
 * silent about one it will.
 *
 * The label it replaces — `Update “X” on <date>` — asked the traveller to approve a mutation whose
 * content was invisible. Capped at two named changes plus a count, so a wide patch summarises
 * instead of dumping six clauses into a chip.
 */
function describePatch(patch: Partial<ItineraryItem>): string {
  const phrases = (Object.keys(patch) as (keyof ItineraryItem)[]).map((key) => {
    const value = patch[key];
    switch (key) {
      case 'title':
        return `rename to “${value}”`;
      case 'category':
        return `set category to ${value}`;
      case 'notes':
        return value === '' ? 'clear notes' : 'set notes';
      case 'location':
        return value === '' ? 'clear location' : `set location to “${value}”`;
      case 'startMinutes':
        return `set time to ${formatTimeAmPm(value as number)}`;
      case 'durationMinutes':
        return `set duration to ${formatDurationText(value as number)}`;
      default:
        return String(key);
    }
  });
  if (phrases.length === 0) return '';
  const shown = phrases.slice(0, 2).join(', ');
  return phrases.length > 2 ? `${shown} + ${phrases.length - 2} more` : shown;
}

/**
 * A human-readable chip label for a proposal. update/remove/move resolve the target's live title
 * AND its real date from `plans` by id (the op's own date is only a hint — see `resolveLive`);
 * addItem uses its own title/date. Time (if any) is shown as a 12h clock label via the shared
 * `formatTimeAmPm`. The chip must state the day the change will ACTUALLY land on.
 */
export function describeOp(op: Op, plans: DayPlan[]): string {
  const timeSuffix = op.startMinutes != null ? ` · ${formatTimeAmPm(op.startMinutes)}` : '';
  if (op.type === 'addItem') return `Add “${op.title}” to ${formatDate(op.date as string)}${timeSuffix}`;

  const found = resolveLive(plans, op.itemId as string);
  const title = found?.item.title ?? 'item';
  const onDate = found?.date ?? (op.date ?? op.fromDate) as string;
  switch (op.type) {
    case 'updateItem': {
      // NOT `timeSuffix`: the change summary already names the time when time is what's changing,
      // and a bare ` · 2:30 PM` on a notes-only edit read as if the time were changing too.
      const changes = describePatch(contentPatch(op));
      const frame = `Update “${title}” on ${formatDate(onDate)}`;
      // Validation (Rule 8) guarantees ≥1 patch field for any op that reaches a chip; the empty
      // fallback exists because `describeOp` is exported and callable on an unvalidated op.
      return changes ? `${frame} · ${changes}` : frame;
    }
    case 'removeItem':
      return `Remove “${title}” from ${formatDate(onDate)}`;
    case 'moveItem':
      return `Move “${title}” to ${formatDate(op.toDate as string)}`;
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
      const itemId = op.itemId as string;
      const found = resolveLive(plans, itemId);
      // The item's REAL day — never `op.date`, which the model routinely gets wrong (and,
      // on an updateItem, may be the day the user asked to move to; a move needs `moveItem`).
      const date = found?.date ?? (op.date as string);
      const prev = found?.item;
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
      const itemId = op.itemId as string;
      const found = resolveLive(plans, itemId); // capture full item BEFORE removing (undo restores it)
      const date = found?.date ?? (op.date as string);
      const prev = found?.item;
      store.removeItem(date, itemId);
      return {
        message: `Removed “${prev?.title ?? 'item'}”`,
        undo: () => {
          if (prev) store.restoreItem(date, prev);
        },
      };
    }
    case 'moveItem': {
      const toDate = op.toDate as string;
      const itemId = op.itemId as string;
      const found = resolveLive(plans, itemId);
      const fromDate = found?.date ?? (op.fromDate as string); // resolved day, not the model's hint
      const prev = found?.item;
      //-A: invert by the id the store says the item LANDED on, never by the original. Under
      // sync `moveItem` mints a fresh target id (freshCopyOf), so an inverse addressed by the
      // original id resolves nothing — the undo toast showed and did nothing. `landedId` is
      // `itemId` under dormant, the minted id under sync, and `undefined` when nothing moved (in
      // which case there is nothing to put back and the toast's action is a deliberate no-op).
      const landedId = store.moveItem(itemId, fromDate, toDate);
      return {
        message: `Moved “${prev?.title ?? 'item'}”`,
        undo: () => {
          if (landedId) store.moveItem(landedId, toDate, fromDate);
        },
      };
    }
  }
}
