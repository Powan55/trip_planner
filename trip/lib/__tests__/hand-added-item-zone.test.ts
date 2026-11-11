import { describe, it, expect } from 'vitest';
import { dayZoneOffsetMin, offsetForCountry, placeWallClockToUtcMs } from '@/core/dates';
import { TRIP_ITINERARY } from '@/core/content/itinerary';
import { nextUp } from '@/lib/whats-next';
import { firstClashWith, sortItemsByTime } from '@/lib/sort-items-by-time';
import { deriveRowPhases, deriveTravelHero } from '@/lib/travel-hero';
import type { ItineraryItem } from '@/lib/trip-data';

// #1120: hand-added items carry no tzOffsetMin. On Dec 9 every seeded row is New York time
// (EST) while the day's leg is Nepal (+5:45), so a hand-added row there was read 10h45m off.

const day = (date: string) => TRIP_ITINERARY.find((d) => d.date === date)!;
const own = (fields: Partial<ItineraryItem>): ItineraryItem => ({
  id: 'mine',
  title: 'Mine',
  category: 'food',
  ...fields,
});

const dec9 = day('2026-12-09');
const DEC9_LEG = offsetForCountry(dec9.country); // 345, NPT

describe('#1120 — a hand-added item on a cross-zone day', () => {
  it('next-up ranks a JFK breakfast at New York time, not Kathmandu time', () => {
    const breakfast = own({ startMinutes: 6 * 60 + 30 }); // 06:30 at JFK
    const nowUtcMs = Date.UTC(2026, 11, 9, 11, 0); // 06:00 EST
    const next = nextUp([...dec9.items, breakfast], {
      dayDate: dec9.date,
      placeOffsetMin: DEC9_LEG,
      nowUtcMs,
    });
    expect(next?.id).toBe('mine');
  });

  it('the overlap guard sees a coffee inside the JFK layover', () => {
    const coffee = own({ startMinutes: 8 * 60, durationMinutes: 60 }); // 08:00–09:00 at JFK
    expect(firstClashWith(coffee, dec9.items, dec9.date, DEC9_LEG)?.id).toBe('n1-2');
  });

  it('a Tokyo morning on the Jan 9 return day stays Japan time (+9)', () => {
    const jan9 = day('2027-01-09');
    const shop = own({ startMinutes: 12 * 60 + 30, durationMinutes: 30 }); // after j22-2 ends
    const leg = offsetForCountry(jan9.country);
    expect(leg).toBe(540);
    expect(firstClashWith(shop, jan9.items, jan9.date, leg)).toBeUndefined();
    const next = nextUp([...jan9.items, shop], {
      dayDate: jan9.date,
      placeOffsetMin: leg,
      nowUtcMs: placeWallClockToUtcMs(jan9.date, 12 * 60, 540),
    });
    expect(next?.id).toBe('mine');
  });

  it('a filtered view keeps the zone of the full day (filter = mine on Dec 9)', () => {
    const mine = own({ startMinutes: 8 * 60, durationMinutes: 60 });
    const zone = dayZoneOffsetMin([...dec9.items, mine], dec9.date, DEC9_LEG);
    expect(zone).toBe(-300);
    // The bug: resolving over the visible subset alone falls back to Nepal time.
    expect(dayZoneOffsetMin([mine], dec9.date, DEC9_LEG)).toBe(DEC9_LEG);
    // The helpers re-resolve internally; fed the full-day zone, they must not flip back.
    expect(dayZoneOffsetMin([mine], dec9.date, zone)).toBe(-300);
    expect(sortItemsByTime([mine], dec9.date, zone)).toEqual([mine]);
  });

  it('hero next-up during the JFK→DEL flight agrees with the row phases', () => {
    const late = own({ startMinutes: 23 * 60 }); // 23:00 EST, while n1-3 is in the air
    const items = [...dec9.items, late];
    const ctx = { dayDate: dec9.date, placeOffsetMin: DEC9_LEG, nowUtcMs: Date.UTC(2026, 11, 9, 18, 0) };
    const hero = deriveTravelHero(items, ctx);
    expect(hero.current?.id).toBe('n1-3');
    expect(hero.next?.id).toBe('mine');
    expect(deriveRowPhases(items, ctx)[items.length - 1]).toBe('upcoming');
  });

  it('no seeded unzoned row changes zone: only Dec 9 moves, and it holds none', () => {
    const moved = TRIP_ITINERARY.filter((d) => {
      const leg = offsetForCountry(d.country);
      return dayZoneOffsetMin(d.items, d.date, leg) !== leg;
    });
    expect(moved.map((d) => d.date)).toEqual(['2026-12-09']);
    expect(dec9.items.every((i) => typeof i.tzOffsetMin === 'number')).toBe(true);
    expect(dayZoneOffsetMin(dec9.items, dec9.date, DEC9_LEG)).toBe(-300);
  });

  it('a zoned row ending exactly at the leg midnight (+5:45) does not move the day', () => {
    // 18:15 UTC = 00:00 NPT the next day. Half-open, so the row has ended by then.
    const zoned = own({ id: 'z', startMinutes: 9 * 60 + 15, durationMinutes: 4 * 60, tzOffsetMin: -300 });
    const mine = own({ startMinutes: 9 * 60, durationMinutes: 60 }); // 09:00 NPT = 03:15 UTC
    expect(firstClashWith(mine, [zoned], '2026-12-12', 345)).toBeUndefined();
    const crossing = { ...zoned, durationMinutes: 4 * 60 + 1 };
    // Now the EST row runs past NPT midnight, so 09:00 reads as EST and lands inside it.
    expect(firstClashWith(mine, [crossing], '2026-12-12', 345)?.id).toBe('z');
  });
});
