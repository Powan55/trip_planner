// Travel Mode `?date=` resolution — the PURE bounds/composition logic.
//
// PURE: no clock read, no
// `window`/URL access. The caller (`components/travel-date-picker.tsx`) supplies the raw
// `?date=` param, the live day-in-trip date (from `getTodayInTrip()`, incl. the `?today=`
// override,), and the injected "now" `Date` (from `getNow()`) — so every branch below is
// unit-testable with fixed inputs.
//
// ── composition rule ──────────────────────────────────────────────────────────
// `?date=` (which day) is decoupled from `?today=` (what time). This module only ever sees the
// ALREADY-RESOLVED `todayDate` (the `?today=`-aware day-in-trip) — it never reads `?today=`
// itself. So:
// - `?date=` present + valid → that day wins, regardless of `?today=`.
// - `?date=` present + invalid/out-of-range → `outOfRange: true` (the empty state).
// - `?date=` absent + on-trip (`todayDate` set) → the day FOLLOWS the sim clock.
// - `?date=` absent + pre-trip (`now` < trip start) → Day 1 default + `daysUntilStart`.
// - `?date=` absent + off-trip and NOT pre-trip (post-trip) → `date: null`, not an error; the
// caller falls back to the existing off-trip UI.
import { TRIP_DATES, TRIP_START } from '@/core/dates';
import { daysToGo } from '@/lib/home-stats';

export interface TravelDateResolution {
  /** The day to render, or `null` when there is nothing to force (out-of-range, or off-trip
   * with no override — the caller's existing off-trip fallback applies). */
  date: string | null;
  /** `true` when `date` is a deliberate preview of a day other than the live trip day. */
  isPreview: boolean;
  /** `true` when `date` is the pre-trip Day-1 fallback (no `?date=`, clock before trip start). */
  isPreTripDefault: boolean;
  /** Whole days until the trip starts — only meaningful when `isPreTripDefault`. */
  daysUntilStart: number;
  /** `true` when `?date=` was present but malformed or outside the Dec 9 – Jan 9 window. */
  outOfRange: boolean;
}

const NOT_PREVIEW: Pick<TravelDateResolution, 'isPreview' | 'isPreTripDefault' | 'daysUntilStart'> = {
  isPreview: false,
  isPreTripDefault: false,
  daysUntilStart: 0,
};

export function resolveTravelDate(opts: {
  /** The raw `?date=` search-param value, or `null` when absent. */
  dateParam: string | null;
  /** `getTodayInTrip()?.date ?? null` — the live (possibly `?today=`-simulated) trip day. */
  todayDate: string | null;
  /** `getNow()` — the injected clock, used only for the pre-trip days-until-start count. */
  now: Date;
}): TravelDateResolution {
  const { dateParam, todayDate, now } = opts;

  if (dateParam !== null) {
    if (TRIP_DATES.includes(dateParam)) {
      return {
        date: dateParam,
        ...NOT_PREVIEW,
        isPreview: todayDate !== null && dateParam !== todayDate,
        outOfRange: false,
      };
    }
    return { date: null, ...NOT_PREVIEW, outOfRange: true };
  }

  if (todayDate !== null) {
    return { date: todayDate, ...NOT_PREVIEW, outOfRange: false };
  }

  if (now.getTime() < TRIP_START.getTime()) {
    return {
      date: TRIP_DATES[0],
      ...NOT_PREVIEW,
      isPreTripDefault: true,
      // A-23: `computeCountdown(TRIP_START, now).totalDays` truncates and read 0 for the
      // entire day before departure (a partly-spent day borrows into the hour/minute/second
      // residue — D-313). `daysToGo` is the calendar-day count (1, not 0) for that day, and
      // it is the SAME function Home's hero ring and stat row call — the one derivation of
      // this number, so three surfaces cannot print it three ways. No special-casing for 0:
      // this branch only runs when `now < TRIP_START` (guard above) and TRIP_START is local
      // midnight, so `now`'s calendar day is always strictly before TRIP_START's — 0 is
      // unreachable here. Does NOT touch computeCountdown/totalDays itself (D-313's
      // calendar-accurate breakdown does not reconcile with totalDays by design).
      daysUntilStart: daysToGo(now),
      outOfRange: false,
    };
  }

  return { date: null, ...NOT_PREVIEW, outOfRange: false };
}
