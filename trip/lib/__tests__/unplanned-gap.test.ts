import { describe, it, expect } from 'vitest';
import { UNPLANNED_FLOOR_MIN, unplannedGapMinutes, unplannedGapsByItemId } from '@/lib/unplanned-gap';
import type { ItineraryItem } from '@/lib/trip-data';

const DAY = '2026-12-20';
const JAPAN = 540; // minutes east of UTC

const item = (over: Partial<ItineraryItem>): ItineraryItem => ({
  id: 'x',
  title: 'x',
  category: 'sightseeing',
  ...over,
});

describe('unplannedGapMinutes', () => {
  it('measures from the earlier row END, not its start', () => {
    const prev = item({ startMinutes: 540, durationMinutes: 60 }); // 09:00–10:00
    const next = item({ startMinutes: 720 }); // 12:00
    expect(unplannedGapMinutes(prev, next, DAY, JAPAN)).toBe(120);
  });

  it('holds the floor: anything under it is the walk between two things', () => {
    const prev = item({ startMinutes: 540, durationMinutes: 60 });
    expect(
      unplannedGapMinutes(prev, item({ startMinutes: 600 + UNPLANNED_FLOOR_MIN }), DAY, JAPAN),
    ).toBe(UNPLANNED_FLOOR_MIN);
    expect(
      unplannedGapMinutes(prev, item({ startMinutes: 600 + UNPLANNED_FLOOR_MIN - 1 }), DAY, JAPAN),
    ).toBeNull();
  });

  it('yields nothing without both starts, without a span, or backwards', () => {
    const timedWithSpan = item({ startMinutes: 540, durationMinutes: 60 });
    expect(unplannedGapMinutes(undefined, timedWithSpan, DAY, JAPAN)).toBeNull();
    expect(unplannedGapMinutes(timedWithSpan, undefined, DAY, JAPAN)).toBeNull();
    // earlier row has no END, so the interval would be measured from the wrong point
    expect(unplannedGapMinutes(item({ startMinutes: 540 }), item({ startMinutes: 900 }), DAY, JAPAN)).toBeNull();
    // later row is untimed
    expect(unplannedGapMinutes(timedWithSpan, item({}), DAY, JAPAN)).toBeNull();
    // backwards pair — that is an overlap, flagged elsewhere
    expect(
      unplannedGapMinutes(item({ startMinutes: 900, durationMinutes: 60 }), item({ startMinutes: 540 }), DAY, JAPAN),
    ).toBeNull();
  });

  it('falls back to the legacy free-text fields', () => {
    const prev = item({ time: '9:00 AM', duration: '1h' });
    expect(unplannedGapMinutes(prev, item({ time: '12:00 PM' }), DAY, JAPAN)).toBe(120);
  });

  it("reads each row's own offset, not the day's", () => {
    const jst = item({ time: '09:00', duration: '1h' }); // ends 10:00 JST = 01:00 UTC
    const est = item({ time: '09:00', tzOffsetMin: -300 }); // starts 14:00 UTC
    // identical wall clocks, thirteen hours apart
    expect(unplannedGapMinutes(jst, est, DAY, JAPAN)).toBe(780);
  });
});

describe('unplannedGapsByItemId', () => {
  // The shipped Dec 20 day, in its stored order, with a 16:30 row appended the way `crud.ts`
  // appends one. Stored order is then not chronological.
  const dec20 = [
    item({ id: 'j2-1', time: '09:30', duration: '2h' }),
    item({ id: 'j2-2', time: '12:00', duration: '1h' }),
    item({ id: 'j2-3', time: '13:30', duration: '2.5h' }),
    item({ id: 'j2-4', time: '18:00', duration: '1.5h' }),
    item({ id: 'j2-5', time: '21:00', duration: '3h' }),
  ];

  it('states the 16:00–18:00 hole while nothing fills it', () => {
    expect([...unplannedGapsByItemId(dec20, DAY, JAPAN)]).toEqual([
      ['j2-4', 120],
      ['j2-5', 90],
    ]);
  });

  it('drops that hole once an appended row fills it, wherever the row is stored', () => {
    const appended = [...dec20, item({ id: 'new', time: '16:30', duration: '1h' })];
    expect([...unplannedGapsByItemId(appended, DAY, JAPAN)]).toEqual([['j2-5', 90]]);
  });

  it('untimed rows sink and state nothing', () => {
    const withIdea = [item({ id: 'idea' }), ...dec20];
    expect([...unplannedGapsByItemId(withIdea, DAY, JAPAN)]).toEqual([
      ['j2-4', 120],
      ['j2-5', 90],
    ]);
  });

  it('measures a mixed-zone day on the instant', () => {
    // The shipped Jan 9 flight home: two Detroit rows (-300) stored after the Tokyo departure
    // they follow, so their wall clocks read backwards against it.
    const jan9 = [
      item({ id: 'j22-1', time: '09:00', duration: '1.5h' }),
      item({ id: 'j22-2', time: '11:00', duration: '1.5h' }),
      item({ id: 'j22-3', time: '13:00', duration: '2h' }),
      item({ id: 'j22-4', time: '17:35', duration: '12h' }),
      item({ id: 'j22-5', time: '15:35', duration: '6h', tzOffsetMin: -300 }),
      item({ id: 'j22-6', time: '21:35', duration: '1h 23m', tzOffsetMin: -300 }),
    ];
    // The flight and the layover it produces butt up exactly, and so do the layover and the
    // final hop: no rule on either, and the only hole is the 2h35m before the long-haul.
    expect([...unplannedGapsByItemId(jan9, '2027-01-09', JAPAN)]).toEqual([['j22-4', 155]]);
  });
});
