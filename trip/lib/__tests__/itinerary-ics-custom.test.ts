import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DayPlan, ItineraryItem } from '@/lib/trip-data';
import type { TripConfig } from '@/core/trips';

/**
 * #586 — a custom trip pack has no real `utcOffsetMin` (every leg carries the placeholder 0),
 * so `itineraryToIcs` has no honest UTC instant to anchor a timed event on and must emit a
 * FLOATING local time instead. `core/dates/item-time.ts` reads `getActiveTrip()` at MODULE LOAD
 * (`roster-active-trip.test.ts`'s pattern), so the mock + a fresh import per test is required —
 * a shared static import would freeze the first-loaded pack for the whole file.
 */
vi.mock('@/core/trips', () => ({ getActiveTrip: (): TripConfig => mockTrip }));

const CUSTOM_TRIP: TripConfig = {
  id: 'custom-1',
  label: 'Custom Trip',
  start: '2026-12-01',
  end: '2026-12-31',
  contentRef: 'custom-1',
  legs: [
    {
      id: 'main',
      countryLabel: 'Somewhere',
      currency: 'USD',
      start: '2026-12-01',
      end: '2026-12-31',
      contentKey: 'custom-1',
      utcOffsetMin: 0, // placeholder — "no real geography"
      fallbackCity: 'Somewhere',
    },
  ],
};

let mockTrip: TripConfig = CUSTOM_TRIP;

function item(over: Partial<ItineraryItem> = {}): ItineraryItem {
  return { id: 'i1', title: 'Item', category: 'sightseeing', ...over };
}

function day(over: Partial<DayPlan> = {}): DayPlan {
  return { date: '2026-12-15', city: 'Somewhere', country: 'main', items: [], ...over };
}

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

beforeEach(() => {
  mockTrip = CUSTOM_TRIP;
});

describe('itineraryToIcs — custom pack (no real geography)', () => {
  it('a timed item gets a FLOATING local time, no Z, no DST drift', async () => {
    vi.resetModules();
    const { itineraryToIcs } = await import('@/lib/itinerary-ics');
    const ics = itineraryToIcs([
      day({ items: [item({ id: 'c1', startMinutes: 9 * 60, durationMinutes: 60 })] }),
    ]);
    const props = eventProps(ics, 'c1');
    expect(props.get('DTSTART')).toBe('20261215T090000');
    expect(props.get('DTEND')).toBe('20261215T100000');
    expect(props.has('DTSTART;VALUE=DATE')).toBe(false);
  });

  it('an explicit tzOffsetMin override still gets a real UTC instant', async () => {
    vi.resetModules();
    const { itineraryToIcs } = await import('@/lib/itinerary-ics');
    const ics = itineraryToIcs([
      day({ items: [item({ id: 'c2', startMinutes: 9 * 60, tzOffsetMin: -300 })] }),
    ]);
    // 09:00 at UTC-300 (EST) = 14:00 UTC.
    expect(eventProps(ics, 'c2').get('DTSTART')).toBe('20261215T140000Z');
  });

  it('a timed item with a multi-day endDate exports as an all-day span, not a single block', async () => {
    vi.resetModules();
    const { itineraryToIcs } = await import('@/lib/itinerary-ics');
    const ics = itineraryToIcs([
      day({
        date: '2026-12-15',
        items: [item({ id: 'c3', startMinutes: 9 * 60, endDate: '2026-12-17' })],
      }),
    ]);
    const props = eventProps(ics, 'c3');
    expect(props.get('DTSTART;VALUE=DATE')).toBe('20261215');
    expect(props.get('DTEND;VALUE=DATE')).toBe('20261218'); // endDate + 1, exclusive
    expect(props.has('DTSTART')).toBe(false);
  });
});

describe('itineraryToIcs — default pack (byte-identical, unaffected by #586)', () => {
  it('still emits a UTC DTSTART for a Nepal-leg item', async () => {
    mockTrip = {
      id: 'nepal-japan-2026',
      label: 'Nepal x Japan',
      start: '2026-12-01',
      end: '2026-12-31',
      contentRef: 'nepal-japan-2026',
      legs: [
        {
          id: 'nepal',
          countryLabel: 'Nepal',
          currency: 'NPR',
          start: '2026-12-01',
          end: '2026-12-20',
          contentKey: 'nepal',
          utcOffsetMin: 345,
          fallbackCity: 'Kathmandu',
        },
        {
          id: 'japan',
          countryLabel: 'Japan',
          currency: 'JPY',
          start: '2026-12-21',
          end: '2026-12-31',
          contentKey: 'japan',
          utcOffsetMin: 540,
          fallbackCity: 'Tokyo',
        },
      ],
    };
    vi.resetModules();
    const { itineraryToIcs } = await import('@/lib/itinerary-ics');
    const ics = itineraryToIcs([
      day({
        date: '2026-12-10',
        country: 'nepal',
        items: [item({ id: 'd1', startMinutes: 9 * 60, durationMinutes: 90 })],
      }),
    ]);
    // Nepal is UTC+5:45 (345 min): 09:00 NPT = 03:15 UTC.
    expect(eventProps(ics, 'd1').get('DTSTART')).toBe('20261210T031500Z');
  });
});
