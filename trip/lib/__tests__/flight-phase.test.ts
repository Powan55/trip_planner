import { describe, it, expect } from 'vitest';
import {
  JOURNEYS, OUTBOUND_JOURNEY, RETURN_TO_JAPAN_JOURNEY, TOKYO_TO_OSAKA_JOURNEY, FLIGHT_HOME_JOURNEY,
} from '@/lib/booking-data';
import { TRIP_DATES } from '@/core/dates';
import { getFlightTiming } from '@/lib/flight-phase';

/**
 * S326 / D-233 — the flight-card timing seam.
 *
 * `Journey.departDate` is the AUTHORED, date-only anchor the phase strip + proximity countdown
 * target (via the trip-clock, NEVER a booking label). These assertions pin:
 *   - the outbound card can't diverge from the hero: its departDate IS TRIP_DATES[0] (D-233);
 *   - every journey's departDate is a real TRIP_DATES member (in the trip window);
 *   - the day-granularity phase logic (upcoming → departing → completed) is correct for an
 *     injected `now`, which is exactly what drives the `?today=` behavior in the browser.
 */

describe('booking-data departDate is a TRIP_DATES-anchored authored field (D-233)', () => {
  it('OUTBOUND_JOURNEY.departDate === TRIP_DATES[0] (pins the outbound card to the hero)', () => {
    expect(OUTBOUND_JOURNEY.departDate).toBe(TRIP_DATES[0]);
  });

  it('every journey departDate is a member of TRIP_DATES', () => {
    for (const j of JOURNEYS) {
      expect(TRIP_DATES, `${j.id} departDate ${j.departDate} not in the trip window`).toContain(j.departDate);
    }
  });

  it('the authored departDates match each journey first-leg departure day', () => {
    expect(OUTBOUND_JOURNEY.departDate).toBe('2026-12-09');
    expect(RETURN_TO_JAPAN_JOURNEY.departDate).toBe('2026-12-18');
    expect(TOKYO_TO_OSAKA_JOURNEY.departDate).toBe('2026-12-19');
    expect(FLIGHT_HOME_JOURNEY.departDate).toBe('2027-01-09');
  });
});

describe('getFlightTiming day-granularity phase (injected now — pure)', () => {
  const at = (s: string) => new Date(s); // local time

  it('before the depart day → upcoming, with a live (non-past) countdown', () => {
    const t = getFlightTiming(OUTBOUND_JOURNEY, at('2026-12-01T12:00:00'));
    expect(t.phase).toBe('upcoming');
    expect(t.countdown.isPast).toBe(false);
    expect(t.countdown.totalDays).toBeGreaterThan(0);
  });

  it('on the depart day → departing (even at afternoon, past local midnight target)', () => {
    const t = getFlightTiming(OUTBOUND_JOURNEY, at('2026-12-09T15:00:00'));
    expect(t.phase).toBe('departing');
  });

  it('after the depart day → completed', () => {
    const t = getFlightTiming(OUTBOUND_JOURNEY, at('2026-12-10T09:00:00'));
    expect(t.phase).toBe('completed');
  });

  it('shared clock: at 2026-12-09 the outbound is departing while the other three still count down', () => {
    const now = at('2026-12-09T12:00:00');
    expect(getFlightTiming(OUTBOUND_JOURNEY, now).phase).toBe('departing');
    for (const j of [RETURN_TO_JAPAN_JOURNEY, TOKYO_TO_OSAKA_JOURNEY, FLIGHT_HOME_JOURNEY]) {
      const t = getFlightTiming(j, now);
      expect(t.phase, `${j.id} should still be upcoming on Dec 9`).toBe('upcoming');
      expect(t.countdown.isPast).toBe(false);
    }
  });
});
