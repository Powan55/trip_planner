import type { DayPlan, ItineraryItem } from '@/lib/trip-data';
import {
  effectiveDurationMinutes,
  effectiveOffsetMin,
  effectiveStartMinutes,
  hasRealGeography,
  offsetForCountry,
  placeWallClockToUtcMs,
} from '@/core/dates/item-time';

/**
 * Itinerary → iCalendar (.ics) export — a pure, framework-free serializer (#259), mirroring
 * `lib/expense-csv.ts`'s shape: string in, string out, zero npm deps. The caller Blob-downloads
 * the result via the same `URL.createObjectURL` + `<a download>` idiom as `settings-panel.tsx` /
 * `core/vault/export-import.ts`.
 *
 * One VEVENT per (non-deleted) item across every day. Reuses the SAME time helpers the rest of
 * the app uses for item time math (`core/dates/item-time.ts`) rather than re-deriving them —
 * `effectiveStartMinutes`/`effectiveDurationMinutes` already fold the structured
 * `startMinutes`/`durationMinutes` fields together with the legacy free-text `time`/`duration`
 * fallback, and `placeWallClockToUtcMs` already does the B-01-safe wall-clock→UTC field math.
 *
 * A timed item becomes a UTC DTSTART/DTEND pair (no VTIMEZONE needed — every calendar app
 * renders a UTC instant in the viewer's own local time, which is what a lock-screen alarm wants
 * anyway) — UNLESS the active pack has no real geography (a custom trip whose legs still carry
 * the placeholder `utcOffsetMin: 0`) and the item has no explicit `tzOffsetMin` override, in
 * which case there is no honest UTC instant to anchor on and the event is emitted as a FLOATING
 * local time (`YYYYMMDDTHHMMSS`, no `Z`) instead — the wall-clock the traveller typed, exactly,
 * with no DST/offset math to get wrong. An untimed item becomes an all-day `VALUE=DATE` event;
 * DTEND is EXCLUSIVE per RFC 5545 so a single-day all-day event's DTEND is the NEXT calendar day.
 * A multi-day span (`item.endDate` past the rendered day) widens the all-day DTEND to match —
 * this applies to a TIMED item too, since a multi-day span has no single wall-clock instant to
 * anchor a timed VEVENT on either.
 *
 * KNOWN CEILING: no RFC 5545 75-octet line folding — every calendar app this was checked against
 * (and every major consumer app in practice) accepts an unfolded long SUMMARY/DESCRIPTION line;
 * add folding if a real import target is found rejecting one.
 */

const DEFAULT_DURATION_MIN = 60;
const ICS_LINE_END = '\r\n';

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/**
 * Escape a TEXT property value per RFC 5545 section 3.3.11: backslash, semicolon, comma and newline.
 * Order matters — backslash MUST be escaped first, so the backslashes this function itself
 * inserts for `;`/`,`/`\n` are never re-escaped by a later step.
 */
function icsEscapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** UTC epoch ms → ICS UTC datetime `YYYYMMDDTHHMMSSZ`. */
function formatUtcStamp(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** Wall-clock date + minutes-from-midnight → ICS FLOATING local datetime `YYYYMMDDTHHMMSS`
 * (no trailing `Z`) — no offset applied, so day-rollover from a minutes count past 1439 is
 * handled the same field-arithmetic way `placeWallClockToUtcMs` handles a real offset. */
function formatFloatingStamp(dateStr: string, minutes: number): string {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d, 0, minutes));
  return (
    `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}` +
    `T${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}${pad(dt.getUTCSeconds())}`
  );
}

/** ISO `YYYY-MM-DD` shifted by `days` (may be negative/zero) → ICS all-day date `YYYYMMDD`. */
function formatIcsDate(dateStr: string, days: number): string {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, mo - 1, d + days));
  return `${shifted.getUTCFullYear()}${pad(shifted.getUTCMonth() + 1)}${pad(shifted.getUTCDate())}`;
}

function eventLines(day: DayPlan, item: ItineraryItem, dtstamp: string): string[] {
  const lines = ['BEGIN:VEVENT', `UID:${item.id}@trip-planner.local`, `DTSTAMP:${dtstamp}`];

  const startMin = effectiveStartMinutes(item);
  const spansDays = Boolean(item.endDate && item.endDate > day.date);
  if (startMin === undefined || spansDays) {
    lines.push(`DTSTART;VALUE=DATE:${formatIcsDate(day.date, 0)}`);
    const endDate = spansDays ? item.endDate! : day.date;
    lines.push(`DTEND;VALUE=DATE:${formatIcsDate(endDate, 1)}`);
  } else if (!hasRealGeography && typeof item.tzOffsetMin !== 'number') {
    const durationMin = effectiveDurationMinutes(item) ?? DEFAULT_DURATION_MIN;
    lines.push(`DTSTART:${formatFloatingStamp(day.date, startMin)}`);
    lines.push(`DTEND:${formatFloatingStamp(day.date, startMin + durationMin)}`);
  } else {
    const startMs = placeWallClockToUtcMs(
      day.date,
      startMin,
      effectiveOffsetMin(item, offsetForCountry(day.country)),
    );
    const durationMin = effectiveDurationMinutes(item) ?? DEFAULT_DURATION_MIN;
    lines.push(`DTSTART:${formatUtcStamp(startMs)}`);
    lines.push(`DTEND:${formatUtcStamp(startMs + durationMin * 60_000)}`);
  }

  lines.push(`SUMMARY:${icsEscapeText(item.title)}`);
  if (item.notes) lines.push(`DESCRIPTION:${icsEscapeText(item.notes)}`);
  if (item.location) lines.push(`LOCATION:${icsEscapeText(item.location)}`);
  lines.push('END:VEVENT');
  return lines;
}

/**
 * Serialize an itinerary (every day's non-deleted items) as an RFC 5545 iCalendar string.
 * Pure — no storage read, no Date.now() dependency other than DTSTAMP (required by the spec on
 * every VEVENT; it is not otherwise meaningful and callers should not assert its exact value).
 */
export function itineraryToIcs(plans: readonly DayPlan[]): string {
  const dtstamp = formatUtcStamp(Date.now());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Trip Planner//Itinerary Export//EN',
    'CALSCALE:GREGORIAN',
  ];
  for (const day of plans) {
    for (const item of day.items) {
      if (item.deleted) continue;
      lines.push(...eventLines(day, item, dtstamp));
    }
  }
  lines.push('END:VCALENDAR');
  return lines.join(ICS_LINE_END) + ICS_LINE_END;
}

/** The same .ics as a downloadable Blob, RFC 5545 section 3.1's registered MIME type. */
export function itineraryToIcsBlob(plans: readonly DayPlan[]): Blob {
  return new Blob([itineraryToIcs(plans)], { type: 'text/calendar;charset=utf-8;' });
}
