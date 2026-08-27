import { describe, it, expect } from 'vitest';
import { UNPLANNED_FLOOR_MIN, unplannedGapMinutes } from '@/lib/unplanned-gap';
import type { ItineraryItem } from '@/lib/trip-data';

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
    expect(unplannedGapMinutes(prev, next)).toBe(120);
  });

  it('holds the floor: anything under it is the walk between two things', () => {
    const prev = item({ startMinutes: 540, durationMinutes: 60 });
    expect(unplannedGapMinutes(prev, item({ startMinutes: 600 + UNPLANNED_FLOOR_MIN }))).toBe(
      UNPLANNED_FLOOR_MIN,
    );
    expect(unplannedGapMinutes(prev, item({ startMinutes: 600 + UNPLANNED_FLOOR_MIN - 1 }))).toBeNull();
  });

  it('yields nothing without both starts, without a span, or backwards', () => {
    const timedWithSpan = item({ startMinutes: 540, durationMinutes: 60 });
    expect(unplannedGapMinutes(undefined, timedWithSpan)).toBeNull();
    expect(unplannedGapMinutes(timedWithSpan, undefined)).toBeNull();
    // earlier row has no END, so the interval would be measured from the wrong point
    expect(unplannedGapMinutes(item({ startMinutes: 540 }), item({ startMinutes: 900 }))).toBeNull();
    // later row is untimed
    expect(unplannedGapMinutes(timedWithSpan, item({}))).toBeNull();
    // backwards pair — that is an overlap, flagged elsewhere
    expect(unplannedGapMinutes(item({ startMinutes: 900, durationMinutes: 60 }), item({ startMinutes: 540 }))).toBeNull();
  });

  it('falls back to the legacy free-text fields', () => {
    const prev = item({ time: '9:00 AM', duration: '1h' });
    expect(unplannedGapMinutes(prev, item({ time: '12:00 PM' }))).toBe(120);
  });
});
