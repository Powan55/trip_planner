import { describe, it, expect } from 'vitest';

// S125 — pure formatting/combination helpers behind the hand-rolled AM/PM time
// picker (components/time-picker.tsx, D-141). No JSX here (vitest.config.ts only
// transforms lib/__tests__/**/*.test.ts as plain TS, no react plugin) — these are
// deliberately hosted in a JSX-free module so they stay directly testable.

import {
  DEFAULT_TIME_MINUTES,
  minutesToHHMM,
  formatDurationText,
  splitMinutes,
  combineMinutes,
} from '@/lib/time-picker-format';

describe('minutesToHHMM — the D-138 dual-write canonical 24h text', () => {
  it.each([
    [0, '00:00'],
    [345, '05:45'],
    [360, '06:00'],
    [720, '12:00'],
    [855, '14:15'],
    [1439, '23:59'],
  ])('%i -> %j', (mins, out) => {
    expect(minutesToHHMM(mins)).toBe(out);
  });
});

describe('formatDurationText — the D-138 duration dual-write text', () => {
  it.each([
    [45, '45m'],
    [60, '1h'],
    [90, '1h 30m'],
    [120, '2h'],
    [125, '2h 5m'],
  ])('%i -> %j', (mins, out) => {
    expect(formatDurationText(mins)).toBe(out);
  });
});

describe('splitMinutes / combineMinutes — the picker column round-trip', () => {
  it('splits into hour12 1-12, minute 0-59, AM/PM', () => {
    expect(splitMinutes(0)).toEqual({ hour12: 12, minute: 0, period: 'AM' });
    expect(splitMinutes(720)).toEqual({ hour12: 12, minute: 0, period: 'PM' });
    expect(splitMinutes(855)).toEqual({ hour12: 2, minute: 15, period: 'PM' });
    expect(splitMinutes(345)).toEqual({ hour12: 5, minute: 45, period: 'AM' });
    expect(splitMinutes(1439)).toEqual({ hour12: 11, minute: 59, period: 'PM' });
  });

  it('combine is the exact inverse of split for every hour/period at :00 and :59', () => {
    for (let h = 1; h <= 12; h++) {
      for (const period of ['AM', 'PM'] as const) {
        for (const minute of [0, 59]) {
          const combined = combineMinutes(h, minute, period);
          expect(splitMinutes(combined)).toEqual({ hour12: h, minute, period });
        }
      }
    }
  });

  it('12am is midnight (0) and 12pm is noon (720) — the classic 12-hour edge', () => {
    expect(combineMinutes(12, 0, 'AM')).toBe(0);
    expect(combineMinutes(12, 0, 'PM')).toBe(720);
  });

  it('the full 00-59 minute range is representable (no 5-min grid, D-141)', () => {
    // 12 AM is the midnight hour (h24=0), so combine(12, m, 'AM') === m exactly.
    for (let m = 0; m < 60; m++) {
      expect(combineMinutes(12, m, 'AM')).toBe(m);
    }
  });

  it('DEFAULT_TIME_MINUTES is 9:00 AM', () => {
    expect(DEFAULT_TIME_MINUTES).toBe(9 * 60);
    expect(splitMinutes(DEFAULT_TIME_MINUTES)).toEqual({ hour12: 9, minute: 0, period: 'AM' });
  });
});
