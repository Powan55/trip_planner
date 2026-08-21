import { describe, it, expect, vi } from 'vitest';

// The stat row reads the clock through this module; the live cell's pre-trip branch only runs
// when the trip has not started, so the clock is pinned rather than left to the real date.
vi.mock('@/lib/trip-now', () => ({
  getNow: () => new Date('2026-08-21T12:00:00'),
  getNowAtTrip: () => ({ date: '2026-08-21', minutes: 720 }),
  getTodayInTrip: () => null,
}));

// Issue #26 — Home's stat row reads numbers the app already works out, and this is what
// pins that claim. The point is NOT that the counts are 32/2/8 (content changes, and a
// test that hard-codes content becomes a chore); it is that each count still comes from the
// SAME producer the rest of the app reads, so a second, drifting derivation cannot appear
// here without going red.
//
// The one hard number asserted is `days`, because `components/trip-dashboard.tsx` puts the
// exact same value on the exact same page as "Total Trip Duration". Two cards on one screen
// disagreeing about how long the trip is would be the visible failure.

import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

import { tripShape, daysToGo } from '@/lib/home-stats';
import { computeCountdown } from '@/lib/countdown';
import { TRIP_START } from '@/core/dates';
import { TRIP_DATES, getCityForDate, getCountryForDate } from '@/core/dates';
import { liveCell } from '@/components/home-stat-row';
import { resolveTravelDate } from '@/lib/travel-date';

describe('issue #26 — the Home stat row counts what the date backbone already answers', () => {
  it('days is TRIP_DATES.length, the same value the dashboard shows', () => {
    expect(tripShape().days).toBe(TRIP_DATES.length);
  });

  it('cities and countries are the DISTINCT per-day answers, not a second derivation', () => {
    const cities = new Set(TRIP_DATES.map(getCityForDate));
    const countries = new Set(TRIP_DATES.map(getCountryForDate));
    expect(tripShape().cities).toBe(cities.size);
    expect(tripShape().countries).toBe(countries.size);
  });

  it('every count is a positive integer, and cities never collapse below countries', () => {
    const { days, cities, countries } = tripShape();
    for (const [name, n] of [['days', days], ['cities', cities], ['countries', countries]] as const) {
      expect(Number.isInteger(n), `${name} is not an integer`).toBe(true);
      expect(n, `${name} is not positive`).toBeGreaterThan(0);
    }
    // A country the trip visits has at least one city in it, so this ordering holds for any
    // content pack. It is the cheap check that catches the two Sets being swapped — which is
    // otherwise invisible, because both are small numbers rendered in adjacent cells.
    expect(cities).toBeGreaterThanOrEqual(countries);
    // And you cannot visit more distinct cities than you have days.
    expect(cities).toBeLessThanOrEqual(days);
  });
});

// ── The live cell's "Days to go" (`components/home-stat-row.tsx`) ─────────────────────────────
// A-23 again, one file over. `computeCountdown().totalDays` is a TRUNCATED whole-day count: it
// drops to 0 the moment fewer than 24h remain, so this cell read "0 Days to go" from midnight on
// Dec 8 while `/travel`, on the same device at the same instant, read "Trip starts in 1 day".
// `computeCountdown` is untouched — `totalDays` is correct for what it claims, it just is not the
// answer to "how many sleeps". D-313 governs the breakdown and is not reopened here.
describe('home stat row — "Days to go" is a calendar-day count, not a truncated 24h one', () => {
  it('reads 1 for the WHOLE day before departure, not just its last minute', () => {
    for (const at of ['2026-12-08T00:01:00', '2026-12-08T06:00:00', '2026-12-08T23:00:00']) {
      const cell = liveCell(new Date(at), 32);
      expect(cell.caption).toBe('Days to go');
      expect(cell.value, `wrong count at ${at}`).toBe('1');
    }
  });

  it('never disagrees with /travel, the other producer of the same number', () => {
    for (const at of ['2026-11-09T12:00:00', '2026-12-01T09:30:00', '2026-12-08T23:59:00']) {
      const now = new Date(at);
      const travel = resolveTravelDate({ dateParam: null, todayDate: null, now });
      expect(liveCell(now, 32).value, `disagreement at ${at}`).toBe(String(travel.daysUntilStart));
    }
  });
});

// ── One derivation of "days to go" ────────────────────────────────────────────────────────────
// Home printed this number TWICE in a single frame and the two disagreed by 1 at every instant
// except exactly local midnight: the hero's ring rendered `computeCountdown().totalDays` (a
// truncated 24-hour count) under the caption "days to go", and the stat row immediately below it
// rendered the calendar-day count. 2026-12-08T09:00 read 0 in the ring and 1 in the row.
//
// The value half below pins the quantity and the agreement. The SOURCE half pins that there is
// nothing left to drift: the count exists once, in `daysToGo`, and a fourth reader that
// hand-rolls it goes red here. Source-level on purpose (same idiom as
// `lib/__tests__/a11y-live-regions.test.ts` and `lib/__tests__/motion-budget.test.ts`) — the hero
// is a framer-motion island behind `dynamic({ssr:false})`, and what has to be pinned is which
// function it calls, not what it paints.
//
// D-313 (LOCKED) is not reopened: `computeCountdown` is untouched, the hero's month/week/day grid
// still reads it, and the grid still does not reconcile with the ring. What changed is the
// QUANTITY the ring counts, not the ring.
describe('"days to go" has one derivation and every surface reads it', () => {
  /** Instants where `totalDays` and the calendar count actually differed on screen. */
  const DIVERGED = ['2026-12-08T09:00:00', '2026-12-01T12:00:00', '2026-11-09T12:00:00'];

  const SOURCE_ROOTS = ['components', 'lib', 'hooks', 'app', 'core'];

  /** Comments blanked so a class or call named in prose is not a hit. */
  function stripComments(src: string): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*)/.test(line))
      .join('\n');
  }

  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) out.push(...sourceFiles(full));
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  const APP_ROOT = resolve(__dirname, '../..');
  const HERO = readFileSync(resolve(APP_ROOT, 'components/hero-section.tsx'), 'utf8');

  it('counts calendar days, which is NOT what totalDays counts at the same instant', () => {
    for (const at of DIVERGED) {
      const now = new Date(at);
      expect(daysToGo(now), `wrong count at ${at}`).toBe(
        computeCountdown(TRIP_START, now).totalDays + 1,
      );
    }
    // The reported reading: "0 days to go" in the ring for the whole of Dec 8.
    expect(daysToGo(new Date('2026-12-08T09:00:00'))).toBe(1);
    expect(computeCountdown(TRIP_START, new Date('2026-12-08T09:00:00')).totalDays).toBe(0);
  });

  it('the stat row and /travel print exactly it, at the instants they used to differ', () => {
    for (const at of DIVERGED) {
      const now = new Date(at);
      expect(liveCell(now, 32).value, `stat row disagrees at ${at}`).toBe(String(daysToGo(now)));
      expect(
        resolveTravelDate({ dateParam: null, todayDate: null, now }).daysUntilStart,
        `/travel disagrees at ${at}`,
      ).toBe(daysToGo(now));
    }
  });

  it('the hero ring feeds its digit AND its fill from one value, and that value is daysToGo', () => {
    const digit = HERO.match(
      /countdown-total-days[\s\S]{0,400}?<CountUpNumber live=\{([\w.]+)\}/,
    )?.[1];
    const fill = HERO.match(/ringFraction\(\s*([\w.]+)\s*,/)?.[1];
    expect(digit, 'the ring digit is no longer a <CountUpNumber> — re-point this check').toBeDefined();
    // Same identifier, so the number and the arc it sits in cannot drift apart.
    expect(fill).toBe(digit);
    const decl = HERO.split('\n').find((line) => line.includes(`[${digit},`));
    expect(decl, `no useState declaration found for ${digit}`).toBeDefined();
    expect(decl).toContain('daysToGo(');
    // And the ring reads nothing else: `totalDays` is the grid's, not the ring's.
    expect(stripComments(HERO)).not.toContain('totalDays');
  });

  it('nothing re-derives it: the differenceInCalendarDays(TRIP_START…) call exists in one file', () => {
    const hits = SOURCE_ROOTS.flatMap((root) => sourceFiles(resolve(APP_ROOT, root)))
      .filter((file) => stripComments(readFileSync(file, 'utf8')).includes('differenceInCalendarDays(TRIP_START'))
      .map((file) => relative(APP_ROOT, file).split(sep).join('/'))
      .sort();
    expect(hits).toEqual(['lib/home-stats.ts']);
  });
});
