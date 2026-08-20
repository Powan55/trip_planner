import { describe, it, expect } from 'vitest';
import { addDays, addMonths, startOfDay, differenceInDays } from 'date-fns';
import { computeCountdown, type Countdown } from '../countdown';

/**
 * S423 / D-313 — the countdown must add up, must not jump, and must never say "4 weeks".
 *
 * THE governing invariant is the SUM-BACK, and everything else here is secondary to it.
 * Issue #60 reverted months to calendar-accurate (D-313), superseding issue #11's fixed
 * 28-day month (D-306), so the invariant is expressed with a CALENDAR month walk, not a
 * flat multiply:
 *
 *     now + months (calendar, via addMonths) + (weeks*7 + days) days + h:m:s  ===  target
 *
 * exactly, to the second. It subsumes monotonicity — a decomposition of an interval that
 * is itself shrinking cannot grow — and it is the invariant whose absence let two
 * separate defects ship historically:
 *
 *   1. the shipped bug: `differenceInMonths(target, now)` on full timestamps, so
 *      2026-08-09T00:00:00 read "4m 0w 0d" and one second later "3m 4w 1d".
 *   2. the first attempt at the fix: a date anchor with no BORROW, so `days` and `hours`
 *      both charged for the partly-spent current day and the total overstated by a full
 *      24h on every day of the year — "0m 1w 1d 15h" for a true 1 week 15 hours.
 *
 * Both defects preserved monotonicity and both would have passed a no-4-weeks check. A
 * guard covers what it was written to cover; the sum-back is the one that covers the
 * thing itself.
 *
 * Two further assertions keep the sum-back from being satisfiable by a degenerate walk
 * (it alone only pins the remainder, not the split): the day walk and the month walk must
 * each be MAXIMAL — one more day, or one more month, would overshoot the target.
 *
 * D-313 also gives up the `months*N + weeks*7 + days === totalDays` reconciliation that
 * D-306 bought with the fixed-28-day month: a calendar month is not a fixed day count, so
 * `totalDays` (a flat day count) and the calendar breakdown do NOT arithmetically reconcile
 * by multiplication. That is the same trade D-016 accepted originally and D-016 was right
 * that it is not a bug to "fix" — see the removed "issue #11 (5)" describe block this
 * replaces. What DOES still hold, and is checked below, is the weaker/different property
 * that `totalDays` equals the whole-day count computed from the calendar-walked date itself
 * (`differenceInDays(walkOnly(now, c), now)`) — that is a self-consistency check on the
 * borrow, not a claim that a month is any fixed number of days, and it is swept clean here.
 *
 * computeCountdown is PURE (D-016), so sweeping thousands of fixed instants is free.
 */

const TARGET = new Date('2026-12-09T00:00:00'); // TRIP_START (core/dates/trip-dates.ts)
const MS_PER_DAY = 86_400_000;

/** The instant reached by the calendar part of the walk alone (no h/m/s). */
function walkOnly(now: Date, c: Countdown): Date {
  return addDays(addMonths(now, c.months), c.weeks * 7 + c.days);
}

/** Reconstruct the instant the reported fields claim, anchored at `now`. */
function sumBack(now: Date, c: Countdown): Date {
  const walked = walkOnly(now, c);
  return new Date(walked.getTime() + (c.hours * 3600 + c.minutes * 60 + c.seconds) * 1000);
}

const fmt = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` +
  `T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;

const show = (c: Countdown) => `${c.months}m ${c.weeks}w ${c.days}d ${c.hours}h ${c.minutes}m ${c.seconds}s`;

/**
 * Every instant swept: 366 consecutive days ending at the target, and within each day the
 * edges the two defects turned on (midnight, midnight+1s, the last second) plus samples
 * spread across the day — including times of day both BEFORE and AFTER the target's
 * 00:00, which is the borrow's branch. 366 days x 8 instants = 2,928 instants.
 */
function sweepInstants(days = 366): Date[] {
  const out: Date[] = [];
  const firstDay = addDays(startOfDay(TARGET), -days);
  for (let d = 0; d < days; d++) {
    const day = addDays(firstDay, d);
    const y = day.getFullYear();
    const mo = day.getMonth();
    const da = day.getDate();
    for (const [h, mi, s] of [
      [0, 0, 0],
      [0, 0, 1],
      [3, 17, 42],
      [6, 0, 0],
      [12, 0, 0],
      [18, 30, 30],
      [23, 59, 58],
      [23, 59, 59],
    ] as const) {
      out.push(new Date(y, mo, da, h, mi, s));
    }
  }
  return out;
}

/**
 * The days in `year` that CONTAIN a change in the runtime's local UTC offset (empty in a
 * DST-free TZ). Offsets are compared at local midnight, and the shift itself usually lands
 * mid-day (02:00 in the US), so the day that contains it is the one BEFORE the first
 * midnight that reads differently.
 */
function dstTransitions(year: number): Date[] {
  const out: Date[] = [];
  const jan1 = new Date(year, 0, 1);
  let prev = jan1.getTimezoneOffset();
  for (let d = 1; d < 366; d++) {
    const day = addDays(jan1, d);
    const offset = day.getTimezoneOffset();
    if (offset !== prev) out.push(addDays(day, -1));
    prev = offset;
  }
  return out;
}

describe('S423 (1) SUM-BACK — the reported fields add back up to the target instant', () => {
  it('now + months (calendar) + weeks*7+days + h:m:s lands exactly on the target, swept over 2,928 instants across a year', () => {
    const instants = sweepInstants();
    expect(instants).toHaveLength(2928);
    expect(fmt(instants[0])).toBe('2025-12-08T00:00:00');
    expect(fmt(instants[instants.length - 1])).toBe('2026-12-08T23:59:59');

    const wrong: string[] = [];
    for (const now of instants) {
      const c = computeCountdown(TARGET, now);
      const back = sumBack(now, c);
      if (back.getTime() !== TARGET.getTime()) {
        const offHours = (back.getTime() - TARGET.getTime()) / 3_600_000;
        wrong.push(`${fmt(now)} -> ${show(c)} sums to ${fmt(back)} (off by ${offHours}h)`);
      }
    }

    expect(wrong.slice(0, 6).join('\n') || 'every instant sums back exactly', 'sum-back failed').toBe(
      'every instant sums back exactly',
    );
    expect(wrong).toHaveLength(0);
  });

  it('the day walk and the month walk are MAXIMAL — one more of either overshoots, and no unit could be said in a bigger one', () => {
    // Without this, the sum-back alone could be satisfied by understating days and
    // overstating hours, or by spelling the same day count as "0 months 8 weeks". Together
    // they pin the decomposition uniquely. The month walk's maximality is exactly what the
    // D-313 overshoot guard exists to guarantee once addMonths/differenceInMonths stop
    // being exact inverses (see the leap-day boundary describe block below).
    const slack: string[] = [];
    for (const now of sweepInstants()) {
      const c = computeCountdown(TARGET, now);
      if (addDays(walkOnly(now, c), 1).getTime() <= TARGET.getTime()) {
        slack.push(`${fmt(now)} -> ${show(c)}: one more DAY still fits`);
      }
      if (addMonths(now, c.months + 1).getTime() <= TARGET.getTime()) {
        slack.push(`${fmt(now)} -> ${show(c)}: one more MONTH still fits`);
      }
      // `days < 7` is NOT asserted here: once the sub-month residue reaches the suppression
      // window (>= 28, WEEKS_SUPPRESSED_AT) it is reported unsplit, which can be up to 30 —
      // that is the D-313 revert's shape (see S423 (4)), not slack in the walk. `weeks < 4`
      // still is, unconditionally.
      if (c.weeks >= 4) slack.push(`${fmt(now)} -> ${show(c)}: ${c.weeks} weeks is another MONTH`);
    }
    expect(slack.slice(0, 5).join('\n') || 'walk is maximal').toBe('walk is maximal');
  });

  it('the four probed instants report their TRUE remaining time', () => {
    // reported -> implied total, checked against the true interval. These are the exact
    // rows that exposed the double-count; months is 0 on all four so the sum is directly
    // comparable in hours and unaffected by which month scheme is in force.
    const rows: [Date, string, number][] = [
      [new Date(2026, 11, 8, 18, 0, 0), '0m 0w 0d 6h 0m 0s', 6],
      [new Date(2026, 11, 8, 0, 0, 0), '0m 0w 1d 0h 0m 0s', 24],
      [new Date(2026, 11, 7, 12, 0, 0), '0m 0w 1d 12h 0m 0s', 36],
      [new Date(2026, 11, 1, 9, 0, 0), '0m 1w 0d 15h 0m 0s', 183],
    ];
    for (const [now, expected, trueHours] of rows) {
      const c = computeCountdown(TARGET, now);
      expect(show(c), fmt(now)).toBe(expected);
      expect(c.months, `${fmt(now)} months must be 0 for the hour comparison`).toBe(0);
      const impliedHours = ((c.weeks * 7 + c.days) * MS_PER_DAY) / 3_600_000 + c.hours + c.minutes / 60 + c.seconds / 3600;
      expect(impliedHours, fmt(now)).toBe(trueHours);
      expect(impliedHours, fmt(now)).toBe((TARGET.getTime() - now.getTime()) / 3_600_000);
    }
  });
});

describe('S423 (2) field ranges — the borrow, not clamping, keeps hours under 24', () => {
  it('every swept instant yields non-negative integers with hours<24, minutes<60, seconds<60', () => {
    const bad: string[] = [];
    for (const now of sweepInstants()) {
      const c = computeCountdown(TARGET, now);
      const ok =
        [c.months, c.weeks, c.days, c.hours, c.minutes, c.seconds, c.totalDays].every(
          (n) => Number.isInteger(n) && n >= 0,
        ) &&
        c.hours < 24 &&
        c.minutes < 60 &&
        c.seconds < 60;
      if (!ok) bad.push(`${fmt(now)} -> ${show(c)} totalDays=${c.totalDays}`);
    }
    expect(bad.slice(0, 5).join('\n') || 'all fields in range').toBe('all fields in range');
  });

  it('totalDays equals the whole-day count of the calendar-walked date itself, on every swept instant', () => {
    // NOT the D-306 multiplication reconciliation (months*N + weeks*7 + days === totalDays),
    // which this revert deliberately gives up because a calendar month is not a fixed day
    // count. This is a different, weaker, still-true property: `walkOnly` reconstructs the
    // exact date the breakdown claims to have walked to, and that date's own whole-day
    // distance from `now` must agree with `totalDays`, because both are the SAME borrow
    // (target's time-of-day vs now's) applied to the same target. Verified separately
    // against 12,000 non-trip instants across every calendar month length and both DST
    // edges in the block below, and against the runtime's actual DST transitions.
    const desynced: string[] = [];
    for (const now of sweepInstants()) {
      const c = computeCountdown(TARGET, now);
      const breakdownDays = differenceInDays(walkOnly(now, c), now);
      if (c.totalDays !== breakdownDays) {
        desynced.push(`${fmt(now)} -> ${show(c)} totalDays=${c.totalDays} but breakdown=${breakdownDays}`);
      }
    }
    expect(desynced.slice(0, 5).join('\n') || 'totalDays agrees').toBe('totalDays agrees');
  });
});

describe('S423 (3) monotonicity — nothing grows as `now` advances', () => {
  it('months and the total remaining encoded by the fields are non-increasing across the sweep', () => {
    // Implied by the sum-back (the fields encode target - now, which shrinks), but months
    // alone is NOT implied: end-of-month clamping in addMonths could make it non-monotone.
    const regressions: string[] = [];
    let prev: { now: Date; c: Countdown } | null = null;
    for (const now of sweepInstants()) {
      const c = computeCountdown(TARGET, now);
      if (prev && c.months > prev.c.months) {
        regressions.push(`${fmt(prev.now)} -> ${show(prev.c)}  THEN  ${fmt(now)} -> ${show(c)}`);
      }
      prev = { now, c };
    }
    expect(regressions.slice(0, 5).join('\n') || 'months never grows').toBe('months never grows');
  });

  it('the reported case 2026-08-09: no "4 weeks", and every reading is the true remaining time', () => {
    const at = (h: number, mi: number, s: number) => new Date(2026, 7, 9, h, mi, s);
    for (const now of [at(0, 0, 0), at(0, 0, 1), at(12, 0, 0), at(23, 59, 59)]) {
      const c = computeCountdown(TARGET, now);
      expect(c.weeks, fmt(now)).not.toBe(4);
      expect(sumBack(now, c).getTime(), fmt(now)).toBe(TARGET.getTime());
    }
    // The shipped bug rendered "3m 4w 1d" here. Calendar-accurate months land on 4 exact
    // months at the instant of the borrow's flip (midnight), and 29 unsplit days (>= the 28
    // suppression window) at every instant after, so no unit is ever 0 or the forbidden "4
    // weeks", and the total is unchanged and exact throughout.
    expect(show(computeCountdown(TARGET, at(12, 0, 0)))).toBe('3m 0w 29d 12h 0m 0s');
  });
});

describe('S423 (4) "4 weeks" is never rendered', () => {
  it('no instant in a full year before the target produces weeks === 4', () => {
    const offenders: string[] = [];
    for (const now of sweepInstants()) {
      const c = computeCountdown(TARGET, now);
      if (c.weeks >= 4) offenders.push(`${fmt(now)} -> ${show(c)}`);
    }
    expect(offenders.slice(0, 5).join('\n') || 'never 4 weeks', 'a 4-week bucket was rendered').toBe(
      'never 4 weeks',
    );
    expect(offenders).toHaveLength(0);
  });

  it('the >= 28 day window renders months + days and does NOT round up to the next month', () => {
    // Aug 10 09:00 -> Dec 9 00:00: the calendar walk covers 3 whole months (Aug10->Nov10),
    // leaving a 28-day + 15h residue. Rounding to "4 months" would name Dec 10 — the
    // remainder must be shown, not absorbed, and 28 days is exactly the suppression
    // boundary (WEEKS_SUPPRESSED_AT), so it reads as days, not "4 weeks".
    const now = new Date(2026, 7, 10, 9, 0, 0);
    const c = computeCountdown(TARGET, now);
    expect(c.totalDays).toBe(120);
    expect(show(c)).toBe('3m 0w 28d 15h 0m 0s');
    expect(sumBack(now, c).getTime()).toBe(TARGET.getTime());
  });

  it('a 26-day remainder still uses weeks (the rule is a window, not a blanket)', () => {
    const now = new Date(2026, 10, 12, 9, 0, 0); // Nov 12 09:00 -> 3w 5d 15h
    const c = computeCountdown(TARGET, now);
    expect(show(c)).toBe('0m 3w 5d 15h 0m 0s');
    expect(sumBack(now, c).getTime()).toBe(TARGET.getTime());
  });

  it('sums back and never shows 4 weeks against 12 non-trip targets across every month length', () => {
    // 2028 is a leap year, so this covers 28/29/30/31-day months and both DST edges.
    const offenders: string[] = [];
    let checked = 0;
    for (let m = 0; m < 12; m++) {
      const target = new Date(2028, m, 15, 7, 45, 30); // a non-midnight target: borrow both ways
      for (let back = 1; back <= 200; back++) {
        const day = addDays(startOfDay(target), -back);
        for (const h of [0, 1, 7, 12, 23]) {
          const now = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, 30, 0);
          const c = computeCountdown(target, now);
          checked++;
          if (c.weeks >= 4) offenders.push(`target ${fmt(target)} now ${fmt(now)} -> ${show(c)}`);
          if (sumBack(now, c).getTime() !== target.getTime()) {
            offenders.push(`target ${fmt(target)} now ${fmt(now)} -> ${show(c)} sums to ${fmt(sumBack(now, c))}`);
          }
          if (c.hours >= 24) offenders.push(`target ${fmt(target)} now ${fmt(now)} -> hours ${c.hours}`);
          if (c.months < 0 || c.weeks < 0 || c.days < 0) {
            offenders.push(`target ${fmt(target)} now ${fmt(now)} -> negative field in ${show(c)}`);
          }
        }
      }
    }
    expect(checked).toBe(12000);
    expect(offenders.slice(0, 5).join('\n') || 'clean').toBe('clean');
  });
});

describe('S423 (5) crossing DST', () => {
  it('crosses every DST transition the runtime has: the walk is date-fns field math, never epoch arithmetic', () => {
    // The zone is PINNED (`vitest.config.ts` sets TZ=America/New_York), which is what makes this
    // case run at all -- it located zero transitions on the UTC CI runner and passed vacuously
    // until then. The transitions are still LOCATED rather than hardcoded so the case survives a
    // re-pin to another zone, and the count is asserted below so it can never go vacuous again. An
    // epoch-ms walk drifts an hour across each; a field walk does not. Both a multi-day
    // interval straddling the shift and a sub-day one landing on it are checked, and the
    // sub-day one is where a broken walk would push `hours` to 24 or 25.
    const shifts = dstTransitions(2027);
    for (const day of shifts) {
      const offsetsDiffer = day.getTimezoneOffset() !== addDays(day, 1).getTimezoneOffset();
      expect(offsetsDiffer, `${fmt(day)} really contains an offset change`).toBe(true);

      const at = (d: Date, h: number, mi = 0, s = 0) =>
        new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, mi, s);
      const cases: [string, Date, Date][] = [
        ['straddling', at(addDays(day, -10), 9), at(addDays(day, 10), 14, 30, 15)],
        ['sub-day', at(addDays(day, -1), 22), at(day, 8)],
      ];
      for (const [label, now, target] of cases) {
        const c = computeCountdown(target, now);
        const where = `${fmt(day)} ${label}: ${fmt(now)} -> ${show(c)}`;
        expect(sumBack(now, c).getTime(), where).toBe(target.getTime());
        expect(c.hours, where).toBeLessThan(24);
        // See S423 (2): the weaker still-true reconciliation, not the retired multiplication.
        expect(differenceInDays(walkOnly(now, c), now), where).toBe(c.totalDays);
      }
    }
    // NON-VACUITY. `0 % 2` is 0, so the parity check below passes HARDEST when the loop above did
    // nothing -- which is exactly how this case sat green on every CI run before the zone was
    // pinned. Assert the count first: America/New_York has exactly two transitions a year.
    expect(shifts.length, `transitions found: ${shifts.map(fmt).join(", ") || "none"}`).toBe(2);
    // A TZ with transitions must have an even number of them (out and back).
    expect(shifts.length % 2, `transitions found: ${shifts.map(fmt).join(', ') || 'none'}`).toBe(0);
  });
});

describe('D-313 (6) leap-day overshoot guard — `now` on a 29th/30th/31st walking to Feb 28 of a leap year', () => {
  it('sweeps 2027-11-29 through 2028-02-27 against target 2028-02-28: every field stays non-negative and hours<24', () => {
    // The failure this guards: without the correction, `addMonths` walking forward from a
    // day-of-month that does not exist in the landed-on month (e.g. Nov 29 + 3 months would
    // want "Feb 29" of a NON-leap year, or in a leap year can still walk one day past a Feb
    // 28 target) overshoots `walkTarget`, producing a negative `dayRem` and, from there,
    // negative weeks/days and hours >= 24.
    const target = new Date(2028, 1, 28, 0, 0, 0); // Feb 28, 2028 (2028 IS a leap year)
    const start = new Date(2027, 10, 29, 0, 0, 0); // Nov 29, 2027
    const end = new Date(2028, 1, 27, 0, 0, 0); // Feb 27, 2028
    const bad: string[] = [];
    let checked = 0;
    for (let day = start; day.getTime() <= end.getTime(); day = addDays(day, 1)) {
      for (const h of [0, 9, 23]) {
        const now = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, 0, 0);
        if (now.getTime() >= target.getTime()) continue;
        checked++;
        const c = computeCountdown(target, now);
        const ok =
          c.months >= 0 &&
          c.weeks >= 0 &&
          c.days >= 0 &&
          c.hours >= 0 &&
          c.hours < 24 &&
          sumBack(now, c).getTime() === target.getTime();
        if (!ok) bad.push(`${fmt(now)} -> ${show(c)}`);
      }
    }
    expect(checked).toBeGreaterThan(200);
    expect(bad.slice(0, 5).join('\n') || 'all non-negative, hours<24').toBe('all non-negative, hours<24');
    expect(bad).toHaveLength(0);
  });

  it('a concrete overshoot instant: Nov 29 2027 00:00 -> Feb 28 2028 00:00', () => {
    // Verified (scratch sweep, this consultation) to be one of the instants where the
    // unguarded walk overshoots by exactly one day: addMonths(Nov 29, 3) lands on Feb 29
    // 2028, one day past the Feb 28 target, so months must correct down to 2.
    const target = new Date(2028, 1, 28, 0, 0, 0);
    const now = new Date(2027, 10, 29, 0, 0, 0);
    const c = computeCountdown(target, now);
    expect(show(c)).toBe('2m 0w 30d 0h 0m 0s');
    expect(sumBack(now, c).getTime()).toBe(target.getTime());
  });
});
