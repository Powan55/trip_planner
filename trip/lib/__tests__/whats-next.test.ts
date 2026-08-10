import { describe, it, expect } from 'vitest';

// S100 → re-signatured S124 — the "what's-next rail" pure helper. `nextUp(items, ctx)` is PURE
// (D-016): no clock/fetch/storage — the caller injects the day, place offset, and "now" (a UTC
// epoch-ms instant). Fully deterministic here. Every S100 behavioral case is re-asserted under
// the new signature (matrix item 12), plus the place-clock / fallback cases.

import { nextUp } from '@/lib/whats-next';
import {
  NPT_OFFSET_MIN,
  JST_OFFSET_MIN,
  placeWallClockToUtcMs,
} from '@/core/dates';
import type { ItineraryItem, ItineraryCategory } from '@/lib/trip-data';

/** Terse item builder — id/title derive from time so failures read clearly. */
function item(
  time: string | undefined,
  opts: {
    done?: boolean;
    category?: ItineraryCategory;
    id?: string;
    title?: string;
    startMinutes?: number;
  } = {},
): ItineraryItem {
  return {
    id: opts.id ?? `i-${time ?? 'notime'}`,
    title: opts.title ?? `Item ${time ?? '(untimed)'}`,
    category: opts.category ?? 'sightseeing',
    ...(time !== undefined ? { time } : {}),
    ...(opts.startMinutes !== undefined ? { startMinutes: opts.startMinutes } : {}),
    ...(opts.done !== undefined ? { done: opts.done } : {}),
  };
}

// A fixed Nepal trip day; "now" = NOON at the place (parity with S100's NOON="12:00" compare).
// So items before 12:00 are past, an item exactly at 12:00 is upcoming (>= inclusive).
const DAY = '2026-12-10';
const NOON_CTX = {
  dayDate: DAY,
  placeOffsetMin: NPT_OFFSET_MIN,
  nowUtcMs: placeWallClockToUtcMs(DAY, 720, NPT_OFFSET_MIN),
};

describe('nextUp — picks the earliest upcoming not-done timed item', () => {
  it('returns the next item at or after now (an upcoming item is picked)', () => {
    const items = [item('09:00'), item('13:00'), item('18:30')];
    expect(nextUp(items, NOON_CTX)?.time).toBe('13:00');
  });

  it('includes an item whose time EQUALS now (>= is inclusive — at-now is upcoming)', () => {
    const items = [item('09:00'), item('12:00'), item('15:00')];
    expect(nextUp(items, NOON_CTX)?.time).toBe('12:00');
  });

  it('picks the earliest upcoming even when items are out of chronological order', () => {
    const items = [item('18:00'), item('12:30'), item('20:00'), item('13:00')];
    expect(nextUp(items, NOON_CTX)?.time).toBe('12:30');
  });
});

describe('nextUp — skips passed, done, and untimed items', () => {
  it('skips an item strictly before now (a passed item is not picked)', () => {
    const items = [item('06:00'), item('09:00'), item('11:59')];
    expect(nextUp(items, NOON_CTX)).toBeNull(); // all before noon
  });

  it('skips a done item even if its time is upcoming (the rail advances past it)', () => {
    const items = [item('13:00', { done: true }), item('15:00')];
    expect(nextUp(items, NOON_CTX)?.time).toBe('15:00');
  });

  it('does not pick items with no effective start (missing / blank / unparseable time)', () => {
    const items = [
      item(undefined),
      item(''),
      item('not-a-time'),
      item('24:00'), // out of range → unparseable
      item('12:60'), // out of range → unparseable
      item('14:00'),
    ];
    // Only the one valid, upcoming timed item is chosen; the malformed ones neither crash
    // nor get picked.
    expect(nextUp(items, NOON_CTX)?.time).toBe('14:00');
  });
});

describe('nextUp — null cases', () => {
  it('all items past -> null', () => {
    expect(nextUp([item('06:00'), item('08:30')], NOON_CTX)).toBeNull();
  });

  it('all upcoming items done -> null', () => {
    expect(
      nextUp([item('13:00', { done: true }), item('15:00', { done: true })], NOON_CTX),
    ).toBeNull();
  });

  it('no timed items -> null (never crashes on untimed-only days)', () => {
    expect(nextUp([item(undefined), item('')], NOON_CTX)).toBeNull();
  });

  it('empty list -> null', () => {
    expect(nextUp([], NOON_CTX)).toBeNull();
  });
});

describe('nextUp — ties resolve to the first in array order (stable)', () => {
  it('two upcoming items at the same time -> the FIRST is returned', () => {
    const first = item('13:00', { id: 'first', title: 'First 13:00' });
    const second = item('13:00', { id: 'second', title: 'Second 13:00' });
    expect(nextUp([first, second], NOON_CTX)?.id).toBe('first');
  });
});

describe('nextUp — purity (D-016)', () => {
  it('same inputs yield the same output and do not mutate the array', () => {
    const items = [item('09:00'), item('13:00'), item('18:00')];
    const snapshot = JSON.stringify(items);
    const a = nextUp(items, NOON_CTX);
    const b = nextUp(items, NOON_CTX);
    expect(a).toBe(b); // same reference from the same array (no new object built)
    expect(JSON.stringify(items)).toBe(snapshot); // input untouched
  });
});

describe('nextUp — structured startMinutes + legacy fallback (S124, matrix item 12)', () => {
  it('picks an item that has ONLY legacy `time` (no startMinutes) via the fallback parser', () => {
    // Every prior case already exercises the fallback; this pins it explicitly.
    const legacyOnly = item('13:00', { id: 'legacy' }); // no startMinutes
    expect(legacyOnly.startMinutes).toBeUndefined();
    expect(nextUp([item('09:00'), legacyOnly], NOON_CTX)?.id).toBe('legacy');
  });

  it('orders by structured startMinutes when present (07:02-style non-round values)', () => {
    const a = item(undefined, { id: 'a', startMinutes: 802 }); // 13:22
    const b = item(undefined, { id: 'b', startMinutes: 782 }); // 13:02 → earlier
    expect(nextUp([a, b], NOON_CTX)?.id).toBe('b');
  });

  it('a valid startMinutes wins over the legacy time for ordering (effectiveStartMinutes rule)', () => {
    // startMinutes 780 (13:00) is used, not the stale legacy "23:00" text.
    const conflicted = item('23:00', { id: 'x', startMinutes: 780 });
    const other = item('14:00', { id: 'y' }); // 840
    expect(nextUp([conflicted, other], NOON_CTX)?.id).toBe('x');
  });

  it('S377 — ranks by INSTANT, not wall clock, when a day holds two zones (D-225)', () => {
    // The real Jan-9 shape: the Tokyo departure reads 17:35 (JST, day offset) and the Detroit
    // layover it produces reads 15:35 (EST, tzOffsetMin -300) — a LATER instant with an EARLIER
    // clock face. Pre-S377 `nextUp` rejected past items by instant but ranked by minutes, so it
    // returned the layover as "next" while the traveller was still standing in Haneda.
    const flight: ItineraryItem = {
      id: 'j22-4', title: 'Fly HND → DTW', category: 'transportation', startMinutes: 1055, // 17:35 JST
    };
    const layover: ItineraryItem = {
      id: 'j22-5', title: 'Layover DTW', category: 'transportation', startMinutes: 935, tzOffsetMin: -300, // 15:35 EST
    };
    const ctx = {
      dayDate: '2027-01-09',
      placeOffsetMin: JST_OFFSET_MIN,
      nowUtcMs: Date.UTC(2027, 0, 9, 6, 0), // 06:00 UTC — before both
    };
    expect(nextUp([flight, layover], ctx)?.id).toBe('j22-4');
    expect(nextUp([layover, flight], ctx)?.id).toBe('j22-4'); // array order must not decide it

    // Once the flight has departed (09:00 UTC > 08:35 UTC), the layover is next.
    const airborne = { ...ctx, nowUtcMs: Date.UTC(2027, 0, 9, 9, 0) };
    expect(nextUp([flight, layover], airborne)?.id).toBe('j22-5');
  });

  it('past across a day boundary: a JST evening item is past once "now" is the next UTC day', () => {
    // 20:00 JST on Dec 19 = 11:00 UTC. A "now" at 15:00 UTC (past that instant) ⇒ item is past.
    const day = '2026-12-19';
    const nowUtcMs = Date.UTC(2026, 11, 19, 15, 0); // 15:00 UTC, after 20:00 JST (=11:00 UTC)
    const evening = item(undefined, { id: 'eve', startMinutes: 1200 }); // 20:00
    expect(
      nextUp([evening], { dayDate: day, placeOffsetMin: JST_OFFSET_MIN, nowUtcMs }),
    ).toBeNull();
  });
});
