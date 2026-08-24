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
// a single-leg custom pack has neither a 'nepal' nor a 'japan' leg — fall back to the
// first leg's offset so this never crashes at module load (same guard as trip-dates.ts). The
// DEFAULT pack still finds both named legs, so NPT/JST stay byte-identical (345 / 540).
const offsetForLeg = (id: string): number =>
  (activeTrip.legs.find((l) => l.id === id) ?? activeTrip.legs[0]).utcOffsetMin;

/** Nepal Time = UTC+5:45 = +345 min. The `:45` is why B-01 field arithmetic matters. */
export const NPT_OFFSET_MIN = offsetForLeg('nepal');
/** Japan Standard Time = UTC+9:00 = +540 min. */
export const JST_OFFSET_MIN = offsetForLeg('japan');

// A pack with no leg carrying a real offset (every leg's utcOffsetMin is the "unknown
// geography" placeholder 0) has no basis for a UTC anchor — fall back to the device's own
// offset, the same convention lib/trip-now.ts's tripOffsetMinFor already uses for this case.
const hasRealGeography = activeTrip.legs.some((l) => l.utcOffsetMin !== 0);

/**
 * The offset the PACK ITSELF declares for a leg — no device substitution, ever. Looks the leg up
 * by id in the active pack; an unknown id defaults to NPT. For the default pack this is
 * `'nepal'` → 345 / `'japan'` → 540; for a custom pack it is the placeholder 0.
 *
 * This is the offset an ASSERTION may be built on (`zoneAbbrevForOffset`, and through it the
 * item-time badge), as opposed to the one instant math anchors on. #243: the two questions are
 * genuinely different. "What UTC instant is this wall-clock?" has to answer something for a pack
 * with no geography, and the device offset is the honest anchor there — that is what
 * `offsetForCountry` and `lib/trip-now.ts`'s `tripOffsetMinFor` both do. "Which zone may we PRINT
 * on this time?" must answer NOTHING in that case, and feeding the device answer to the first
 * question into the second is what badged a Paris trip `EST`.
 */
export function declaredOffsetForCountry(c: string): number {
  const leg = activeTrip.legs.find((l) => l.id === c);
  return leg ? leg.utcOffsetMin : NPT_OFFSET_MIN;
}

/** The day's place offset from its leg, for UTC-instant math. The declared leg offset when the
 * pack has real geography, else the device's own (see `hasRealGeography` above).
 * For the default pack, `'nepal'` → 345 and `'japan'` → 540 exactly as before. */
export function offsetForCountry(c: string): number {
  if (!hasRealGeography) return -new Date().getTimezoneOffset();
  return declaredOffsetForCountry(c);
}

/**
 * The zone abbreviations this app is willing to print on a time. Deliberately a closed union,
 * not `string`: a badge is an ASSERTION about where a wall-clock is, and an unknown offset must
 * stay silent rather than invent one.
 */
export type ZoneAbbrev = 'NPT' | 'JST' | 'EST' | 'IST' | 'CST';

/**
 * UTC offset (minutes east) → zone abbreviation, for the offsets the trip actually visits
 * A TABLE, not a service — five rows, one lookup.
 *
 * ⚖️ KNOWN CEILING: a fixed offset→abbreviation table is only sound while every offset here is
 * unambiguous for the dates in play. It is, for THIS trip: -300 occurs only in December and
 * January (US Eastern standard time — in July the same wall-clock place is -240/EDT), India
 * never observes DST, and China does not either. A summer-dated trip, or a pack that reuses
 * -300 in June, needs a real IANA zone id resolved per date, not this table. Do not extend it
 * with a summer offset without making that change first.
 */
const ZONE_ABBREV_BY_OFFSET: Record<number, ZoneAbbrev> = {
  345: 'NPT', // Nepal
  540: 'JST', // Japan
  [-300]: 'EST', // US Eastern (Syracuse / JFK / Detroit — December & January only)
  330: 'IST', // India (Delhi layover)
  480: 'CST', // China (Guangzhou layover)
};

/**
 * The abbreviation to badge for a UTC offset, or `null` when the offset is not one this trip
 * knows. `null` means NO badge — never a fabricated label and never "UTC+8".
 */
export function zoneAbbrevForOffset(offsetMin: number): ZoneAbbrev | null {
  return ZONE_ABBREV_BY_OFFSET[offsetMin] ?? null;
}

/**
 * The offset (minutes east of UTC) to use for ONE item's UTC-instant math: the item's
 * own `tzOffsetMin` override when present — the rare item whose wall-clock time is physically
 * in a different place than the day's country (e.g. a Guangzhou layover logged on a Japan
 * day) — else the day's place offset unchanged. Every item without the override is
 * byte-identical to before (falls straight through to `dayOffsetMin`).
 */
export function effectiveOffsetMin(item: ItineraryItem, dayOffsetMin: number): number {
  return typeof item.tzOffsetMin === 'number' ? item.tzOffsetMin : dayOffsetMin;
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
 * The ONE free-text `duration` parser (D-316). Derives minutes AT READ from the text the
 * seed content and the v5 vault already hold — there is deliberately NO migration and no
 * re-authoring of the 158 seed strings (D-139 locks "the migration never sets
 * `durationMinutes`"; D-095 forbids reordering shipped steps).
 *
 * The grammar is EXACTLY what the data holds and what `lib/time-picker-format.ts`'s
 * `formatDurationText` emits, nothing wider — case-insensitive, trimmed:
 * 1. `<h>h [<m>m]` with an optional decimal hour — '1h', '1.5h', '3.25h', '14h 55m'
 * 2. `<m>m` / `<m>min` — '45m', '30min'
 *
 * Everything else → `undefined`, and so does anything resolving to zero or less ('0h',
 * '0m'). An item with no parseable duration has NO SPAN: it can never clash and can never
 * block a save. That permissive failure is the same one D-139 chose for `time` — never
 * throws, never logs, never defaults. TOTAL (guards a non-string, like `parseTimeString`).
 */
export function parseDurationText(raw: string): number | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim().toLowerCase();
  if (s === '') return undefined;

  // <h>h with an optional decimal part, plus an optional trailing <m>m.
  const hm = /^(\d+(?:\.\d+)?)h(?:\s*(\d{1,2})m)?$/.exec(s);
  if (hm) {
    const total = Math.round(Number(hm[1]) * 60) + (hm[2] === undefined ? 0 : Number(hm[2]));
    return total > 0 ? total : undefined;
  }

  // bare minutes: '45m' / '30min'
  const m = /^(\d+)\s*m(?:in)?$/.exec(s);
  if (m) {
    const total = Number(m[1]);
    return total > 0 ? total : undefined;
  }

  return undefined;
}

/**
 * The item's effective span length in minutes, or `undefined` (no span). Mirrors
 * `effectiveStartMinutes` exactly: a valid positive-integer `durationMinutes` wins, else the
 * legacy free-text `duration` is parsed, else `undefined`. So a structured value written by
 * the picker always beats the text, and a buggy structured value degrades to the text (or to
 * "no span") rather than asserting a bogus interval.
 */
export function effectiveDurationMinutes(item: ItineraryItem): number | undefined {
  const dm = item.durationMinutes;
  if (typeof dm === 'number' && Number.isInteger(dm) && dm > 0) return dm;
  return typeof item.duration === 'string' ? parseDurationText(item.duration) : undefined;
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

// `isPastAtPlace` DELETED. Inlined its one-line body
// (`placeWallClockToUtcMs(...) < now`) into `lib/whats-next.ts`, leaving zero production
// call sites and a 6-assertion suite testing nothing else reached. The strictness it
// encoded (an item exactly AT "now" is still upcoming) lives on at that call site.
