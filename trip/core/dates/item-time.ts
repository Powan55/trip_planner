/**
 * Structured item-time helpers — the ONE framework-free home for all item-time math
 * Nothing else in the codebase does offset math,
 * parses a time string, or formats one. Type-only `lib` import.
 *
 * B-01 discipline: no `new Date(string)` parsing anywhere. Cross-TZ arithmetic is confined
 * to `placeWallClockToUtcMs` — split the ISO date into fields and use `Date.UTC` only, which
 * is deterministic on every machine regardless of the host timezone.
 */
import type { ItineraryItem } from '@/lib/trip-data';
import { getActiveTrip } from '@/core/trips';

// As of the per-leg wall-clock offsets are DERIVED from the active trip pack's legs
// (`utcOffsetMin`) rather than hardcoded, so a pack authors its own offsets in one place.
// Byte-identical for the default pack: NPT 345 / JST 540.
const activeTrip = getActiveTrip();
const offsetForLeg = (id: string): number => activeTrip.legs.find((l) => l.id === id)!.utcOffsetMin;

/** Nepal Time = UTC+5:45 = +345 min. The `:45` is why B-01 field arithmetic matters. */
export const NPT_OFFSET_MIN = offsetForLeg('nepal');
/** Japan Standard Time = UTC+9:00 = +540 min. */
export const JST_OFFSET_MIN = offsetForLeg('japan');

/** The day's place offset from its country. */
export function offsetForCountry(c: 'nepal' | 'japan'): number {
  return c === 'japan' ? JST_OFFSET_MIN : NPT_OFFSET_MIN;
}

/**
 * The ONE shared time-string parser — used by BOTH the Vault v4→v5 migration AND
 * the runtime fallback (`effectiveStartMinutes`), because sync-ingested / seed items reach
 * the runtime with a `time` but no `startMinutes` forever in a mixed fleet; the two paths
 * MUST agree or the same item renders differently depending on how it arrived.
 *
 * Best-effort = EXACTLY these three shapes, case-insensitive, trimmed:
 * 1. 24h colon `H:MM` / `HH:MM` — H 0–23, MM 00–59 ("06:00"→360, "23:59"→1439)
 * 2. 24h dot `H.MM` / `HH.MM` — same ranges ("14.30"→870)
 * 3. 12h am/pm `h(:mm|.mm)? am/pm` — h 1–12, mm 00–59; optional space, optional periods
 * ("a.m."); 12am→0, 12pm→720 ("2pm"→840, "12:30 p.m."→750)
 *
 * Everything else → `undefined` (bare numbers, ranges, words, trailing text, out-of-range).
 * TOTAL — never throws (guards a non-string too, since the migration runs on raw payload
 * before Zod). Do NOT widen without tests + real quarantine-free data.
 */
export function parseTimeString(raw: string): number | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim().toLowerCase();
  if (s === '') return undefined;

  // 12h am/pm: h(:mm|.mm)? (space)? a/p (.)? m (.)?
  const ampm = /^(\d{1,2})(?:[:.](\d{2}))?\s*([ap])\.?m\.?$/.exec(s);
  if (ampm) {
    const h = Number(ampm[1]);
    const mm = ampm[2] === undefined ? 0 : Number(ampm[2]);
    if (h < 1 || h > 12 || mm > 59) return undefined;
    const base = (h % 12) * 60 + mm; // 12 → 0 (12am→0, 12pm handled by the +720 below)
    return ampm[3] === 'p' ? base + 720 : base;
  }

  // 24h colon or dot: H:MM / HH:MM / H.MM / HH.MM
  const h24 = /^(\d{1,2})[:.](\d{2})$/.exec(s);
  if (h24) {
    const h = Number(h24[1]);
    const mm = Number(h24[2]);
    if (h > 23 || mm > 59) return undefined;
    return h * 60 + mm;
  }

  return undefined;
}

/**
 * The item's effective start-of-day minutes, or `undefined` (untimed). This is the ONE
 * range-validation point: a valid integer `startMinutes` in 0–1439 wins; any
 * out-of-range / non-integer value falls through to parsing the legacy `time` text, so a
 * buggy structured value degrades to "untimed" (or the parseable legacy value) rather than
 * quarantining a whole vault.
 */
export function effectiveStartMinutes(item: ItineraryItem): number | undefined {
  const sm = item.startMinutes;
  if (typeof sm === 'number' && Number.isInteger(sm) && sm >= 0 && sm <= 1439) return sm;
  return typeof item.time === 'string' ? parseTimeString(item.time) : undefined;
}

/** Format minutes-from-midnight as a 12h clock label. 0→"12:00 AM", 720→"12:00 PM", 855→"2:15 PM". */
export function formatTimeAmPm(minutes: number): string {
  const m = ((Math.trunc(minutes) % 1440) + 1440) % 1440; // safety wrap; callers pass 0–1439
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const period = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${period}`;
}

/**
 * Convert a place-local wall-clock (date + minutes-from-midnight + the place's UTC offset)
 * to a UTC epoch-ms instant. PURE field arithmetic (B-01-safe): the ISO date is SPLIT into
 * y/mo/d and fed to `Date.UTC` — never `new Date(string)`, never a local-TZ getter. So
 * 05:45 NPT (minutes 345, offset +345) is exactly midnight UTC on the same date.
 */
export function placeWallClockToUtcMs(dateStr: string, minutes: number, offsetMin: number): number {
  const [y, mo, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, mo - 1, d, 0, minutes - offsetMin);
}

/**
 * Is a place-local item instant strictly before "now" (an injected UTC epoch-ms)? An item
 * exactly at "now" is NOT past — the `<` strictness preserved from the old `nextUp` (an
 * item whose time equals now is still upcoming). Instant comparison (not minutes-of-day),
 * so it stays correct across a day boundary for a viewer far from the trip zone.
 */
export function isPastAtPlace(
  dateStr: string,
  startMinutes: number,
  offsetMin: number,
  nowUtcMs: number,
): boolean {
  return placeWallClockToUtcMs(dateStr, startMinutes, offsetMin) < nowUtcMs;
}
