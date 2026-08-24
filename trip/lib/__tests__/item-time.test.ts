import { describe, it, expect, vi } from 'vitest';

// S124 — the ONE core time module (matrix item 11; D-137/D-139/D-140).
// Pure math, framework-free — lands GREEN before the migration consumes `parseTimeString`.

import {
  NPT_OFFSET_MIN,
  JST_OFFSET_MIN,
  offsetForCountry,
  declaredOffsetForCountry,
  effectiveOffsetMin,
  parseTimeString,
  effectiveStartMinutes,
  formatTimeAmPm,
  placeWallClockToUtcMs,
  formatHomeClock,
} from '@/core/dates';
import { TRIP_ITINERARY } from '@/core/content/itinerary';
import type { ItineraryItem } from '@/lib/trip-data';
import { setActiveTripId } from '@/core/storage/gateway';
import { setTripConfig, type TripConfigBlock } from '@/core/trips/registry';

function mk(fields: Partial<ItineraryItem>): ItineraryItem {
  return { id: 'x', title: 'X', category: 'sightseeing', ...fields };
}

describe('parseTimeString — the exact best-effort format table', () => {
  // Every PARSEABLE example from the table (matrix item 2).
  const PARSEABLE: Array<[string, number]> = [
    ['06:00', 360],
    ['6:00', 360],
    ['23:59', 1439],
    ['14.30', 870],
    ['2pm', 840],
    ['2:15 PM', 855],
    ['12am', 0],
    ['12pm', 720],
    ['12:30 p.m.', 750],
    ['05:45', 345], // the NPT-boundary value exists as real data
    // extra shape coverage
    ['00:00', 0],
    ['2 pm', 840],
    ['12:00 AM', 0],
    ['11:59 pm', 1439],
    ['  6:00  ', 360], // trimmed
    ['9.05', 545],
  ];
  it.each(PARSEABLE)('parses %j → %i', (raw, mins) => {
    expect(parseTimeString(raw)).toBe(mins);
  });

  // Everything else → undefined (matrix item 3).
  const UNPARSEABLE = [
    '2pm-ish',
    'morning',
    '14:00-16:00',
    '1430',
    '14',
    '24:00',
    '12:60',
    '0pm',
    '13pm',
    '',
    '   ',
    '2:5 pm', // minute must be 2 digits
    'noon',
    undefined, // total on a non-string too (migration runs on raw payload, pre-Zod)
  ];
  it.each(UNPARSEABLE)('rejects %j → undefined', (raw) => {
    expect(parseTimeString(raw as string)).toBeUndefined();
  });
});

describe('effectiveStartMinutes — the ONE range-validation point (D-138)', () => {
  it('uses a valid integer startMinutes in 0–1439', () => {
    expect(effectiveStartMinutes(mk({ startMinutes: 480 }))).toBe(480);
    expect(effectiveStartMinutes(mk({ startMinutes: 0 }))).toBe(0);
    expect(effectiveStartMinutes(mk({ startMinutes: 1439 }))).toBe(1439);
  });

  it('falls through to parsing legacy `time` when startMinutes is out-of-range / non-integer', () => {
    expect(effectiveStartMinutes(mk({ startMinutes: 1440, time: '06:00' }))).toBe(360);
    expect(effectiveStartMinutes(mk({ startMinutes: -1, time: '06:00' }))).toBe(360);
    expect(effectiveStartMinutes(mk({ startMinutes: 12.5, time: '06:00' }))).toBe(360);
    // out-of-range startMinutes AND no parseable time ⇒ untimed
    expect(effectiveStartMinutes(mk({ startMinutes: 9999 }))).toBeUndefined();
  });

  it('parses legacy `time` when there is no startMinutes; undefined when neither is usable', () => {
    expect(effectiveStartMinutes(mk({ time: '2pm' }))).toBe(840);
    expect(effectiveStartMinutes(mk({ time: 'morning' }))).toBeUndefined();
    expect(effectiveStartMinutes(mk({}))).toBeUndefined();
  });
});

describe('formatTimeAmPm', () => {
  it.each([
    [0, '12:00 AM'],
    [720, '12:00 PM'],
    [855, '2:15 PM'],
    [360, '6:00 AM'],
    [1439, '11:59 PM'],
    [345, '5:45 AM'],
  ])('formats %i → %j', (mins, out) => {
    expect(formatTimeAmPm(mins)).toBe(out);
  });
});

describe('offset constants + offsetForCountry', () => {
  it('NPT = +345, JST = +540', () => {
    expect(NPT_OFFSET_MIN).toBe(345);
    expect(JST_OFFSET_MIN).toBe(540);
  });
  it('country → offset', () => {
    expect(offsetForCountry('nepal')).toBe(345);
    expect(offsetForCountry('japan')).toBe(540);
  });
  // #243 — with real geography the declared and the math resolver agree exactly, so the default
  // pack cannot notice the split. (Runs before the A-8 block below, which points the module-load
  // capture at a custom pack.)
  it('declaredOffsetForCountry matches it on the default pack, unknown id included', () => {
    expect(declaredOffsetForCountry('nepal')).toBe(345);
    expect(declaredOffsetForCountry('japan')).toBe(540);
    expect(declaredOffsetForCountry('atlantis')).toBe(NPT_OFFSET_MIN);
  });
});

// A-8 — a custom trip's single leg carries the "unknown geography" placeholder
// `utcOffsetMin: 0` (core/trips/custom.ts). `hasRealGeography`/`offsetForCountry` are captured
// at MODULE LOAD from the active pack (core/dates/item-time.ts), so this sets the active-trip
// pointer/config FIRST, then `vi.resetModules()` + dynamic-imports the module — the same
// technique lib/__tests__/leg-label.test.ts and trip-cities-scoped.test.ts use for other
// module-load-captured state derived from the active pack.
describe('offsetForCountry — custom-trip fallback when no leg has real geography (A-8)', () => {
  const NO_TZ: TripConfigBlock = {
    start: '2027-03-01',
    end: '2027-03-05',
    destinations: ['Nowhere'],
    vibe: 'city',
    currency: 'USD',
    updatedAt: 1000,
  };

  it('falls back to the device offset, not 0, when every leg is the placeholder', async () => {
    localStorage.clear();
    sessionStorage.clear();
    setActiveTripId('custom-notz');
    setTripConfig('custom-notz', NO_TZ);

    vi.resetModules();
    const { offsetForCountry: freshOffsetForCountry } = await import('@/core/dates/item-time');

    expect(freshOffsetForCountry('main')).toBe(-new Date().getTimezoneOffset());
    expect(freshOffsetForCountry('main')).not.toBe(0);
  });

  // #243 — the same pack, the other question. Instant math needs an anchor and takes the device
  // offset above; an ASSERTION (the zone badge) must never, so it reads the leg's DECLARED value.
  // That is the placeholder 0, which has no `ZONE_ABBREV_BY_OFFSET` entry ⇒ no badge.
  it('declaredOffsetForCountry returns the leg placeholder 0 — no device substitution', async () => {
    localStorage.clear();
    sessionStorage.clear();
    setActiveTripId('custom-notz');
    setTripConfig('custom-notz', NO_TZ);

    vi.resetModules();
    const {
      declaredOffsetForCountry: freshDeclared,
      offsetForCountry: freshOffsetForCountry,
      zoneAbbrevForOffset: freshZoneAbbrev,
    } = await import('@/core/dates/item-time');

    expect(freshDeclared('main')).toBe(0);
    expect(freshZoneAbbrev(freshDeclared('main'))).toBeNull();
    // The two resolvers now differ on this pack, which is the whole point — the badge must not
    // inherit the anchor the instant math needs. (TZ is pinned to America/New_York, never UTC+0.)
    expect(freshDeclared('main')).not.toBe(freshOffsetForCountry('main'));
  });
});

describe('effectiveOffsetMin — per-item place-offset override (S275)', () => {
  it('falls back to the day offset when tzOffsetMin is absent (byte-identical default)', () => {
    expect(effectiveOffsetMin(mk({}), JST_OFFSET_MIN)).toBe(JST_OFFSET_MIN);
    expect(effectiveOffsetMin(mk({}), NPT_OFFSET_MIN)).toBe(NPT_OFFSET_MIN);
  });

  it('uses the item override when present, ignoring the day offset', () => {
    expect(effectiveOffsetMin(mk({ tzOffsetMin: 480 }), JST_OFFSET_MIN)).toBe(480);
  });

  it('S275 regression — the Dec-19 Guangzhou layover items compute at +480 (CAN), not +540 (JST)', () => {
    const dec19 = TRIP_ITINERARY.find((d) => d.date === '2026-12-19')!;
    expect(dec19.country).toBe('japan'); // the day itself IS a Japan day (D-137 badge stays JST)
    const j1_1 = dec19.items.find((i) => i.id === 'j1-1')!;
    const j1_2 = dec19.items.find((i) => i.id === 'j1-2')!;

    const dayOffset = offsetForCountry(dec19.country); // 540 (JST) — what it'd wrongly use pre-fix
    const startMin1 = effectiveStartMinutes(j1_1)!; // 355 (05:55)
    const startMin2 = effectiveStartMinutes(j1_2)!; // 530 (08:50)

    const correctMs1 = placeWallClockToUtcMs(dec19.date, startMin1, effectiveOffsetMin(j1_1, dayOffset));
    const wrongMs1 = placeWallClockToUtcMs(dec19.date, startMin1, dayOffset);
    expect(j1_1.tzOffsetMin).toBe(480);
    expect(correctMs1).toBe(Date.UTC(2026, 11, 18, 21, 55)); // 05:55 CAN (+480) → 21:55 UTC Dec-18
    expect(correctMs1).not.toBe(wrongMs1);
    expect((correctMs1 - wrongMs1) / 60000).toBe(60); // the pre-fix (JST) instant was 1h early

    const correctMs2 = placeWallClockToUtcMs(dec19.date, startMin2, effectiveOffsetMin(j1_2, dayOffset));
    expect(j1_2.tzOffsetMin).toBe(480);
    expect(correctMs2).toBe(Date.UTC(2026, 11, 19, 0, 50)); // 08:50 CAN (+480) → 00:50 UTC Dec-19
  });

  it('S275 — every OTHER Dec-19 item is untouched (no tzOffsetMin, still uses the day/JST offset)', () => {
    const dec19 = TRIP_ITINERARY.find((d) => d.date === '2026-12-19')!;
    const others = dec19.items.filter((i) => i.id !== 'j1-1' && i.id !== 'j1-2');
    expect(others.length).toBeGreaterThan(0);
    for (const item of others) {
      expect(item.tzOffsetMin).toBeUndefined();
      expect(effectiveOffsetMin(item, JST_OFFSET_MIN)).toBe(JST_OFFSET_MIN);
    }
  });
});

describe('placeWallClockToUtcMs — B-01-safe field arithmetic (matrix item 11)', () => {
  it('the NPT :45 boundary — 05:45 NPT is EXACTLY midnight UTC on the same date', () => {
    expect(placeWallClockToUtcMs('2026-12-10', 345, NPT_OFFSET_MIN)).toBe(
      Date.UTC(2026, 11, 10, 0, 0),
    );
  });

  it('noon NPT = 12:00 − 5:45 = 06:15 UTC', () => {
    expect(placeWallClockToUtcMs('2026-12-10', 720, NPT_OFFSET_MIN)).toBe(
      Date.UTC(2026, 11, 10, 6, 15),
    );
  });

  it('the same wall-clock minutes on the same date differ NPT-vs-JST by exactly 195 min', () => {
    const npt = placeWallClockToUtcMs('2026-12-19', 600, NPT_OFFSET_MIN);
    const jst = placeWallClockToUtcMs('2026-12-19', 600, JST_OFFSET_MIN);
    expect((npt - jst) / 60000).toBe(JST_OFFSET_MIN - NPT_OFFSET_MIN); // 195
  });

  it('is deterministic regardless of host TZ (no new Date(string), pure Date.UTC)', () => {
    // A midnight-UTC edge that a `new Date("YYYY-MM-DD")` at a negative offset would slip a day.
    expect(placeWallClockToUtcMs('2026-12-10', 0, 0)).toBe(Date.UTC(2026, 11, 10, 0, 0));
  });
});

// S391: the `isPastAtPlace` describe block is DELETED along with the function. It was
// the helper's ONLY caller tree-wide — six assertions keeping a one-line wrapper alive after
// S377 inlined it. The strictness they pinned (an item exactly AT "now" is still upcoming) is
// covered where the behaviour actually lives now: `lib/__tests__/whats-next.test.ts`.

// ── #220 — the home clock ────────────────────────────────────────────────────────────────────
// Substring assertions, not equality: the exact spacing/order of an `Intl` output is the
// runtime's ICU data, not ours (the same reason `lib/__tests__/trip-data.test.ts` asserts by
// substring). What is load-bearing is the HOUR, and that it tracks DST.
describe('formatHomeClock — US Eastern via Intl, DST resolved per instant', () => {
  it('winter instant reads EST (UTC-5)', () => {
    const s = formatHomeClock(new Date('2026-12-12T12:00:00Z'))!;
    expect(s).toContain('7:00'); // 12:00Z − 5h
    expect(s).toContain('AM');
    expect(s).toContain('Sat');
  });

  it('summer instant reads EDT (UTC-4) — the case a fixed -300 offset gets wrong', () => {
    // ZONE_ABBREV_BY_OFFSET's -300/EST row is documented December-and-January-only. A home clock
    // is read year-round, months before departure, so it cannot be built on that offset.
    expect(formatHomeClock(new Date('2026-08-24T12:00:00Z'))).toContain('8:00'); // 12:00Z − 4h
  });

  it('carries the weekday, because home is routinely still yesterday', () => {
    // Sunday 08:15 in Kathmandu (UTC+5:45) is Saturday evening at home — the whole point of
    // showing this before dialling.
    const s = formatHomeClock(new Date('2026-12-13T02:30:00Z'))!;
    expect(s).toContain('Sat');
    expect(s).toContain('9:30');
    expect(s).toContain('PM');
  });

  it('is total — an Intl build with no zone data yields null, never a wrong time', () => {
    vi.stubGlobal('Intl', {
      DateTimeFormat: () => {
        throw new RangeError('Invalid time zone specified: America/New_York');
      },
    });
    expect(formatHomeClock(new Date('2026-12-12T12:00:00Z'))).toBeNull();
    vi.unstubAllGlobals();
  });
});
