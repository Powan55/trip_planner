import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TRIP_ID,
  TRIP_PACKS,
  getTripConfig,
  getActiveTrip,
  legForDate,
} from '@/core/trips';
import {
  TRIP_START,
  TRIP_END,
  NEPAL_START,
  NEPAL_END,
  JAPAN_START,
  JAPAN_END,
} from '@/core/dates';
import { NPT_OFFSET_MIN, JST_OFFSET_MIN } from '@/core/dates/item-time';

// S181 — the trip-pack model + its derivation of the date backbone. Two jobs:
//  (1) pack-shape invariants (a malformed pack is caught here, not at runtime), and
//  (2) explicit PARITY assertions: every legacy constant deep-equals the value the pack now
//      derives, freezing byte-identity independently of the FU-10/S82 facade suites.

const DEFAULT = TRIP_PACKS[DEFAULT_TRIP_ID];

// Next calendar day of an ISO 'YYYY-MM-DD' via UTC arithmetic (TZ-independent).
function nextDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().split('T')[0];
}

describe('default pack shape', () => {
  it('id is the grandfathered slug and === the registry/firebase convention (D-172)', () => {
    expect(DEFAULT_TRIP_ID).toBe('nepal-japan-2026');
    expect(DEFAULT.id).toBe('nepal-japan-2026');
  });

  it('has exactly the two legacy legs, ids nepal then japan (persisted-bytes contract)', () => {
    expect(DEFAULT.legs.map((l) => l.id)).toEqual(['nepal', 'japan']);
  });

  it('trip span brackets the legs: start === legs[0].start, end === legs.at(-1).end', () => {
    expect(DEFAULT.start).toBe(DEFAULT.legs[0].start);
    expect(DEFAULT.end).toBe(DEFAULT.legs[DEFAULT.legs.length - 1].end);
  });

  it('legs are contiguous & non-overlapping: leg[i].end + 1 day === leg[i+1].start', () => {
    for (let i = 0; i < DEFAULT.legs.length - 1; i++) {
      expect(nextDay(DEFAULT.legs[i].end)).toBe(DEFAULT.legs[i + 1].start);
      expect(DEFAULT.legs[i].start <= DEFAULT.legs[i].end).toBe(true);
    }
  });

  it('carries the currency / offset / fallback fields the backbone derives from', () => {
    expect(DEFAULT.legs).toEqual([
      expect.objectContaining({ currency: 'NPR', utcOffsetMin: 345, fallbackCity: 'Kathmandu' }),
      expect.objectContaining({ currency: 'JPY', utcOffsetMin: 540, fallbackCity: 'Tokyo' }),
    ]);
  });
});

describe('registry resolution (total, never-throw)', () => {
  it('getTripConfig(unknown) falls back to the default pack', () => {
    expect(getTripConfig('does-not-exist')).toBe(DEFAULT);
  });
  it('getActiveTrip() returns the default pack (S181: hardcoded until S183)', () => {
    expect(getActiveTrip()).toBe(DEFAULT);
  });
});

describe('legForDate — lexicographic, TZ-safe, total (mirrors getCountryForDate)', () => {
  it('B-01 boundary: 2026-12-18 -> nepal, 2026-12-19 -> japan', () => {
    expect(legForDate(DEFAULT, '2026-12-18').id).toBe('nepal');
    expect(legForDate(DEFAULT, '2026-12-19').id).toBe('japan');
  });
  it('clamps before the first leg to the first leg', () => {
    expect(legForDate(DEFAULT, '2020-01-01').id).toBe('nepal');
  });
  it('clamps on/after the last leg end to the last leg', () => {
    expect(legForDate(DEFAULT, '2027-01-09').id).toBe('japan');
    expect(legForDate(DEFAULT, '2030-06-01').id).toBe('japan');
  });
});

describe('PARITY — derived date backbone byte-equals the pre-S181 literals', () => {
  it('trip/leg Date constants deep-equal the old hardcoded values', () => {
    expect(TRIP_START).toEqual(new Date('2026-12-09T00:00:00'));
    expect(TRIP_END).toEqual(new Date('2027-01-09T23:59:59'));
    expect(NEPAL_START).toEqual(new Date('2026-12-09T00:00:00'));
    expect(NEPAL_END).toEqual(new Date('2026-12-18T23:59:59'));
    expect(JAPAN_START).toEqual(new Date('2026-12-19T00:00:00'));
    expect(JAPAN_END).toEqual(new Date('2027-01-09T23:59:59'));
  });
  it('item-time offset constants deep-equal 345 / 540 (D-137)', () => {
    expect(NPT_OFFSET_MIN).toBe(345);
    expect(JST_OFFSET_MIN).toBe(540);
  });
});
