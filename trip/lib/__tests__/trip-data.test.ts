import { describe, it, expect } from 'vitest';
import {
  TRIP_DATES,
  TRIP_DATE_LABEL,
  getCountryForDate,
  formatDate,
  formatDateLong,
} from '../trip-data';

// getCountryForDate is PURE and TZ-independent (B-01 fix, S60): it never parses the
// input with `new Date()` — it lexicographically compares the 'YYYY-MM-DD' string
// against the '2026-12-18' boundary derived from NEPAL_END's local parts. These
// tests freeze that CURRENT, correct behavior forever so a future refactor can't
// silently reintroduce the negative-UTC-offset misclassification bug.

describe('getCountryForDate', () => {
  it('B-01 boundary: 2026-12-18 -> nepal, 2026-12-19 -> japan', () => {
    expect(getCountryForDate('2026-12-18')).toBe('nepal');
    expect(getCountryForDate('2026-12-19')).toBe('japan');
  });

  it('classifies every date in TRIP_DATES: first 10 (12-09..12-18) nepal, remaining 22 (12-19..01-09) japan', () => {
    const nepalDates = TRIP_DATES.slice(0, 10);
    const japanDates = TRIP_DATES.slice(10);
    expect(nepalDates).toEqual([
      '2026-12-09',
      '2026-12-10',
      '2026-12-11',
      '2026-12-12',
      '2026-12-13',
      '2026-12-14',
      '2026-12-15',
      '2026-12-16',
      '2026-12-17',
      '2026-12-18',
    ]);
    expect(japanDates).toEqual([
      '2026-12-19',
      '2026-12-20',
      '2026-12-21',
      '2026-12-22',
      '2026-12-23',
      '2026-12-24',
      '2026-12-25',
      '2026-12-26',
      '2026-12-27',
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
      '2027-01-04',
      '2027-01-05',
      '2027-01-06',
      '2027-01-07',
      '2027-01-08',
      '2027-01-09',
    ]);
    for (const date of nepalDates) {
      expect(getCountryForDate(date)).toBe('nepal');
    }
    for (const date of japanDates) {
      expect(getCountryForDate(date)).toBe('japan');
    }
  });

  it('documents current out-of-window behavior: anything <= 2026-12-18 is nepal, else japan', () => {
    // Pinned as-is (not judged): getCountryForDate has no awareness of the trip
    // window's start/end — it's a pure lexicographic split on the boundary string.
    expect(getCountryForDate('2000-01-01')).toBe('nepal');
    expect(getCountryForDate('2030-06-01')).toBe('japan');
  });
});

describe('TRIP_DATES', () => {
  it('has length 32', () => {
    expect(TRIP_DATES.length).toBe(32);
  });

  it('starts at 2026-12-09 and ends at 2027-01-09', () => {
    expect(TRIP_DATES[0]).toBe('2026-12-09');
    expect(TRIP_DATES[31]).toBe('2027-01-09');
  });

  it('every entry matches the YYYY-MM-DD shape', () => {
    for (const date of TRIP_DATES) {
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('is strictly increasing with no gaps or dupes (each entry is exactly +1 calendar day)', () => {
    for (let i = 1; i < TRIP_DATES.length; i++) {
      const prev = new Date(TRIP_DATES[i - 1] + 'T00:00:00Z');
      const curr = new Date(TRIP_DATES[i] + 'T00:00:00Z');
      const diffDays = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBe(1);
    }
    // No dupes as a corollary of strictly increasing, but assert directly too.
    expect(new Set(TRIP_DATES).size).toBe(TRIP_DATES.length);
  });

  it('splits 10 nepal / 22 japan via getCountryForDate', () => {
    const nepalCount = TRIP_DATES.filter((d) => getCountryForDate(d) === 'nepal').length;
    const japanCount = TRIP_DATES.filter((d) => getCountryForDate(d) === 'japan').length;
    expect(nepalCount).toBe(10);
    expect(japanCount).toBe(22);
  });
});

describe('TRIP_DATE_LABEL', () => {
  it('equals the exact expected label with an en-dash (U+2013) separator', () => {
    expect(TRIP_DATE_LABEL).toBe('December 9, 2026 – January 9, 2027');
    // Spell out the literal too, for readability of intent (same string).
    expect(TRIP_DATE_LABEL).toBe('December 9, 2026 – January 9, 2027');
    expect(TRIP_DATE_LABEL).not.toContain('-'); // no plain hyphen anywhere in the label
    expect(TRIP_DATE_LABEL).toContain('–');
  });
});

// formatDate/formatDateLong anchor the incoming 'YYYY-MM-DD' at T12:00:00 (noon) before
// calling toLocaleDateString('en-US', ...). The noon anchor exists specifically to avoid
// a bare local-midnight parse slipping a day at negative UTC offsets. We assert on
// substrings ('December 9' / '2026') rather than the full formatted string: en-US is
// hardcoded in the implementation so the substrings are deterministic across machines,
// but the exact weekday-name/comma/spacing formatting technically comes from the
// runtime's Intl.DateTimeFormat data. Substring assertions freeze the load-bearing
// claim (no off-by-one day) without over-coupling to Intl's exact punctuation.
describe('formatDate / formatDateLong (noon-anchor, no off-by-one)', () => {
  it('formatDate("2026-12-09") yields the Dec 9 calendar day, not Dec 8', () => {
    const result = formatDate('2026-12-09');
    expect(result).toContain('Dec 9');
    expect(result).not.toContain('Dec 8');
  });

  it('formatDateLong("2026-12-09") yields the December 9 calendar day, not December 8', () => {
    const result = formatDateLong('2026-12-09');
    expect(result).toContain('December 9');
    expect(result).toContain('2026');
    expect(result).not.toContain('December 8');
  });

  it('formatDate holds the noon-anchor across every TRIP_DATES entry (day-of-month never slips)', () => {
    for (const date of TRIP_DATES) {
      const expectedDay = Number(date.slice(8, 10));
      const result = formatDate(date);
      // formatDate uses { day: 'numeric' } so the bare day number appears unpadded.
      expect(result).toContain(String(expectedDay));
    }
  });
});
