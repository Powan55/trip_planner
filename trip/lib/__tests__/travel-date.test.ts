import { describe, it, expect } from 'vitest';

import { resolveTravelDate } from '@/lib/travel-date';
import { TRIP_DATES, TRIP_START } from '@/core/dates';

// S187 (D-164 LOCKED): `resolveTravelDate` is the PURE bounds/composition brain behind the
// Travel Mode `?date=` picker. `TRIP_START` = local midnight Dec 9 (see core/dates/trip-dates.ts).
const DEC9 = TRIP_DATES[0]; // '2026-12-09'
const DEC18 = '2026-12-18'; // last Nepal day (leg boundary)
const DEC19 = '2026-12-19'; // first Japan day (leg boundary)
const JAN9 = TRIP_DATES[TRIP_DATES.length - 1]; // '2027-01-09'

// A safely mid-trip "now" instant, used whenever the branch under test doesn't care about it.
const MID_TRIP_NOW = new Date('2026-12-15T12:00:00');

describe('resolveTravelDate', () => {
  it('a valid in-range `?date=` wins outright, regardless of today', () => {
    const r = resolveTravelDate({ dateParam: DEC18, todayDate: DEC9, now: MID_TRIP_NOW });
    expect(r).toMatchObject({ date: DEC18, outOfRange: false, isPreview: true, isPreTripDefault: false });
  });

  it('a valid `?date=` equal to today is NOT a preview', () => {
    const r = resolveTravelDate({ dateParam: DEC9, todayDate: DEC9, now: MID_TRIP_NOW });
    expect(r).toMatchObject({ date: DEC9, isPreview: false });
  });

  it('the Dec 18 / Dec 19 leg boundary both resolve as ordinary in-range days', () => {
    expect(resolveTravelDate({ dateParam: DEC18, todayDate: null, now: MID_TRIP_NOW }).date).toBe(DEC18);
    expect(resolveTravelDate({ dateParam: DEC19, todayDate: null, now: MID_TRIP_NOW }).date).toBe(DEC19);
  });

  it('malformed `?date=` → outOfRange, not a crash', () => {
    const r = resolveTravelDate({ dateParam: 'not-a-date', todayDate: DEC9, now: MID_TRIP_NOW });
    expect(r).toMatchObject({ date: null, outOfRange: true, isPreview: false });
  });

  it('a well-formed but out-of-window `?date=` → outOfRange', () => {
    expect(resolveTravelDate({ dateParam: '2026-12-08', todayDate: DEC9, now: MID_TRIP_NOW }).outOfRange).toBe(true);
    expect(resolveTravelDate({ dateParam: '2027-01-10', todayDate: DEC9, now: MID_TRIP_NOW }).outOfRange).toBe(true);
  });

  it('boundary dates Dec 9 and Jan 9 themselves are IN range', () => {
    expect(resolveTravelDate({ dateParam: DEC9, todayDate: null, now: MID_TRIP_NOW }).outOfRange).toBe(false);
    expect(resolveTravelDate({ dateParam: JAN9, todayDate: null, now: MID_TRIP_NOW }).outOfRange).toBe(false);
  });

  it('no `?date=`, on-trip → the default FOLLOWS the (possibly simulated) today', () => {
    const r = resolveTravelDate({ dateParam: null, todayDate: DEC18, now: MID_TRIP_NOW });
    expect(r).toMatchObject({ date: DEC18, isPreview: false, isPreTripDefault: false });
  });

  it('no `?date=`, pre-trip → Day 1 default + a positive daysUntilStart', () => {
    const twoDaysBefore = new Date(TRIP_START.getTime() - 2 * 86400000);
    const r = resolveTravelDate({ dateParam: null, todayDate: null, now: twoDaysBefore });
    expect(r.date).toBe(DEC9);
    expect(r.isPreTripDefault).toBe(true);
    expect(r.daysUntilStart).toBe(2);
    expect(r.outOfRange).toBe(false);
  });

  it('no `?date=`, pre-trip with <24h left → daysUntilStart is still 1, not 0 (A-23)', () => {
    const oneHourBefore = new Date(TRIP_START.getTime() - 60 * 60 * 1000);
    const r = resolveTravelDate({ dateParam: null, todayDate: null, now: oneHourBefore });
    expect(r.date).toBe(DEC9);
    expect(r.isPreTripDefault).toBe(true);
    expect(r.daysUntilStart).toBe(1);
    expect(r.outOfRange).toBe(false);
  });

  it('no `?date=`, post-trip (off-trip, not pre-trip) → null, not an error', () => {
    const afterTrip = new Date('2027-02-01T12:00:00');
    const r = resolveTravelDate({ dateParam: null, todayDate: null, now: afterTrip });
    expect(r).toMatchObject({ date: null, outOfRange: false, isPreview: false, isPreTripDefault: false });
  });

  it('both `?date=` and a (simulated) today set → `?date=` picks the day (D-164)', () => {
    const r = resolveTravelDate({ dateParam: DEC19, todayDate: DEC9, now: MID_TRIP_NOW });
    expect(r.date).toBe(DEC19);
    expect(r.isPreview).toBe(true);
  });
});
