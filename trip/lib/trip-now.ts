// The SINGLE app-wide clock / trip-day source.
//
// Every "what day is it, and where in the trip are we" read flows through here so
// travel-mode features are testable against the real static build via a `?today=`
// URL override — invisible unless used, ships in ALL builds.
//
// Precedence (resolved ONCE per page load, cached in a module var):
//     URL `?today=YYYY-MM-DD`  >  sessionStorage(`tripPlannerTodayOverride`)  >  real `new Date()`
//   - A valid `?today=YYYY-MM-DD` is persisted to sessionStorage and used as the clock.
//     The override Date is LOCAL NOON of that day (`new Date(y, m-1, d, 12, 0, 0)`) to
//     avoid tz / day-edge ambiguity when we later format it back to a calendar day.
//   - `?today=off` REMOVES the sessionStorage key (no override; back to the real clock).
//   - Any absent/invalid `?today` falls back to the persisted key if present, else the
//     real clock.
//
// Storage rules: sessionStorage ONLY, via the ONE named key constant below —
// NEVER localStorage, NEVER shared/reactive state. The itinerary's localStorage
// namespace is untouched. `computeCountdown` stays PURE: callers pass `getNow()`.
//
// SSR-safe: every `window` / `sessionStorage` access is guarded with
// `typeof window !== 'undefined'`; on the server `getNow()` returns the real clock and
// no override is ever resolved (first-paint parity, then the client re-reads on mount).
//
// Purity: this module imports ONLY from `lib/trip-data.ts` (TRIP_DATES, getCountryForDate)
// — no store import — so it stays a leaf with no reactive-state coupling.

import { TRIP_DATES, getCountryForDate } from '@/lib/trip-data';

/** The ONE sessionStorage key for the `?today=` override (single named constant). */
const TODAY_OVERRIDE_KEY = 'tripPlannerTodayOverride';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolution cache. `resolved` flips to `true` the first time we run the URL →
 * sessionStorage resolution on the client, so subsequent reads within the same page
 * load are consistent and cheap (read once per load). `overrideMs` is the override
 * clock as an epoch-ms number, or `null` when there is no override.
 */
let resolved = false;
let overrideMs: number | null = null;

/** Build the LOCAL-noon Date for a validated `YYYY-MM-DD` string. */
function localNoon(dateStr: string): Date {
  const [y, mo, d] = dateStr.split('-').map(Number);
  return new Date(y, mo - 1, d, 12, 0, 0, 0);
}

/**
 * Run the URL → sessionStorage resolution exactly once per page load. No-op on the
 * server (leaves `overrideMs` null so `getNow()` returns the real clock there).
 */
function resolveOverrideOnce(): void {
  if (resolved) return;
  resolved = true;

  if (typeof window === 'undefined') return; // SSR: real clock only.

  let param: string | null = null;
  try {
    param = new URLSearchParams(window.location.search).get('today');
  } catch {
    param = null;
  }

  try {
    if (param === 'off') {
      // Explicit clear: drop any persisted override, fall through to the real clock.
      window.sessionStorage.removeItem(TODAY_OVERRIDE_KEY);
      overrideMs = null;
      return;
    }

    if (param && DATE_RE.test(param)) {
      // Valid URL override wins and is persisted for subsequent navigations this session.
      window.sessionStorage.setItem(TODAY_OVERRIDE_KEY, param);
      overrideMs = localNoon(param).getTime();
      return;
    }

    // No usable URL param: fall back to a persisted override if one exists.
    const stored = window.sessionStorage.getItem(TODAY_OVERRIDE_KEY);
    if (stored && DATE_RE.test(stored)) {
      overrideMs = localNoon(stored).getTime();
      return;
    }
  } catch {
    // sessionStorage unavailable (privacy mode / quota): silently use the real clock.
    overrideMs = null;
    return;
  }

  overrideMs = null;
}

/**
 * The app-wide clock read. Returns the `?today=`/sessionStorage override (local noon of
 * the overridden day) when one is active this load, otherwise the real `new Date()`.
 * A fresh Date is returned each call so live-ticking callers (countdown) keep advancing.
 */
export function getNow(): Date {
  resolveOverrideOnce();
  return overrideMs === null ? new Date() : new Date(overrideMs);
}

export interface TripToday {
  date: string;
  dayNumber: number;
  city: string;
  country: 'nepal' | 'japan';
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The trip-day for "now", or `null` when the current day is outside the trip window.
 *
 * Formats `getNow()` to a LOCAL calendar-day string from local parts (NOT
 * `toISOString()`, which is UTC and can slip a day at the edges), then looks it up in
 * TRIP_DATES — the single date source. Day N = index + 1. The `city` literal
 * MUST match `hooks/use-itinerary.ts`'s synthesizeDay default so travel-mode labels and
 * the stored day plans agree.
 */
export function getTodayInTrip(): TripToday | null {
  const now = getNow();
  const s = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const i = TRIP_DATES.indexOf(s);
  if (i < 0) return null;
  const country = getCountryForDate(s);
  return {
    date: s,
    dayNumber: i + 1,
    country,
    city: country === 'nepal' ? 'Kathmandu' : 'Tokyo',
  };
}
