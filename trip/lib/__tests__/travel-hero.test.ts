import { describe, it, expect } from 'vitest';

// S185 — the Travel Mode Now/Next hero PURE phase state machine. `deriveTravelHero(items, ctx)`
// is PURE (D-016): the caller injects the day, place offset, and "now" (a UTC epoch-ms instant),
// so every case is deterministic here with no time mocking. Composes the frozen `nextUp` engine
// for the "next" slot (that engine's own suite in whats-next.test.ts is byte-untouched).

import { deriveTravelHero, deriveRowPhases, DEFAULT_NOW_BLOCK_MIN } from '@/lib/travel-hero';
import { NPT_OFFSET_MIN, placeWallClockToUtcMs } from '@/core/dates';
import type { ItineraryItem, ItineraryCategory } from '@/lib/trip-data';

function item(
  startMin: number | undefined,
  opts: {
    id?: string;
    title?: string;
    done?: boolean;
    durationMinutes?: number;
    category?: ItineraryCategory;
    time?: string;
    tzOffsetMin?: number; // S391: D-225 per-item zone override, for the mixed-zone cases
  } = {},
): ItineraryItem {
  return {
    id: opts.id ?? `i-${startMin ?? 'untimed'}`,
    title: opts.title ?? `Item ${startMin ?? '(untimed)'}`,
    category: opts.category ?? 'sightseeing',
    ...(startMin !== undefined ? { startMinutes: startMin } : {}),
    ...(opts.time !== undefined ? { time: opts.time } : {}),
    ...(opts.durationMinutes !== undefined ? { durationMinutes: opts.durationMinutes } : {}),
    ...(opts.done !== undefined ? { done: opts.done } : {}),
    ...(opts.tzOffsetMin !== undefined ? { tzOffsetMin: opts.tzOffsetMin } : {}),
  };
}

const DAY = '2026-12-10';
// "now" at a given wall-clock minute of the Nepal day, as a UTC instant (place-accurate).
const ctxAt = (minutes: number) => ({
  dayDate: DAY,
  placeOffsetMin: NPT_OFFSET_MIN,
  nowUtcMs: placeWallClockToUtcMs(DAY, minutes, NPT_OFFSET_MIN),
});

describe('deriveTravelHero — the seven core phase cases', () => {
  it('1. upcoming — before the first item starts: phase "upcoming", next = that item, no current', () => {
    const items = [item(660, { id: 'lunch', durationMinutes: 60 }), item(900, { id: 'dinner' })]; // 11:00, 15:00
    const s = deriveTravelHero(items, ctxAt(600)); // 10:00 — nothing has started
    expect(s.phase).toBe('upcoming');
    expect(s.current).toBeNull();
    expect(s.next?.id).toBe('lunch');
    expect(s.progress).toBeNull();
  });

  it('2. now — mid-activity: phase "now", current is the in-progress item with elapsed fraction', () => {
    const items = [item(660, { id: 'lunch', durationMinutes: 120 }), item(900, { id: 'dinner' })]; // 11:00–13:00
    const s = deriveTravelHero(items, ctxAt(720)); // 12:00 — halfway through lunch
    expect(s.phase).toBe('now');
    expect(s.current?.id).toBe('lunch');
    expect(s.progress).toBeCloseTo(0.5, 5);
    expect(s.elapsedMinutes).toBe(60);
    expect(s.remainingMinutes).toBe(60);
    expect(s.next?.id).toBe('dinner'); // the "then" line — and NOT the current item
  });

  it('3. flip at the boundary: same item is "upcoming" one minute before start and "now" at start', () => {
    const items = [item(660, { id: 'lunch', durationMinutes: 120 })]; // 11:00–13:00
    const before = deriveTravelHero(items, ctxAt(659)); // 10:59
    expect(before.phase).toBe('upcoming');
    expect(before.next?.id).toBe('lunch');
    expect(before.current).toBeNull();

    const at = deriveTravelHero(items, ctxAt(660)); // 11:00 exactly — the flip
    expect(at.phase).toBe('now');
    expect(at.current?.id).toBe('lunch');
    expect(at.progress).toBeCloseTo(0, 5);
    // At the exact start instant the item is the "now", never double-listed as "next".
    expect(at.next).toBeNull();
  });

  it('4. done day: every timed item is past/done -> phase "done", no current, no next', () => {
    const items = [
      item(480, { id: 'breakfast', durationMinutes: 60 }), // 08:00–09:00 (past by noon)
      item(600, { id: 'walk', done: true }), // 10:00, marked done
    ];
    const s = deriveTravelHero(items, ctxAt(720)); // 12:00
    expect(s.phase).toBe('done');
    expect(s.current).toBeNull();
    expect(s.next).toBeNull();
  });

  it('5. empty day: no items -> phase "empty"', () => {
    const s = deriveTravelHero([], ctxAt(720));
    expect(s.phase).toBe('empty');
    expect(s.untimedCount).toBe(0);
  });

  it('6. untimed-items day: items exist but none carry a time -> phase "untimed" with the count', () => {
    const items = [item(undefined, { id: 'a' }), item(undefined, { id: 'b', time: 'whenever' })];
    const s = deriveTravelHero(items, ctxAt(720));
    expect(s.phase).toBe('untimed');
    expect(s.untimedCount).toBe(2);
    expect(s.current).toBeNull();
  });

  it('7. durationMinutes-absent fallback: "now" until the next item starts, then flips to upcoming', () => {
    // 11:00 open-ended item, next item 12:00. Its implicit window is 11:00 -> 12:00 (gap-to-next).
    const items = [item(660, { id: 'open' }), item(720, { id: 'nextthing', durationMinutes: 30 })];

    const mid = deriveTravelHero(items, ctxAt(690)); // 11:30 — inside the gap
    expect(mid.phase).toBe('now');
    expect(mid.current?.id).toBe('open');
    expect(mid.progress).toBeCloseTo(0.5, 5); // 30 of the 60-min gap elapsed

    const atNext = deriveTravelHero(items, ctxAt(720)); // 12:00 — the open item's window closed
    expect(atNext.phase).toBe('now');
    expect(atNext.current?.id).toBe('nextthing'); // the 12:00 item is now in progress
  });
});

describe('deriveTravelHero — fallback cap for a lone open-ended item (the D-rule cap)', () => {
  it('a last, open-ended item is "now" for at most DEFAULT_NOW_BLOCK_MIN, then "done"', () => {
    const items = [item(660, { id: 'solo' })]; // 11:00, no duration, no next -> capped 120min window
    const inside = deriveTravelHero(items, ctxAt(660 + DEFAULT_NOW_BLOCK_MIN - 1)); // 12:59
    expect(inside.phase).toBe('now');
    expect(inside.current?.id).toBe('solo');

    const after = deriveTravelHero(items, ctxAt(660 + DEFAULT_NOW_BLOCK_MIN)); // 13:00 — window closed
    expect(after.phase).toBe('done');
    expect(after.current).toBeNull();
  });
});

describe('deriveTravelHero — overlap + purity', () => {
  it('when two activities overlap, the latest-starting one is the current', () => {
    const items = [
      item(600, { id: 'longtour', durationMinutes: 240 }), // 10:00–14:00
      item(690, { id: 'stopin', durationMinutes: 60 }), // 11:30–12:30 (nested)
    ];
    const s = deriveTravelHero(items, ctxAt(720)); // 12:00 — both are live; the later one wins
    expect(s.phase).toBe('now');
    expect(s.current?.id).toBe('stopin');
  });

  it('does not mutate the input array', () => {
    const items = [item(660, { id: 'lunch', durationMinutes: 120 }), item(900, { id: 'dinner' })];
    const snapshot = JSON.stringify(items);
    deriveTravelHero(items, ctxAt(720));
    expect(JSON.stringify(items)).toBe(snapshot);
  });
});

// S186 — the per-row phase view of the SAME machine, for the TM agenda list.
describe('deriveRowPhases — per-row phase, order-aligned with items', () => {
  it('classifies done / now / upcoming / past / untimed against the injected "now"', () => {
    const items = [
      item(480, { id: 'past', durationMinutes: 60 }), // 08:00–09:00 — behind noon, not done → past
      item(600, { id: 'done', done: true }), // 10:00, marked done → done (wins over past)
      item(660, { id: 'now', durationMinutes: 120 }), // 11:00–13:00 — in progress at noon → now
      item(900, { id: 'later' }), // 15:00 — still ahead → upcoming
      item(undefined, { id: 'floats' }), // no start → untimed
    ];
    expect(deriveRowPhases(items, ctxAt(720))).toEqual(['past', 'done', 'now', 'upcoming', 'untimed']);
  });

  it('an all-empty day yields an empty array (order + length preserved)', () => {
    expect(deriveRowPhases([], ctxAt(720))).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// S391: one decision, ONE time frame.
//
// `currentActivity` qualified its window by INSTANTS but broke ties on WALL CLOCK
// (`t.startMin > bestStart`), and `effectiveEndMin` took the gap-to-next as a wall-clock
// difference across zones. Both cases below are stated in UTC instants on purpose: the same
// scenarios asserted in the wall-clock frame pass on the broken code AND the fixed code,
// which is the entire reason they are written this way.
//
// ⚖️ REACHABILITY, measured (S391 probe, both frames run side by side over every seed day at
// every UTC minute, with a synthetic mixed-zone day as the positive control that DID flag):
//   · 0 of 32 seed days produce a different current activity under the two frames today, and
//     the multi-candidate tiebreak never fires at all — no seed day has two overlapping
//     windows at any minute. (An earlier note here claimed Dec 10 did; it does not.)
//   · But ONE added item is enough, with NO durationMinutes: adding a single day-offset item
//     makes the frames disagree on all four flight days — 60/96 tried start positions on
//     2026-12-09, 13/96 on 12-10, 24/96 on 12-19, 17/96 on 2027-01-09 — because the gap-to-next
//     is then measured between a clock face in one zone and a clock face in another.
// So: latent today, one quick-add away from live. That is why it is worth fixing now.
describe('S391: the current-activity decision is made entirely on the instant', () => {
  const JAN9 = '2027-01-09';
  const jan9At = (utcHour: number, utcMin = 0) => ({
    dayDate: JAN9,
    placeOffsetMin: 540, // the day is a Japan day; per-item overrides sit on top
    nowUtcMs: Date.UTC(2027, 0, 9, utcHour, utcMin),
  });

  it('the tiebreak picks the most recently BEGUN item, not the highest clock face', () => {
    // Tokyo departure 17:35 JST = 08:35 UTC, running 12h → ends 20:35 UTC.
    const tokyo = item(1055, { id: 'tokyo', durationMinutes: 720 });
    // Detroit 13:00 EST = 18:00 UTC, running 4h → ends 22:00 UTC.
    const detroit = item(780, { id: 'detroit', durationMinutes: 240, tzOffsetMin: -300 });

    // At 19:00 UTC BOTH windows contain "now", so the tiebreak actually decides.
    const s = deriveTravelHero([tokyo, detroit], jan9At(19));
    expect(s.phase).toBe('now');
    // Wall clock says tokyo (1055 > 780). The instant says detroit — it began an hour ago,
    // tokyo began ten and a half hours ago.
    expect(s.current?.id).toBe('detroit');
    expect(s.elapsedMinutes).toBe(60);
    expect(s.remainingMinutes).toBe(180);
  });

  it('the gap-to-next fallback measures the gap in instants, not across clock faces', () => {
    // Neither item carries durationMinutes — the seed-shaped case, so both take the fallback.
    const tokyo = item(1055, { id: 'tokyo' }); // 17:35 JST = 08:35 UTC
    const detroit = item(1080, { id: 'detroit', tzOffsetMin: -300 }); // 18:00 EST = 23:00 UTC

    // On the clock faces the gap reads 25 minutes (1080 − 1055), which would end tokyo at
    // 09:00 UTC. The real gap is 14h25m, so the DEFAULT_NOW_BLOCK_MIN cap applies and tokyo
    // runs 08:35 → 10:35 UTC.
    const s = deriveTravelHero([tokyo, detroit], jan9At(9, 30));
    expect(s.phase).toBe('now');
    expect(s.current?.id).toBe('tokyo');
    expect(s.remainingMinutes).toBe(65); // 10:35 − 09:30
    expect(DEFAULT_NOW_BLOCK_MIN).toBe(120); // the cap that makes 65 the right answer
  });

  it('a genuinely short cross-zone gap still ends the item early (the cap is not the only rule)', () => {
    const tokyo = item(1055, { id: 'tokyo' }); // 08:35 UTC
    // 04:05 EST = 09:05 UTC — only 30 real minutes after tokyo starts, despite reading EARLIER.
    const detroit = item(245, { id: 'detroit', tzOffsetMin: -300 });
    expect(deriveTravelHero([tokyo, detroit], jan9At(9, 0)).current?.id).toBe('tokyo');
    // …and at 09:10 UTC tokyo has been ended by detroit's start, so detroit is the current one.
    expect(deriveTravelHero([tokyo, detroit], jan9At(9, 10)).current?.id).toBe('detroit');
  });
});
