// The mobile "selected trip-day" signal — a single in-memory module value, read on
// demand. No React store, no event: every reader (the quick-add FAB, the expense-log
// host) calls `getSelectedDay()` at the moment it opens, so a pull is always current.
//
// STORAGE RULE: this holds state ONLY in a module variable — NEVER localStorage,
// NEVER sessionStorage. It is a per-page-load hint (which day the calendar has
// focused) used to preset an add dialog's date. It is intentionally NOT persisted: a
// fresh load starts from `null` and readers fall back to `getTodayInTrip()` /
// `TRIP_DATES[0]`.
//
// `calendar-planner.tsx` calls `setSelectedDay(date)` on day selection so those presets
// follow the day the user is looking at.

/** In-memory only: the currently focused trip-day, or null before any selection. */
let current: string | null = null;

/** Read the current in-memory selected day (null until the calendar sets one). */
export function getSelectedDay(): string | null {
  return current;
}

/** Set the selected day. `date` is a 'YYYY-MM-DD' trip date. */
export function setSelectedDay(date: string): void {
  current = date;
}
