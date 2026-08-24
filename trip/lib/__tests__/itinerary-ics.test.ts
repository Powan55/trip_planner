import { describe, it, expect } from 'vitest';
import { itineraryToIcs, itineraryToIcsBlob } from '@/lib/itinerary-ics';
import type { DayPlan, ItineraryItem } from '@/lib/trip-data';

/**
 * #259 — `itineraryToIcs` (pure, framework-free RFC 5545 serializer). Covers a timed item, an
 * untimed (all-day) item, and TEXT-property escaping (comma/semicolon/newline/backslash).
 */

function item(over: Partial<ItineraryItem> = {}): ItineraryItem {
  return { id: 'i1', title: 'Visit temple', category: 'sightseeing', ...over };
}

function day(over: Partial<DayPlan> = {}): DayPlan {
  return { date: '2026-12-10', city: 'Kathmandu', country: 'nepal', items: [], ...over };
}

/** Pull one VEVENT's lines out of the calendar by UID, as a Map<PROPERTY, value>. */
function eventProps(ics: string, uid: string): Map<string, string> {
  const block = ics.split('BEGIN:VEVENT').find((b) => b.includes(`UID:${uid}@`));
  if (!block) throw new Error(`no VEVENT for uid ${uid}`);
  const body = block.split('END:VEVENT')[0];
  const props = new Map<string, string>();
  for (const line of body.split('\r\n')) {
    const i = line.indexOf(':');
    if (i === -1) continue;
    props.set(line.slice(0, i), line.slice(i + 1));
  }
  return props;
}

describe('itineraryToIcs', () => {
  it('wraps events in a valid VCALENDAR with CRLF line endings', () => {
    const ics = itineraryToIcs([day({ items: [item()] })]);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('VERSION:2.0\r\n');
  });

  it('a timed item gets a UTC DTSTART/DTEND pair derived from the day + start time', () => {
    const ics = itineraryToIcs([
      day({ date: '2026-12-10', country: 'nepal', items: [item({ id: 't1', startMinutes: 9 * 60, durationMinutes: 90 })] }),
    ]);
    const props = eventProps(ics, 't1');
    // Nepal is UTC+5:45 (345 min): 09:00 NPT = 03:15 UTC.
    expect(props.get('DTSTART')).toBe('20261210T031500Z');
    expect(props.get('DTEND')).toBe('20261210T044500Z'); // +90 min
    expect(props.get('SUMMARY')).toBe('Visit temple');
  });

  it('an untimed item becomes an all-day VALUE=DATE event with an exclusive next-day DTEND', () => {
    const ics = itineraryToIcs([day({ date: '2026-12-11', items: [item({ id: 'u1' })] })]);
    const props = eventProps(ics, 'u1');
    expect(props.get('DTSTART;VALUE=DATE')).toBe('20261211');
    expect(props.get('DTEND;VALUE=DATE')).toBe('20261212');
    expect(props.has('DTSTART')).toBe(false);
  });

  it('a title with a comma, semicolon and newline is escaped per RFC 5545', () => {
    const ics = itineraryToIcs([
      day({ items: [item({ id: 'e1', title: 'Lunch, then; dinner\nlate' })] }),
    ]);
    const props = eventProps(ics, 'e1');
    expect(props.get('SUMMARY')).toBe('Lunch\\, then\\; dinner\\nlate');
  });

  it('a literal backslash is escaped before other characters', () => {
    const ics = itineraryToIcs([day({ items: [item({ id: 'b1', title: 'C:\\trip, notes' })] })]);
    expect(eventProps(ics, 'b1').get('SUMMARY')).toBe('C:\\\\trip\\, notes');
  });

  it('deleted (tombstoned) items are excluded', () => {
    const ics = itineraryToIcs([day({ items: [item({ id: 'd1', deleted: true })] })]);
    expect(ics).not.toContain('d1@');
  });

  it('notes/location become DESCRIPTION/LOCATION when present, and are omitted when absent', () => {
    const withBoth = eventProps(
      itineraryToIcs([day({ items: [item({ id: 'n1', notes: 'Bring cash', location: 'Durbar Square' })] })]),
      'n1',
    );
    expect(withBoth.get('DESCRIPTION')).toBe('Bring cash');
    expect(withBoth.get('LOCATION')).toBe('Durbar Square');

    const withNeither = eventProps(itineraryToIcs([day({ items: [item({ id: 'n2' })] })]), 'n2');
    expect(withNeither.has('DESCRIPTION')).toBe(false);
    expect(withNeither.has('LOCATION')).toBe(false);
  });

  it('empty itinerary → an empty-but-valid calendar (no VEVENT)', () => {
    const ics = itineraryToIcs([]);
    expect(ics).toBe('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Trip Planner//Itinerary Export//EN\r\nCALSCALE:GREGORIAN\r\nEND:VCALENDAR\r\n');
  });
});

describe('itineraryToIcsBlob', () => {
  it('is served as text/calendar and matches the pure serializer', async () => {
    const plans = [day({ items: [item()] })];
    const blob = itineraryToIcsBlob(plans);
    expect(blob.type).toBe('text/calendar;charset=utf-8;');
    expect(await blob.text()).toBe(itineraryToIcs(plans));
  });
});
