/**
 * Pure formatting/combination helpers for the AM/PM time picker
 * (`components/time-picker.tsx`) and its duration companion field.
 *
 * Deliberately NOT added to `core/dates/item-time.ts` (
 * module): this slice is presentation-only wiring, and these are the INVERSE
 * of that module's parsing (minutes -> text, not text -> minutes), used only
 * to satisfy the dual-write rule when a user picks a value in the UI.
 * No new parsing and no offset/timezone math lives here.
 */

/** The picker's default position when opened on a blank (untimed) item. */
export const DEFAULT_TIME_MINUTES = 9 * 60; // 9:00 AM

/** Format minutes-from-midnight (0-1439) as the canonical 24h "HH:MM" dual-write text. */
export function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Format elapsed minutes as a short human duration: "45m", "2h", "1h 30m". */
export function formatDurationText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export type Period = 'AM' | 'PM';

/** Split 0-1439 minutes into the picker's three column values. */
export function splitMinutes(total: number): { hour12: number; minute: number; period: Period } {
  const h24 = Math.floor(total / 60);
  const period: Period = h24 < 12 ? 'AM' : 'PM';
  const hour12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return { hour12, minute: total % 60, period };
}

/** Combine the picker's three column values back into 0-1439 minutes. */
export function combineMinutes(hour12: number, minute: number, period: Period): number {
  const h24 = period === 'AM' ? hour12 % 12 : (hour12 % 12) + 12;
  return h24 * 60 + minute;
}
