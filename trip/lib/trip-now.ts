// The SINGLE app-wide clock / trip-day source — the ClockPort ADAPTER.
//
// The app is split into a framework-free `core/` and thin
// `lib/` adapters. This module is the ADAPTER that implements `core/ports.ts`'s
// `ClockPort`: it owns all the I/O — reading the real clock AND resolving the `?today=`
// simulation override (URL / sessionStorage) — and delegates the PURE trip-day
// math to `core/dates` (`dayInTripFor`). The public API here (`getNow`, `getTodayInTrip`,
// `TripToday`) is BYTE-IDENTICAL to before, so every caller (`hero-section.tsx`,
// `trip-dashboard.tsx`, `calendar-planner.tsx`, `quick-add-fab.tsx`) is untouched. The
// override resolution/precedence/timing (an I/O concern) intentionally STAYS here — only
// deterministic math moved to core.
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
// Storage rules: sessionStorage ONLY — NEVER localStorage, NEVER
// shared/reactive state. The `tripPlannerTodayOverride` key + raw sessionStorage
// access live in the typed storage gateway (`clockOverride`), which is store-aware
// and keeps this key on the SESSION backend. All resolution/validation/
// precedence logic stays HERE — the gateway is byte-transport only, not policy. The
// localStorage namespace is untouched. `computeCountdown` stays PURE: callers pass
// `getNow()`.
//
// SSR-safe: `clockOverride` is `typeof window`-guarded internally (reads return null, writes
// no-op on the server), so `getNow()` returns the real clock and no override is ever
// resolved during SSR (first-paint parity, then the client re-reads on mount).

import { dayInTripFor, type TripToday } from '@/core/dates';
import type { ClockPort } from '@/core/ports';
import { clockOverride } from '@/core/storage/gateway';

// Re-export the trip-day type from its core home so `@/lib/trip-now`'s public surface is
// byte-identical for existing type importers (e.g. `hero-section.tsx`'s `TripToday`).
export type { TripToday } from '@/core/dates';

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

  if (param === 'off') {
    // Explicit clear: drop any persisted override, fall through to the real clock.
    clockOverride.clear();
    overrideMs = null;
    return;
  }

  if (param && DATE_RE.test(param)) {
    // Valid URL override wins and is persisted for subsequent navigations this session.
    clockOverride.set(param);
    overrideMs = localNoon(param).getTime();
    return;
  }

  // No usable URL param: fall back to a persisted override if one exists. `clockOverride`
  // never throws (privacy mode / quota degrade to `null` inside the gateway) → real clock.
  const stored = clockOverride.get();
  if (stored && DATE_RE.test(stored)) {
    overrideMs = localNoon(stored).getTime();
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

/**
 * The ClockPort adapter instance. `now()` delegates to `getNow()`,
 * so the port and the standalone function share ONE resolution path. Exposed for
 * core-boundary consumers that want the clock as a port; existing callers keep using
 * `getNow()` directly (byte-identical).
 */
export const clock: ClockPort = {
  now: getNow,
};

/**
 * The trip-day for "now", or `null` when the current day is outside the trip window.
 *
 * Reads the app-wide clock (`getNow()`, incl. the `?today=` override) and delegates the
 * pure calendar-day → trip-day mapping to `core/dates`' `dayInTripFor`. Splitting it this
 * way keeps the clock I/O here and the deterministic math in core, with no observable
 * change — the same `?today=` inputs yield the same `{ date, dayNumber, city, country }`.
 */
export function getTodayInTrip(): TripToday | null {
  return dayInTripFor(getNow());
}
