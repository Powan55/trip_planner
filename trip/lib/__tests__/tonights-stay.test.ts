import { describe, it, expect } from 'vitest';
import { selectTonightsStay, stayName } from '@/lib/tonights-stay';
import type { ItineraryItem } from '@/lib/trip-data';

const hotel = (id: string, title: string, startMinutes?: number, extra: Partial<ItineraryItem> = {}): ItineraryItem => ({
  id,
  title,
  category: 'hotel',
  ...(startMinutes === undefined ? {} : { startMinutes }),
  ...extra,
});

const DATES = ['2026-12-09', '2026-12-10', '2026-12-11', '2026-12-12'];

function pick(plan: Record<string, ItineraryItem[]>, today: string) {
  return selectTonightsStay((d) => plan[d] ?? [], DATES, today)?.id ?? null;
}

describe('selectTonightsStay', () => {
  const plan = {
    '2026-12-09': [hotel('a', 'Check in to the Thamel hotel', 18 * 60)],
    '2026-12-11': [
      hotel('in-b', 'Check in to the Lake hotel', 14 * 60),
      hotel('out-a', 'Check out of the Thamel hotel', 10 * 60),
    ],
    '2026-12-12': [hotel('out-b', 'Check out of the Lake hotel', 10 * 60)],
  };

  it('carries a check-in across the nights after it', () => {
    expect(pick(plan, '2026-12-09')).toBe('a');
    expect(pick(plan, '2026-12-10')).toBe('a');
  });

  it('switches hotel on a change-over day regardless of stored order', () => {
    expect(pick(plan, '2026-12-11')).toBe('in-b');
  });

  it('is empty after a check-out with no later check-in', () => {
    expect(pick(plan, '2026-12-12')).toBeNull();
  });

  it('is empty before the first check-in and ignores non-hotel and deleted items', () => {
    const p = {
      '2026-12-10': [
        { id: 'x', title: 'Dinner', category: 'food' } as ItineraryItem,
        hotel('gone', 'Check in to a ghost hotel', 600, { deleted: true }),
      ],
    };
    expect(pick(p, '2026-12-10')).toBeNull();
  });

  it('lapses after an endDate', () => {
    const p = { '2026-12-09': [hotel('s', 'Hotel Sakura', 900, { endDate: '2026-12-10' })] };
    expect(pick(p, '2026-12-10')).toBe('s');
    expect(pick(p, '2026-12-11')).toBeNull();
  });
});

describe('stayName', () => {
  it('drops the check-in verb only', () => {
    expect(stayName(hotel('a', 'Check in to the Thamel hotel'))).toBe('the Thamel hotel');
    expect(stayName(hotel('b', 'Hotel Sakura'))).toBe('Hotel Sakura');
  });
});
