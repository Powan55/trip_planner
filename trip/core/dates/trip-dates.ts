/**
 * Core date backbone — the framework-free trip-date constants + pure calendar math.
 * Extracted verbatim from `lib/trip-data.ts`; that
 * module now re-exports every symbol here byte-identically so its many callers are
 * untouched. Plain TS only — no React / Next / `window`.
 *
 * ── Timezone correctness is LOAD-BEARING (do NOT "clean up") ─────────────────
 * Two behaviors here are permanent regression fixes, frozen by the unit test suite
 * (which runs under `TZ=America/New_York`) and the E2E boundary pack:
 *   - `getCountryForDate` compares 'YYYY-MM-DD' strings LEXICOGRAPHICALLY and NEVER
 *     `new Date(dateStr)`-parses the input (the B-01 fix). A date-only string parses as
 *     UTC midnight; at a negative UTC offset that slips Dec-19 before Dec-18 23:59:59
 *     local and misclassifies it as 'nepal'. Lexicographic ISO compare is TZ-independent.
 *   - `formatDate` / `formatDateLong` anchor the input at LOCAL NOON (`+ 'T12:00:00'`)
 *     before `toLocaleDateString`, so the rendered calendar day never slips at a
 *     negative offset. Carried verbatim — do not re-parse.
 */

// Trip date constants and utilities
export const TRIP_START = new Date('2026-12-09T00:00:00');
export const TRIP_END = new Date('2027-01-09T23:59:59');
export const NEPAL_START = new Date('2026-12-09T00:00:00');
export const NEPAL_END = new Date('2026-12-18T23:59:59');
export const JAPAN_START = new Date('2026-12-19T00:00:00');
export const JAPAN_END = new Date('2027-01-09T23:59:59');

// Derive the inclusive day sequence from TRIP_START/TRIP_END. We iterate in UTC
// so the produced 'YYYY-MM-DD' strings are identical regardless of build-machine
// timezone (and match the original '2026-12-09'...'2027-01-09' sequence).
export const TRIP_DATES: string[] = (() => {
  const dates: string[] = [];
  const d = new Date(Date.UTC(TRIP_START.getFullYear(), TRIP_START.getMonth(), TRIP_START.getDate()));
  const end = new Date(Date.UTC(TRIP_END.getFullYear(), TRIP_END.getMonth(), TRIP_END.getDate()));
  while (d <= end) {
    dates.push(d.toISOString().split('T')[0]);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
})();

// Centralized human-readable trip-date label. Derived from TRIP_START/TRIP_END so
// the year is configured in one place. Built from explicit parts to
// guarantee the exact rendered string ("December 9, 2026 – January 9, 2027", en-dash)
// independent of the runtime's Intl/locale data.
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
function formatLabelPart(d: Date): string {
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
export const TRIP_DATE_LABEL = `${formatLabelPart(TRIP_START)} – ${formatLabelPart(TRIP_END)}`;

// B-01 fix: country classification must be timezone-independent. The previous
// implementation parsed the incoming 'YYYY-MM-DD' with `new Date(dateStr)` — the ES
// spec treats date-ONLY strings as UTC midnight, while NEPAL_END above is a LOCAL
// datetime. At any negative UTC offset (e.g. America/New_York) Dec 19's UTC midnight
// lands BEFORE Dec 18 23:59:59 local, misclassifying Dec 19 as 'nepal'. Fix: compare
// calendar-day strings lexicographically — ISO 'YYYY-MM-DD' sorts in date order and
// the input is never Date-parsed at all. The boundary is derived from NEPAL_END's
// local parts (a local-datetime literal has the same parts on every machine), so the
// trip dates stay configured in one place.
const NEPAL_END_DAY = `${NEPAL_END.getFullYear()}-${String(NEPAL_END.getMonth() + 1).padStart(2, '0')}-${String(NEPAL_END.getDate()).padStart(2, '0')}`; // '2026-12-18'

export function getCountryForDate(dateStr: string): 'nepal' | 'japan' {
  return dateStr <= NEPAL_END_DAY ? 'nepal' : 'japan';
}

export function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatDateLong(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}
