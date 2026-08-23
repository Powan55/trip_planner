// Concierge agent ops — the CLIENT half of the `{reply, ops[]}` contract.
//
// The Worker emits a `{reply, ops}` envelope where each op is a FLAT, nullable-superset
// object. This module owns the two client-side responsibilities the Worker can't:
// - `validateOps` — STATE-validity: run against the LIVE itinerary and reject-and-DROP any
// op that fails one of the 8 rules (one bad op must not nuke a good reply). Pure over
// `(rawOps, livePlans)` → the surviving `Op[]`. The drop is no longer INVISIBLE (issue #13):
// `dropReason` — the same predicate `validateOps` filters on — returns WHY, as a `DropCode`.
// A code, never a sentence: no rule name, field name or machine text exists in this module for
// a caller to leak, and the copy lives in `components/concierge-chat.tsx`.
// - `applyOp` — EXECUTION: turn one confirmed op into the matching `useItinerary()` CRUD
// call (addItem MINTS a fresh id — never trust an agent-supplied id) and return the undo
// message + pre-state restore fn for `showUndoToast`. Nothing here mutates until a caller
// invokes it on an explicit user confirm (proposals-only, the load-bearing safety property).
//
// nothing is logged here (no ops, no reply, no context).

import type { DayPlan, ItineraryCategory, ItineraryItem } from '@/lib/trip-data';
import { ALL_CATEGORIES } from '@/lib/itinerary-category';
import {
  TRIP_DATES,
  formatDate,
  formatTimeAmPm,
  getCountryForDate,
  offsetForCountry,
} from '@/core/dates';
import { firstClashWith, timeFootprintChanged } from '@/lib/sort-items-by-time';
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

// The category 10-set, as a Set because membership is what validation needs. This file used to
// carry its own copy of the ten literals plus the `Exclude` guard that keeps a copy honest; both
// now live next to the union in lib/itinerary-category.ts, so there is nothing here left to drift.
const CATEGORY_SET: ReadonlySet<string> = new Set(ALL_CATEGORIES);

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

/**
 * Issue #13 — the vocabulary of drop causes. A CODE UNION, deliberately NOT sentences: the copy
 * for these lives in `components/concierge-chat.tsx`, which is what keeps D-234's "no raw
 * validation error ever reaches a person" STRUCTURAL rather than a promise — there is no rule
 * number, field name or machine string in this module for a caller to render by accident.
 * Same reason-code → copy shape as `components/photo-attach.tsx::reasonMessage`.
 */
export type DropCode =
  | 'unreadable' // not an object, or a field whose type makes the op un-actionable
  | 'unknown-verb' // Rule 2
  | 'bad-time' // Rule 7 (startMinutes)
  | 'bad-duration' // Rule 7 (durationMinutes)
  | 'date-not-in-trip' // Rule 4
  | 'no-title' // Rule 3 / the title half of a patch
  | 'bad-category' // Rule 5
  | 'no-such-item' // Rule 3 (itemId) + Rule 6
  | 'nothing-to-change' // Rule 8
  | 'already-there'; // moveItem whose toDate IS the item's resolved day

/**
 * The type of every content field PRESENT on the op, as a `DropCode` or `undefined`. Shared by
 * BOTH verbs that build a `contentPatch` — it used to live inside the `updateItem` loop, so
 * `addItem` never ran it (see the call site). Rule 8's patch-count accounting stays in
 * `updateItem`, which is the only verb it means anything for.
 * startMinutes/durationMinutes are range-checked before the switch, for every verb.
 */
function contentTypeError(o: Record<string, unknown>): DropCode | undefined {
  for (const k of CONTENT_KEYS) {
    if (o[k] == null) continue;
    if (k === 'title' && !isNonEmptyString(o[k])) return 'no-title';
    if (k === 'category' && !isCategory(o[k])) return 'bad-category'; // Rule 5
    if ((k === 'notes' || k === 'location') && typeof o[k] !== 'string') return 'unreadable';
  }
  return undefined;
}

/**
 * WHY one raw op fails against the LIVE itinerary, or `undefined` when it is valid.
 *
 * This holds the real rule logic and `isValidOp` is its boolean wrapper, so the reason shown to a
 * traveller and the decision to drop can never disagree — the same one-predicate discipline
 * `clashForOp`/`firstClashWith` use (D-316). The three ANDed `addItem` checks are split apart
 * because date, title and category are three different things to say. No throw, no log (D-152).
 */
export function dropReason(raw: unknown, plans: DayPlan[]): DropCode | undefined {
  if (!raw || typeof raw !== 'object') return 'unreadable';
  const o = raw as Record<string, unknown>;

  // Rule 2 — type ∈ the four verbs.
  const type = o.type;
  if (type !== 'addItem' && type !== 'updateItem' && type !== 'removeItem' && type !== 'moveItem') {
    return 'unknown-verb';
  }
  // Rule 7 — startMinutes/durationMinutes ranges (any verb that carries them), one code each.
  if (o.startMinutes != null) {
    if (!Number.isInteger(o.startMinutes) || (o.startMinutes as number) < 0 || (o.startMinutes as number) > 1439) {
      return 'bad-time';
    }
  }
  if (o.durationMinutes != null) {
    if (!Number.isInteger(o.durationMinutes) || (o.durationMinutes as number) <= 0) return 'bad-duration';
  }

  switch (type) {
    case 'addItem':
      // Rule 3 (add: date,title,category) + Rule 4 (date ∈ TRIP_DATES) + Rule 5 (category ∈ set).
      if (!isTripDate(o.date)) return 'date-not-in-trip';
      if (!isNonEmptyString(o.title)) return 'no-title';
      if (!isCategory(o.category)) return 'bad-category';
      // …and the SAME per-field typing updateItem applies. Without it an `addItem` carrying
      // `notes: {…}` or `location: 5` validated, rendered an ordinary chip, and on Confirm wrote
      // the value verbatim into the new item — which `itineraryItemSchema` (both fields
      // `z.string().optional()`) then dropped on the very next read, in the same tick. The toast
      // said `Added “Ramen”` and nothing was added, anywhere.
      return contentTypeError(o);

    case 'updateItem': {
      // Rule 3 (itemId + ≥1 patch) + Rule 6 (target resolves by id) + Rule 8 (≥1 non-null patch).
      // No Rule 4 date check: the target's date comes from the ITINERARY, not from the op.
      if (!isNonEmptyString(o.itemId)) return 'no-such-item';
      const badField = contentTypeError(o);
      if (badField) return badField;
      // Rule 8 — ≥1 present patch field (all of them well-typed by the line above).
      if (!CONTENT_KEYS.some((k) => o[k] != null)) return 'nothing-to-change';
      return resolveLive(plans, o.itemId) === undefined ? 'no-such-item' : undefined; // Rule 6
    }

    case 'removeItem':
      // Rule 3 (itemId) + Rule 6.
      if (!isNonEmptyString(o.itemId)) return 'no-such-item';
      return resolveLive(plans, o.itemId) === undefined ? 'no-such-item' : undefined;

    case 'moveItem': {
      // Rule 3 (itemId,toDate) + Rule 4 (toDate — a REAL new date, so it must be a trip date) +
      // Rule 6 (target resolves). `fromDate` is a hint; toDate ≠ fromDate is enforced
      // against the item's RESOLVED current day, which is the day the move would actually leave.
      if (!isNonEmptyString(o.itemId)) return 'no-such-item';
      if (!isTripDate(o.toDate)) return 'date-not-in-trip';
      const found = resolveLive(plans, o.itemId);
      if (found === undefined) return 'no-such-item';
      return found.date === o.toDate ? 'already-there' : undefined;
    }
  }
}

/**
 * — validate a single raw op against the LIVE itinerary. Returns true only if EVERY applicable
 * rule holds; any failure = drop (the caller filters). The boolean wrapper over `dropReason`, so
 * a drop and its stated reason are the same computation. No throw, no log.
 */
function isValidOp(raw: unknown, plans: DayPlan[]): raw is Op {
  return dropReason(raw, plans) === undefined;
}

/**
 * — filter raw ops (whatever the Worker sent) to the ones valid against `livePlans`. Rule 1:
 * a non-array (or absent) `ops` yields `[]` (pure chat). Order preserved; invalid ops dropped
 * (the caller says WHY via `dropReason` — this function itself never explains, logs or throws).
 * Run this at CHIP-RENDER time against the live plans so a chip never shows for an op
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
 * The item an `addItem` op WOULD create, minus the id (`applyOp` mints the real one;
 * `clashForOp` passes a sentinel). One construction, so the interval that gets CHECKED can
 * never drift from the item that gets WRITTEN — the fields deciding clash participation
 * (`startMinutes`/`durationMinutes` today, `endDate` the day anything adds it) come from here.
 */
function itemFromAddOp(op: Op, id: string): ItineraryItem {
  return {
    id,
    title: op.title as string,
    category: op.category as ItineraryCategory,
    // contentPatch re-sets title/category (harmless — same values) plus any time/notes/location.
    ...contentPatch(op),
  };
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

// The candidate id for an addItem check: deliberately NOT a real id, so `firstClashWith`'s
// self-exclusion (`other.id === candidate.id`) can never swallow a genuine collision. The real
// id is minted at apply time and does not exist yet.
const ADD_CANDIDATE_ID = 'd316-concierge-candidate';

/**
 * Issue #19 / D-316 — the item this op would COLLIDE with if confirmed, or `undefined` when the
 * write is clear.
 *
 * DELIBERATELY NOT A 9th `isValidOp` RULE, and this is the whole design point. `validateOps`
 * DROPS a failing op — issue #13 changed only whether a one-line REASON is printed alongside the
 * drop, never that the op itself is gone — so a conflicting suggestion would still vanish from the
 * chat, which is the exact opposite of what #19 asks for ("say so, ask how you want to resolve
 * it"): that refusal must keep its chip ON SCREEN and confirmable. It also answers a button PRESS,
 * where `validateOps` re-runs on every render. Do not read #13 as licence to move it. The caller is
 * `components/concierge-chat.tsx::confirmOp`, the explicit-user-confirm layer, where there is a
 * person to speak to and a chip to keep on screen. Do not wire this into `validateOps`.
 *
 * Shares Slice A's ONE predicate (`firstClashWith` + `timeFootprintChanged`, both over
 * `toInterval`), so this refusal can never contradict the five authoring surfaces D-316 guards
 * or the amber badge that reports the overlaps it lets live.
 *
 * Per verb:
 * - `addItem` — the item it would create, against its own `date`. A new item has no previous
 * footprint, so it is always guarded.
 * - `updateItem` — the patch MERGED over the resolved live item, against that item's REAL day,
 * self-excluded by id. Footprint-scoped exactly like the five surfaces: a patch that leaves
 * start, duration, day and endDate alone is never guarded, which is what keeps an already-
 * overlapping item (the seed's three deliberate containments) editable through the concierge.
 * That subsumes "only when the patch carries startMinutes/durationMinutes" AND grandfathers a
 * patch that merely re-states the time the item already effectively has.
 * - `moveItem` — the live item against `toDate`. Always guarded: validation already required
 * `toDate` ≠ the item's resolved current day, so the footprint always moves.
 * - `removeItem` — never blocked. Deleting cannot create an overlap.
 *
 * Pure over `(op, plans)`; writes nothing. Assumes the op passed `validateOps`, like `applyOp`.
 */
export function clashForOp(op: Op, plans: DayPlan[]): ItineraryItem | undefined {
  const check = (candidate: ItineraryItem, date: string) =>
    firstClashWith(
      candidate,
      // The day's stored items, or none — a day the traveller has never touched has no entry.
      plans.find((p) => p.date === date)?.items ?? [],
      date,
      offsetForCountry(getCountryForDate(date)),
    );

  switch (op.type) {
    case 'addItem':
      return check(itemFromAddOp(op, ADD_CANDIDATE_ID), op.date as string);

    case 'updateItem': {
      const found = resolveLive(plans, op.itemId as string);
      if (!found) return undefined; // target gone — the chip re-validates away on its own
      const next: ItineraryItem = { ...found.item, ...contentPatch(op) };
      if (!timeFootprintChanged(found.item, found.date, next, found.date)) return undefined;
      return check(next, found.date);
    }

    case 'removeItem':
      return undefined;

    case 'moveItem': {
      const found = resolveLive(plans, op.itemId as string);
      return found ? check(found.item, op.toDate as string) : undefined;
    }

    // A 5th verb must not reach `applyOp` unguarded. Without this, an added `OpType` with no case
    // here falls out returning `undefined` — read as "no clash", so the write is ALLOWED: the
    // guard fails OPEN while `applyOp` (non-nullable return) fails to COMPILE, and the safe half
    // is the one that stays silent. This makes both halves fail the same way, at build time.
    // Same rule as the `Exclude` guard on CATEGORIES above: a check that runs, not a comment.
    default: {
      const _exhaustive: never = op.type;
      return _exhaustive;
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
      // MINT — never trust an agent-supplied id for a new item. The rest of the construction is
      // shared with `clashForOp`, so the checked interval is the written item's.
      const item = itemFromAddOp(op, generateItemId());
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
