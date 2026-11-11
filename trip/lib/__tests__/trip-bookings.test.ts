import { describe, it, expect } from 'vitest';
import { selectTripBookings } from '@/lib/trip-bookings';
import type { ItineraryItem } from '@/lib/trip-data';

const mk = (id: string, category: ItineraryItem['category'], extra: Partial<ItineraryItem> = {}): ItineraryItem => ({
  id,
  title: id,
  category,
  ...extra,
});

describe('selectTripBookings', () => {
  const plan: Record<string, ItineraryItem[]> = {
    '2026-12-02': [mk('walk', 'sightseeing'), mk('stay', 'hotel', { startMinutes: 900 })],
    '2026-12-01': [
      mk('late', 'transportation', { startMinutes: 1200 }),
      mk('gone', 'transportation', { deleted: true }),
      mk('early', 'transportation', { startMinutes: 360 }),
    ],
  };

  it('keeps only live travel and hotel items, ordered by date then time', () => {
    const got = selectTripBookings((d) => plan[d] ?? [], ['2026-12-02', '2026-12-01', '2026-12-03']);
    expect(got.map((b) => b.item.id)).toEqual(['early', 'late', 'stay']);
    expect(got.map((b) => b.date)).toEqual(['2026-12-01', '2026-12-01', '2026-12-02']);
  });
});
