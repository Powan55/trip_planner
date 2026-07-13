// The mobile "selected trip-day" signal.
//
// A tiny in-memory module value plus a `plan:selected-date` CustomEvent, mirroring
// the reactive-signal idiom used elsewhere (module var + window event, no React store).
//
// STORAGE RULE: this holds state ONLY in a module variable + fires a
// window event — NEVER localStorage, NEVER sessionStorage. It is a per-page-load,
// in-memory hint (which day the calendar has focused) that the quick-add FAB reads to
// preset the add dialog's date. It is intentionally NOT persisted: a fresh load starts
// from `null` and the FAB falls back to `getTodayInTrip()` / `TRIP_DATES[0]`.
//
// Wiring:
//   - The quick-add FAB READS `getSelectedDay()` and MAY subscribe to
//     `SELECTED_DATE_EVENT` — graceful `null` until the calendar sets it.
//   - `calendar-planner.tsx` calls `setSelectedDay(date)` on day selection so the
//     FAB's preset date follows the day the user is looking at.
//
// SSR-safe: the `window.dispatchEvent` is guarded so `setSelectedDay` is a no-op event-wise
// on the server (it still updates the module var, which is harmless there).

/** The single event name for the selected-day signal. */
export const SELECTED_DATE_EVENT = 'plan:selected-date';

/** In-memory only: the currently focused trip-day, or null before any selection. */
let current: string | null = null;

/** Read the current in-memory selected day (null until the calendar sets one). */
export function getSelectedDay(): string | null {
  return current;
}

/**
 * Set the selected day and broadcast it. `date` is a 'YYYY-MM-DD' trip date. Updates the
 * module var and dispatches `SELECTED_DATE_EVENT` (with `detail.date`) so subscribers (the
 * FAB) can react. SSR-guarded — the event only fires in the browser.
 */
export function setSelectedDay(date: string): void {
  current = date;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SELECTED_DATE_EVENT, { detail: { date } }));
  }
}
