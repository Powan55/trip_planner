import { describe, it, expect } from 'vitest';

import { formatRelativeTime } from '../relative-time';

// Every case injects `now`, which is the seam the module was written around — no fake
// timers, no global clock mock.
const NOW = new Date('2026-12-09T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

describe('formatRelativeTime', () => {
  it('returns null for a missing or unparseable timestamp', () => {
    expect(formatRelativeTime(undefined, NOW)).toBeNull();
    expect(formatRelativeTime('', NOW)).toBeNull();
    expect(formatRelativeTime('not a date', NOW)).toBeNull();
  });

  it('reads a future timestamp as "just now" rather than a negative age', () => {
    expect(formatRelativeTime(ago(-30 * SEC), NOW)).toBe('just now');
  });

  // One case each side of every threshold; the arithmetic between two thresholds is linear.
  // The 45s cutoff is not a minute, so the three rows around it are the ones that would
  // read "0m ago" without the clamp in the minutes branch.
  it.each<[number, string]>([
    [44_999, 'just now'],
    [45 * SEC, '1m ago'],
    [59_999, '1m ago'],
    [MIN, '1m ago'],
    [HOUR - SEC, '59m ago'],
    [HOUR, '1h ago'],
    [DAY - SEC, '23h ago'],
    [DAY, '1d ago'],
    [WEEK - SEC, '6d ago'],
    [WEEK, '1w ago'],
    [MONTH - SEC, '4w ago'],
    [MONTH, '1mo ago'],
    [YEAR - SEC, '12mo ago'],
    [YEAR, '1y ago'],
  ])('%i ms ago reads as "%s"', (diff, expected) => {
    expect(formatRelativeTime(ago(diff), NOW)).toBe(expected);
  });

  it('never reports a zero-valued unit', () => {
    expect(formatRelativeTime(ago(50 * SEC), NOW)).toBe('1m ago');
  });
});
