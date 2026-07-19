// Travel Mode Now/Next hero — the PURE phase state machine.
//
// ── Purity ─────────────────────────────────────────────────────────────────
// `deriveTravelHero` is PURE — no clock read, no fetch, no storage. Like `nextUp` (which it
// COMPOSES for the "next" slot), it takes the day's items AND a `NextUpContext` carrying the
// day's date, the place's UTC offset, and "now" as a UTC epoch-ms instant. The IMPURE "now"
// is supplied by the caller
// (`components/travel-hero-card.tsx`) — so this stays trivially unit-testable in isolation.
//
// Time math is place-accurate and confined to `core/dates`' `placeWallClockToUtcMs` /
// `effectiveStartMinutes` — no `new Date(string)`, no offset re-implementation here.
//
// ── The "now" fallback for items without `durationMinutes` ──────────────────
// An item is the CURRENT activity when it has started and not yet ended. End = start +
// duration. When `durationMinutes` is absent (the common seed/legacy case), the implicit end
// is the START OF THE NEXT TIMED ITEM that day, CAPPED at `DEFAULT_NOW_BLOCK_MIN`. So an
// open-ended item is "now" until the next thing begins, but never longer than the cap — after
// the cap the card honestly falls back to "upcoming" (nothing active; next up at …) rather
// than pinning a stale, hours-long "now". The cap also bounds the last item of the day, which
// has no "next" to end it.

import type { ItineraryItem } from '@/lib/trip-data';
import { effectiveStartMinutes, placeWallClockToUtcMs } from '@/core/dates';
import { nextUp, type NextUpContext } from '@/lib/whats-next';

/** Cap for an open-ended (`durationMinutes`-absent) current activity — 2 hours. */
export const DEFAULT_NOW_BLOCK_MIN = 120;

export type TravelHeroPhase =
  | 'empty' // no items on the day at all
  | 'untimed' // items exist but NONE carry an effective start (nothing to schedule)
  | 'upcoming' // nothing in progress; the next timed item is still ahead
  | 'now' // an item is in progress right now
  | 'done'; // every timed item is done or past — the day is complete

export interface TravelHeroState {
  phase: TravelHeroPhase;
  /** The in-progress item (phase `now`), else `null`. */
  current: ItineraryItem | null;
  /** The next upcoming item (`nextUp`) — the "then" line in `now`, the headline in `upcoming`. */
  next: ItineraryItem | null;
  /** Elapsed fraction 0..1 of the current activity (phase `now`), else `null`. */
  progress: number | null;
  /** Whole minutes elapsed into the current activity (phase `now`), else `null`. */
  elapsedMinutes: number | null;
  /** Whole minutes left in the current activity (phase `now`), else `null`. */
  remainingMinutes: number | null;
  /** Count of items on an all-untimed day (phase `untimed`), else 0. */
  untimedCount: number;
}

interface Timed {
  item: ItineraryItem;
  startMin: number;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** The day's items that carry an effective start, paired with that start (order preserved). */
function timedItems(items: ItineraryItem[]): Timed[] {
  const out: Timed[] = [];
  for (const item of items) {
    const startMin = effectiveStartMinutes(item);
    if (startMin !== undefined) out.push({ item, startMin });
  }
  return out;
}

/** Effective end-minute of a timed item: `start + duration`, or the capped gap-to-next fallback. */
function effectiveEndMin(t: Timed, sortedStarts: number[]): number {
  const d = t.item.durationMinutes;
  if (typeof d === 'number' && Number.isFinite(d) && d > 0) return t.startMin + d;
  const nextStart = sortedStarts.find((s) => s > t.startMin);
  const gap = nextStart === undefined ? Infinity : nextStart - t.startMin;
  return t.startMin + Math.min(gap, DEFAULT_NOW_BLOCK_MIN);
}

interface Current {
  item: ItineraryItem;
  progress: number;
  elapsedMinutes: number;
  remainingMinutes: number;
}

/**
 * The in-progress activity right now, or `null`. An item qualifies when it is not done, has an
 * effective start, and `start <= now < end` (inclusive start, exclusive end) at the place. When
 * several overlap, the LATEST-starting one wins (the most recently-begun activity is "most
 * current"); ties resolve to array order (stable).
 */
function currentActivity(timed: Timed[], ctx: NextUpContext): Current | null {
  const starts = timed.map((t) => t.startMin).sort((a, b) => a - b);
  let best: Current | null = null;
  let bestStart = -Infinity;
  for (const t of timed) {
    if (t.item.done === true) continue;
    const startMs = placeWallClockToUtcMs(ctx.dayDate, t.startMin, ctx.placeOffsetMin);
    const endMs = placeWallClockToUtcMs(ctx.dayDate, effectiveEndMin(t, starts), ctx.placeOffsetMin);
    if (startMs <= ctx.nowUtcMs && ctx.nowUtcMs < endMs && t.startMin > bestStart) {
      const span = endMs - startMs;
      best = {
        item: t.item,
        progress: clamp01((ctx.nowUtcMs - startMs) / span),
        elapsedMinutes: Math.max(0, Math.round((ctx.nowUtcMs - startMs) / 60000)),
        remainingMinutes: Math.max(0, Math.round((endMs - ctx.nowUtcMs) / 60000)),
      };
      bestStart = t.startMin;
    }
  }
  return best;
}

const emptyState = (phase: TravelHeroPhase, untimedCount = 0): TravelHeroState => ({
  phase,
  current: null,
  next: null,
  progress: null,
  elapsedMinutes: null,
  remainingMinutes: null,
  untimedCount,
});

/**
 * The Now/Next hero phase for a trip day. Composes the frozen `nextUp` engine (the "next"
 * slot) with the new current-activity derivation (the "now" slot). Total — never throws;
 * returns an honest `empty` / `untimed` / `done` state when there is nothing to show.
 */
export function deriveTravelHero(items: ItineraryItem[], ctx: NextUpContext): TravelHeroState {
  if (items.length === 0) return emptyState('empty');

  const timed = timedItems(items);
  if (timed.length === 0) return emptyState('untimed', items.length);

  const cur = currentActivity(timed, ctx);
  // Exclude the current item from the "next" search so a single-instant start/now overlap can't
  // list the same item as both now AND next (nextUp is `>=` inclusive at exactly-now).
  const nextPool = cur ? items.filter((i) => i !== cur.item) : items;
  const next = nextUp(nextPool, ctx);

  if (cur) {
    return {
      phase: 'now',
      current: cur.item,
      next,
      progress: cur.progress,
      elapsedMinutes: cur.elapsedMinutes,
      remainingMinutes: cur.remainingMinutes,
      untimedCount: 0,
    };
  }
  if (next) return { ...emptyState('upcoming'), next };
  return emptyState('done');
}

/** Per-row phase for the TM agenda list. A row-level view of the SAME machine above. */
export type TravelRowPhase =
  | 'done' // item.done === true
  | 'now' // the in-progress current activity (same `currentActivity` the hero uses)
  | 'upcoming' // has an effective start still ahead of "now"
  | 'past' // had a start that is behind "now" but is not done and not current
  | 'untimed'; // carries no effective start (nothing to schedule against)

/**
 * Classify every item of a trip day into its TM-agenda row phase. PURE: reuses
 * this module's OWN `timedItems`/`currentActivity` — it does NOT fork the derivation, it reads
 * the same "now" the hero card reads. Returns one phase per input item, order-aligned with
 * `items`, so the agenda can style each row (now-highlight / done-dim / upcoming / past).
 */
export function deriveRowPhases(items: ItineraryItem[], ctx: NextUpContext): TravelRowPhase[] {
  const timed = timedItems(items);
  const cur = currentActivity(timed, ctx);
  return items.map((item) => {
    if (item.done === true) return 'done';
    if (cur && cur.item === item) return 'now';
    const startMin = effectiveStartMinutes(item);
    if (startMin === undefined) return 'untimed';
    const startMs = placeWallClockToUtcMs(ctx.dayDate, startMin, ctx.placeOffsetMin);
    return startMs > ctx.nowUtcMs ? 'upcoming' : 'past';
  });
}
