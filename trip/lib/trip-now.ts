// The SINGLE app-wide clock / trip-day source — the ClockPort ADAPTER.
//
// As of the app is split into a framework-free `core/` and thin
// `lib/` adapters. This module is the ADAPTER that implements `core/ports.ts`'s
// `ClockPort`: it owns all the I/O — reading the real clock AND resolving the `?today=`
// simulation override — and delegates the PURE trip-day
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
// URL `?today=YYYY-MM-DD` > sessionStorage(`tripPlannerTodayOverride`) > real `new Date()`
// - A valid `?today=YYYY-MM-DD` is persisted to sessionStorage and used as the clock.
// The override Date is LOCAL NOON of that day (`new Date(y, m-1, d, 12, 0, 0)`) to
// avoid tz / day-edge ambiguity when we later format it back to a calendar day.
// - `?today=off` REMOVES the sessionStorage key (no override; back to the real clock).
// - Any absent/invalid `?today` falls back to the persisted key if present, else the
// real clock.
//
// Storage rules: sessionStorage ONLY — NEVER localStorage, NEVER
// shared/reactive state. As of the `tripPlannerTodayOverride` key + raw sessionStorage
// access live in the typed storage gateway, which is store-aware
// and keeps this key on the SESSION backend. All resolution/validation/
// precedence logic stays HERE — the gateway is byte-transport only, not policy. The
// localStorage namespace is untouched. `computeCountdown` stays PURE: callers pass
// `getNow()`.
//
// SSR-safe: `clockOverride` is `typeof window`-guarded internally (reads return null, writes
// no-op on the server), so `getNow()` returns the real clock and no override is ever
// resolved during SSR (first-paint parity, then the client re-reads on mount).

import { dayInTripFor, utcDayAtOffset, placeWallClockToUtcMs, type TripToday } from '@/core/dates';
import type { ClockPort } from '@/core/ports';
import { clockOverride } from '@/core/storage/gateway';
import { getActiveTrip, legForDate } from '@/core/trips';

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

/**
 * The LOCAL-noon epoch-ms for a `YYYY-MM-DD` override string, or `null` when the string is not a
 * real calendar day.
 *
 * `DATE_RE` only validates the SHAPE, and `new Date(y, mo-1, d)` rolls out-of-range parts over
 * silently: `2026-13-45` became 2027-02-14 and was accepted as the clock. The round-trip check
 * is the rejection — an unparseable override falls through to the persisted one, then the real
 * clock, rather than becoming a plausible-looking wrong day.
 */
function overrideMsFor(dateStr: string | null): number | null {
  if (!dateStr || !DATE_RE.test(dateStr)) return null;
  const [y, mo, d] = dateStr.split('-').map(Number);
  const at = new Date(y, mo - 1, d, 12, 0, 0, 0);
  const roundTrips = at.getFullYear() === y && at.getMonth() === mo - 1 && at.getDate() === d;
  return roundTrips ? at.getTime() : null;
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

  const fromUrl = overrideMsFor(param);
  if (param && fromUrl !== null) {
    // Valid URL override wins and is persisted for subsequent navigations this session.
    clockOverride.set(param);
    overrideMs = fromUrl;
    return;
  }

  // No usable URL param: fall back to a persisted override if one exists. `clockOverride`
  // never throws (privacy mode / quota degrade to `null` inside the gateway) → real clock.
  overrideMs = overrideMsFor(clockOverride.get());
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
 * The REAL clock, override or no override — the SYNC-path reader, and the only correct one there.
 *
 * `clock` above is a DISPLAY clock: `?today=` exists so day numbers and countdowns can be demoed
 * against a trip that is months away. Sync needs PHYSICAL time for two jobs where a faked instant
 * is not a simulation but corruption written to the shared trip:
 * - the HLC `pt` every edit is stamped with. A stamp minted at the faked day outranks every peer's
 *   real edit to that row until the real clock passes it (and `hlcSendOrLocal` ratchets, so it is
 *   inherited by every later edit of that row on every device);
 * - the tombstone-GC horizon (`gcTombstones`/`gcTombstoneRows`), which drops every tombstone older
 *   than `nowPt − 30d` from a MERGED doc that is then written straight back to Firestore — so a
 *   peer still holding the row live re-adds it and the delete silently undoes for everyone. This is
 *   `realClock` reading a genuinely wrong device clock, not the `?today=` override (that never
 *   reaches this port) — `gcTombstoneRows` caps `nowPt` to the doc's own newest `hlc.pt` (#238) so a
 *   fast device clock alone, with no correspondingly-bad row in the doc, can no longer do this.
 *
 * `lib/preflight.ts` reads `new Date()` by hand for the same reason (its clock row would otherwise
 * report the faked clock as correct). Use THIS at every sync stamp / GC site; use `clock`/`getNow`
 * for anything the user is looking at.
 */
export const realClock: ClockPort = {
  now: () => new Date(),
};

/**
 * "Now" as a UTC epoch-ms instant, re-interpreted at a given place's offset — the ONE clock
 * seam for the place-accurate item comparison in `nextUp`. Consumed by
 * `components/today-panel.tsx` → `nextUp`.
 *
 * - NO override: `getNow().getTime()` — the real instant. In-zone (during the trip) this is
 * an exact no-op vs the old device-wall-clock string compare (device == place wall-clock).
 * - Override active (`?today=`/sessionStorage): the synthetic Date's wall-clock FACE IS the
 * demo's place wall-clock by declaration, so we re-interpret those hours:minutes at
 * `placeOffsetMin`. Because the override Date is LOCAL NOON, demo "now" = NOON at the place
 * — byte-parity with the old `"12:00"` compare, now TZ-deterministic (the frozen `?today=`
 * countdown/persistence E2E stays green). We do NOT convert the synthetic instant through
 * the offset — that would break the fake-clock parity.
 */
export function getNowUtcMsForPlace(dayDate: string, placeOffsetMin: number): number {
  const now = getNow(); // resolves the override once; returns override-noon or the real clock
  if (overrideMs === null) return now.getTime();
  const minutes = now.getHours() * 60 + now.getMinutes(); // override noon → 720
  return placeWallClockToUtcMs(dayDate, minutes, placeOffsetMin);
}

/**
 * Destination wall-clock offset for the real-clock instant, or `null` (device-local) when
 * the active trip has no known geography (a custom single `'main'` leg @ 0) —.
 *
 * EXPORTED (#20) for `lib/preflight.ts`'s time-zone readiness row, which needs the same
 * "which leg is tonight" answer against the REAL clock. Callers pass their own `now`; this
 * function reads no clock of its own, so the `?today=` override cannot leak into it.
 * Two-pass, seeded by the EARLIEST leg so the day never rolls to the next leg before the
 * origin leg's own local midnight (Dec-18→19: a traveler physically in Kathmandu stays on
 * Day 10 until Kathmandu midnight, not Tokyo midnight).
 */
export function tripOffsetMinFor(now: Date): number | null {
  const trip = getActiveTrip();
  if (!trip.legs.some((l) => l.utcOffsetMin !== 0)) return null; // custom: no geography → device-local
  const seed = trip.legs[0].utcOffsetMin; // Nepal +345 for the default pack
  const provisional = utcDayAtOffset(now, seed); // two-pass assumes
  return legForDate(trip, provisional).utcOffsetMin; // chronological, non-decreasing (eastbound) legs
}

/**
 * The trip-day for "now", or `null` when the current day is outside the trip window.
 *
 * Reads the app-wide clock (`getNow()`, incl. the `?today=` override) and delegates the
 * pure calendar-day → trip-day mapping to `core/dates`' `dayInTripFor`. Splitting it this
 * way keeps the clock I/O here and the deterministic math in core, with no observable
 * change on the override path: the `?today=` override declares the
 * destination day directly, so it stays device-local of local-noon — the
 * frozen `?today=` boundary matrix runs only through this unchanged branch.
 *
 * WINDOW MEMBERSHIP COMES FROM THE DEVICE CALENDAR; THE DAY NUMBER COMES FROM THE
 * DESTINATION OFFSET. Deriving both at the destination leg's offset made the app hold two
 * definitions of "today" that are 10h45m apart on a home-time phone: `TRIP_START`,
 * `getFlightTiming` and `elapsedInclusiveDays` all read the device calendar, so at 13:15 EST
 * on Dec 8 the hero swapped its countdown for "Day 1" while the Flights card still said the
 * outbound was ten hours away — and the write paths that default a new row's `date` from this
 * function STORED that row on Dec 9. The mirror case ended the trip early: at 10:00 EST on
 * Jan 9 the destination day is already Jan 10, so this returned `null` and the hero flipped to
 * its post-trip state while the traveller was still on Day 32. The device day decides whether
 * we are in the window at all; the offset then names which trip day it is, and falls back to
 * the device answer when it lands outside.
 *
 * The guard is HERE and not in `tripOffsetMinFor`, which has a third caller:
 * `lib/preflight.ts` needs the trip's offset whether or not the device day is in the window,
 * and a `null` from it routes `evaluateClock` into "Couldn't compare — this trip has no time
 * zone set" in place of a correct "Phone is on home time".
 */
export function getTodayInTrip(): TripToday | null {
  const now = getNow(); // resolves the override once; sets module `overrideMs`
  const off = overrideMs === null ? tripOffsetMinFor(now) : null;
  const dev = dayInTripFor(now, null);
  if (dev === null) return null;
  return dayInTripFor(now, off) ?? dev;
}

/**
 * Destination-local "now" as a calendar day + minutes-from-midnight, ALWAYS, in or out of the
 * trip window. Same clock, same `?today=` override and same leg-offset resolution as
 * `getTodayInTrip()`; the difference is only that this one still answers outside the window.
 *
 * #12: `getTodayInTrip()` returning `null` off-trip is right for the Day-N UI (there is no trip
 * day to show), but the concierge digest was dropping its whole date line on that `null` and the
 * model then assumed day one of the trip. It needs a real date every time, so it calls this.
 *
 * With no trip geography (a custom pack) or with an override active, the offset falls back to the
 * device's own, which reproduces `dayInTripFor(now, null)`'s device-local day exactly. Under an
 * override `getNow()` is local noon of the simulated day, so this reads 12:00, the same demo-noon
 * parity `getNowUtcMsForPlace` documents.
 */
export function getNowAtTrip(): { date: string; minutes: number } {
  const now = getNow(); // resolves the override once; sets module `overrideMs`
  const offsetMin = (overrideMs === null ? tripOffsetMinFor(now) : null) ?? -now.getTimezoneOffset();
  const at = new Date(now.getTime() + offsetMin * 60000);
  return {
    date: utcDayAtOffset(now, offsetMin),
    minutes: at.getUTCHours() * 60 + at.getUTCMinutes(),
  };
}
