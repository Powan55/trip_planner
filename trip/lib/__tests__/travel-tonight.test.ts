import { describe, it, expect } from 'vitest';

// S245 — the Travel Mode "Tonight" emphasis PURE item selector. `selectTonightItem(items, now)`
// is PURE (D-016 idiom, matches travel-hero.test.ts): the caller injects place-local
// minutes-since-midnight, so every case is deterministic here with no time mocking.

import { selectTonightItem, EVENING_START_MIN } from '@/lib/travel-tonight';
import type { ItineraryItem, ItineraryCategory } from '@/lib/trip-data';

function item(
  startMin: number | undefined,
  opts: { id?: string; title?: string; done?: boolean; category?: ItineraryCategory } = {},
): ItineraryItem {
  return {
    id: opts.id ?? `i-${startMin ?? 'untimed'}`,
    title: opts.title ?? `Item ${startMin ?? '(untimed)'}`,
    category: opts.category ?? 'sightseeing',
    ...(startMin !== undefined ? { startMinutes: startMin } : {}),
    ...(opts.done !== undefined ? { done: opts.done } : {}),
  };
}

describe('selectTonightItem (S245)', () => {
  it('is 17:00 (1020 minutes)', () => {
    expect(EVENING_START_MIN).toBe(1020);
  });

  it('returns null before 17:00 even with an evening item on the day', () => {
    const items = [item(1260, { title: 'Club night' })]; // 21:00
    expect(selectTonightItem(items, 16 * 60 + 59)).toBeNull();
  });

  it('returns null at 17:00+ when nothing on the day starts at/after 17:00', () => {
    const items = [item(600, { title: 'Morning sightseeing' }), item(780, { title: 'Lunch' })];
    expect(selectTonightItem(items, 18 * 60)).toBeNull();
  });

  it('returns the evening item once local time reaches 17:00', () => {
    const items = [item(600, { title: 'Morning' }), item(1260, { title: 'Club night' })];
    const result = selectTonightItem(items, EVENING_START_MIN);
    expect(result?.title).toBe('Club night');
  });

  it('picks the LATEST-starting qualifying item when several are evening items', () => {
    const items = [
      item(1080, { title: 'Dinner', id: 'a' }), // 18:00
      item(1260, { title: 'Club night', id: 'b' }), // 21:00
    ];
    const result = selectTonightItem(items, 22 * 60);
    expect(result?.id).toBe('b');
  });

  it('skips a done evening item', () => {
    const items = [item(1260, { title: 'Club night', done: true })];
    expect(selectTonightItem(items, 22 * 60)).toBeNull();
  });

  it('skips an untimed item', () => {
    const items = [item(undefined, { title: 'No set time' })];
    expect(selectTonightItem(items, 22 * 60)).toBeNull();
  });
});
