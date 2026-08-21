import { describe, it, expect, afterEach, vi } from 'vitest';

// S93 — Headless Core 1. These cases assert the framework-free `core/` boundary DIRECTLY
// (the moved implementations), across the same fixtures the S82 E2E date/countdown pack
// drives through the UI, and prove the behavior-IDENTITY of the extraction: the exact
// same symbols reached via the `@/lib/*` back-compat re-exports and via `@/core/*` are
// one implementation with identical output. These are NEW cases layered on top of the
// FROZEN FU-10 (`trip-data.test.ts`) + S77 (`countdown.test.ts`) suites, which are
// unchanged (ZERO assertion edits).

// Core impls (the moved-to home):
import {
  getCountryForDate as coreGetCountryForDate,
  formatDate as coreFormatDate,
  formatDateLong as coreFormatDateLong,
  dayInTripFor,
  utcDayAtOffset as coreUtcDayAtOffset,
  TRIP_DATES as coreTRIP_DATES,
  TRIP_DATE_LABEL as coreTRIP_DATE_LABEL,
  TRIP_START as coreTRIP_START,
} from '@/core/dates';
import { computeCountdown as coreComputeCountdown } from '@/core/clock/countdown';

// Back-compat re-export surfaces (what every existing caller imports):
import {
  getCountryForDate as libGetCountryForDate,
  formatDate as libFormatDate,
  formatDateLong as libFormatDateLong,
  TRIP_DATES as libTRIP_DATES,
  TRIP_DATE_LABEL as libTRIP_DATE_LABEL,
  TRIP_START as libTRIP_START,
} from '@/lib/trip-data';
import { computeCountdown as libComputeCountdown } from '@/lib/countdown';
import { getTodayInTrip } from '@/lib/trip-now';

describe('S93 core boundary — computeCountdown (pure, from @/core/clock)', () => {
  it('is the SAME function object re-exported by @/lib/countdown (one impl, two surfaces)', () => {
    expect(libComputeCountdown).toBe(coreComputeCountdown);
  });

  it('matches the S82 pre-trip fixture: Nov 9 noon -> Dec 9 00:00 = 0mo/0wk/29d/12h, totalDays 29', () => {
    // Same instant the E2E drives via ?today=2026-11-09 (local noon), asserted at the
    // pure core boundary (no UI, no clock read).
    //
    // The TOTAL has never moved (29 days 12 hours, totalDays 29); only the bucketing has,
    // across three schemes now. It pinned `weeks: 4, days: 1`, then S423 re-bucketed it to
    // `days: 29` to keep "4 weeks" off the screen. Issue #11 / D-306 replaced that
    // suppression with a fixed 28-day carry: 29 = 28 + 1, so it read 1 month 0 weeks 1 day.
    // Issue #60 / D-313 reverts to calendar-accurate months: Nov 9 -> Dec 9 has not
    // completed a calendar month one day short of the borrow-adjusted walk target (Dec 8,
    // since the target's midnight is earlier in the day than noon), so months is 0 again
    // and the 29-day residue is >= the suppression window (28), reporting unsplit as
    // `days: 29` rather than `weeks: 4, days: 1`. The renderer drops zero units; the
    // producer still reports them. 29d + 12h sums back to exactly 2026-12-09T00:00:00.
    const now = new Date(2026, 10, 9, 12, 0, 0); // Nov 9, 2026 12:00 LOCAL
    const target = new Date('2026-12-09T00:00:00'); // TRIP_START (local)
    expect(coreComputeCountdown(target, now)).toEqual({
      months: 0,
      weeks: 0,
      days: 29,
      hours: 12,
      minutes: 0,
      seconds: 0,
      totalDays: 29,
      isPast: false,
    });
  });

  it('matches the S82 post-trip fixture: an instant past the target is all-zero / isPast', () => {
    const now = new Date(2027, 0, 15, 12, 0, 0); // Jan 15, 2027 (outside window)
    const target = new Date('2026-12-09T00:00:00');
    expect(coreComputeCountdown(target, now)).toEqual({
      months: 0,
      weeks: 0,
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      totalDays: 0,
      isPast: true,
    });
  });
});

describe('S93 core boundary — getCountryForDate (B-01, from @/core/dates)', () => {
  it('behavior-identity spot-check: 2026-12-18 -> nepal, 2026-12-19 -> japan from BOTH surfaces', () => {
    // The load-bearing proof for the whole slice: the moved impl and the re-export agree.
    expect(coreGetCountryForDate('2026-12-18')).toBe('nepal');
    expect(coreGetCountryForDate('2026-12-19')).toBe('japan');
    expect(libGetCountryForDate('2026-12-18')).toBe('nepal');
    expect(libGetCountryForDate('2026-12-19')).toBe('japan');
    // Same function object, not two copies — no drift possible.
    expect(libGetCountryForDate).toBe(coreGetCountryForDate);
  });

  it('classifies every TRIP_DATES entry identically through both surfaces', () => {
    for (const d of coreTRIP_DATES) {
      expect(libGetCountryForDate(d)).toBe(coreGetCountryForDate(d));
    }
  });
});

describe('S93 core boundary — the @/core/dates re-export is the same object @/lib/trip-data serves', () => {
  it('shares constants, label, and formatters by reference (one source)', () => {
    expect(libTRIP_DATES).toBe(coreTRIP_DATES);
    expect(libTRIP_DATE_LABEL).toBe(coreTRIP_DATE_LABEL);
    expect(libTRIP_START).toBe(coreTRIP_START);
    expect(libFormatDate).toBe(coreFormatDate);
    expect(libFormatDateLong).toBe(coreFormatDateLong);
  });

  it('formatters produce identical strings across every TRIP_DATES entry', () => {
    for (const d of coreTRIP_DATES) {
      expect(libFormatDate(d)).toBe(coreFormatDate(d));
      expect(libFormatDateLong(d)).toBe(coreFormatDateLong(d));
    }
  });
});

describe('S93 core boundary — dayInTripFor (pure day-in-trip math, from @/core/dates)', () => {
  // The four E2E boundary-matrix corners, asserted on the PURE math with a local-noon
  // Date (exactly how the trip-now adapter constructs the ?today= override instant).
  const noon = (y: number, m1: number, d: number) => new Date(y, m1 - 1, d, 12, 0, 0);

  it('Dec 9 -> Day 1, New York (Nepal start — D-315: the departure day is Syracuse/JFK/the air, named New York)', () => {
    expect(dayInTripFor(noon(2026, 12, 9))).toEqual({
      date: '2026-12-09',
      dayNumber: 1,
      city: 'New York',
      country: 'nepal',
    });
  });

  it('Dec 18 -> Day 10, Kathmandu (Nepal end)', () => {
    expect(dayInTripFor(noon(2026, 12, 18))).toEqual({
      date: '2026-12-18',
      dayNumber: 10,
      city: 'Kathmandu',
      country: 'nepal',
    });
  });

  it('Dec 19 -> Day 11, Osaka (Japan start; permanent B-01 guard; S112 reroute)', () => {
    // S112 (D-124): the Japan leg is now Osaka -> Kyoto -> Tokyo, so Dec-19's city
    // changed from Tokyo to Osaka. The B-01 invariant this guards (Japan window, NOT
    // Kathmandu) is unaffected.
    expect(dayInTripFor(noon(2026, 12, 19))).toEqual({
      date: '2026-12-19',
      dayNumber: 11,
      city: 'Osaka',
      country: 'japan',
    });
  });

  it('Jan 9 -> Day 32, Tokyo (Japan end / trip end)', () => {
    expect(dayInTripFor(noon(2027, 1, 9))).toEqual({
      date: '2027-01-09',
      dayNumber: 32,
      city: 'Tokyo',
      country: 'japan',
    });
  });

  it('an out-of-window instant is null (matches the post-trip / real-clock branch)', () => {
    expect(dayInTripFor(noon(2027, 1, 15))).toBeNull();
    expect(dayInTripFor(noon(2026, 11, 9))).toBeNull();
  });

  it('the @/lib/trip-now adapter (getTodayInTrip) delegates to this pure math (no override in test env -> real clock is out of window -> null)', () => {
    // In the vitest/node env there is no ?today= URL and no sessionStorage override, so
    // getNow() is the real clock (2026, outside the trip) -> getTodayInTrip() is null.
    // This confirms the adapter path is wired to core without changing its contract.
    expect(getTodayInTrip()).toBeNull();
  });
});

describe('S274 (D-224) — dayInTripFor offset branch + utcDayAtOffset (pure, TZ-independent)', () => {
  // Runs under TZ=America/New_York per FU-10 — these assertions must hold regardless
  // (the offset branch keys off the UTC instant + a fixed constant, never device TZ).

  it('2026-12-10T03:00:00Z at NPT (+345) -> Day 2, Kathmandu (03:00Z = 08:45 NPT, still Dec 10)', () => {
    expect(dayInTripFor(new Date('2026-12-10T03:00:00Z'), 345)).toEqual({
      date: '2026-12-10',
      dayNumber: 2,
      city: 'Kathmandu',
      country: 'nepal',
    });
  });

  it('2026-12-18T16:00:00Z at NPT (+345) -> Day 10, Kathmandu (16:00Z = 21:45 NPT, still Dec 18 — earliest-leg seed)', () => {
    expect(dayInTripFor(new Date('2026-12-18T16:00:00Z'), 345)).toEqual({
      date: '2026-12-18',
      dayNumber: 10,
      city: 'Kathmandu',
      country: 'nepal',
    });
  });

  it('2026-12-18T19:00:00Z at JST (+540) -> Day 11, Osaka (19:00Z + 9h = 04:00Z Dec 19)', () => {
    // The Japan leg's fallback/day city is Osaka for Dec 19 (S112/D-124 reroute) — same
    // fixed-offset (+540 JST) branch, matching the frozen S82 Dec-19 corner.
    expect(dayInTripFor(new Date('2026-12-18T19:00:00Z'), 540)).toEqual({
      date: '2026-12-19',
      dayNumber: 11,
      city: 'Osaka',
      country: 'japan',
    });
  });

  it('one-arg / null / undefined calls stay device-local (byte-identical to the frozen S82 matrix)', () => {
    const noon = (y: number, m1: number, d: number) => new Date(y, m1 - 1, d, 12, 0, 0);
    expect(dayInTripFor(noon(2026, 12, 9))).toEqual(dayInTripFor(noon(2026, 12, 9), null));
    expect(dayInTripFor(noon(2026, 12, 9), undefined)).toEqual({
      date: '2026-12-09',
      dayNumber: 1,
      city: 'New York', // D-315 — the Dec-9 city is New York, not Kathmandu
      country: 'nepal',
    });
  });

  it('utcDayAtOffset is B-01-safe: UTC getters only, shifted epoch-ms (never new Date(string))', () => {
    expect(coreUtcDayAtOffset(new Date('2026-12-18T18:14:00Z'), 345)).toBe('2026-12-18'); // KTM 23:59
    expect(coreUtcDayAtOffset(new Date('2026-12-18T18:15:00Z'), 345)).toBe('2026-12-19'); // KTM 00:00 next day
  });
});


// ── The `?today=` override is a DISPLAY clock only ────────────────────────────────────────────
// `getNow()` deliberately resolves the simulation override so day numbers and countdowns can be
// demoed against a trip months away. The SYNC layer must never see it: `pt` is the causal ordering
// key (a stamp minted at the faked day outranks every peer edit until the real clock passes it, and
// `hlcSendOrLocal` ratchets, so it is inherited by every later edit of that row on every device),
// and the tombstone-GC horizon decides which tombstones get dropped from a MERGED doc that is then
// written straight back to Firestore. `realClock` is the reader every sync path uses.
//
// Each case re-imports the module: `trip-now` resolves the override ONCE per load and caches it.
describe('trip-now — realClock ignores the `?today=` override, and a non-calendar day is rejected', () => {
  const TODAY_KEY = 'tripPlannerTodayOverride';

  async function loadClock(override: string | null) {
    window.sessionStorage.clear();
    if (override !== null) window.sessionStorage.setItem(TODAY_KEY, override);
    vi.resetModules();
    return import('@/lib/trip-now');
  }

  afterEach(() => {
    window.sessionStorage.clear();
    vi.resetModules();
  });

  it('with an override active, clock.now() is the simulated instant and realClock.now() is the real one', async () => {
    const { getNow, clock, realClock } = await loadClock('2026-12-09');
    const simulated = new Date(2026, 11, 9, 12, 0, 0, 0).getTime(); // LOCAL noon of the faked day
    expect(getNow().getTime()).toBe(simulated);
    expect(clock.now().getTime()).toBe(simulated);
    // Asserted against Date.now() rather than a fixed instant: a test whose meaning changes when
    // December 2026 actually arrives is not a test.
    expect(Math.abs(realClock.now().getTime() - Date.now())).toBeLessThan(1000);
  });

  it('with NO override the two clocks agree (the real clock is the only reading)', async () => {
    const { clock, realClock } = await loadClock(null);
    expect(Math.abs(clock.now().getTime() - realClock.now().getTime())).toBeLessThan(1000);
  });

  it('rejects a shape-valid but non-calendar day rather than rolling it over', async () => {
    // DATE_RE only checks the SHAPE, and `new Date(y, mo-1, d)` rolls out-of-range parts silently:
    // 2026-13-45 used to become 2027-02-14 and be accepted as the clock.
    for (const bad of ['2026-13-45', '2026-02-30', '2026-00-10']) {
      const { getNow } = await loadClock(bad);
      expect(Math.abs(getNow().getTime() - Date.now())).toBeLessThan(1000);
    }
  });

  it('still accepts a real edge day (leap day, month end)', async () => {
    const leap = await loadClock('2028-02-29');
    expect(leap.getNow().getTime()).toBe(new Date(2028, 1, 29, 12, 0, 0, 0).getTime());
    const monthEnd = await loadClock('2026-12-31');
    expect(monthEnd.getNow().getTime()).toBe(new Date(2026, 11, 31, 12, 0, 0, 0).getTime());
  });
});
