import { describe, it, expect } from 'vitest';
import {
  buildFlightTrackerUrl,
  buildRome2RioUrl,
  buildGoogleFlightsUrl,
} from '@/lib/flight-deep-links';
import { OUTBOUND_JOURNEY, RETURN_TO_JAPAN_JOURNEY, TOKYO_TO_OSAKA_JOURNEY, FLIGHT_HOME_JOURNEY } from '@/lib/booking-data';

/**
 * S188 — flight/transit deep-link builders (D-074 URL-not-API pattern, D-169 LOCKED: no live
 * flight-status API). Pure string builders — byte-exact href assertions, the `lib/maps-link.ts`
 * precedent (`lib/__tests__/maps-link.test.ts`-style).
 */

describe('buildFlightTrackerUrl (pure)', () => {
  it('builds a byte-exact FlightRadar24 URL for each booked flight number', () => {
    expect(buildFlightTrackerUrl('Delta 5363')).toBe('https://www.flightradar24.com/data/flights/dl5363');
    expect(buildFlightTrackerUrl('Air India 102')).toBe('https://www.flightradar24.com/data/flights/ai102');
    expect(buildFlightTrackerUrl('China Southern Airlines 3068')).toBe('https://www.flightradar24.com/data/flights/cz3068');
    expect(buildFlightTrackerUrl('Japan Airlines 127')).toBe('https://www.flightradar24.com/data/flights/jl127');
  });

  it('resolves a tracker URL for every leg of every booked journey (no silent nulls)', () => {
    const journeys = [OUTBOUND_JOURNEY, RETURN_TO_JAPAN_JOURNEY, TOKYO_TO_OSAKA_JOURNEY, FLIGHT_HOME_JOURNEY];
    for (const journey of journeys) {
      for (const leg of journey.legs) {
        expect(buildFlightTrackerUrl(leg.flightNumber)).not.toBeNull();
      }
    }
  });

  it('returns null for an unmapped airline (never a guessed link)', () => {
    expect(buildFlightTrackerUrl('United 123')).toBeNull();
  });

  it('returns null for a malformed flight-number string', () => {
    expect(buildFlightTrackerUrl('NoSpaceHere')).toBeNull();
    expect(buildFlightTrackerUrl('Delta ABC')).toBeNull();
    expect(buildFlightTrackerUrl('')).toBeNull();
  });
});

describe('buildRome2RioUrl (pure)', () => {
  it('builds a byte-exact Rome2Rio search URL', () => {
    expect(buildRome2RioUrl('Kathmandu (KTM)', 'Tokyo (HND)')).toBe(
      'https://www.rome2rio.com/s/Kathmandu%20(KTM)/Tokyo%20(HND)',
    );
  });

  it('trims whitespace before encoding', () => {
    expect(buildRome2RioUrl(' Tokyo (HND) ', ' Osaka (ITM) ')).toBe(
      'https://www.rome2rio.com/s/Tokyo%20(HND)/Osaka%20(ITM)',
    );
  });
});

describe('buildGoogleFlightsUrl (pure)', () => {
  it('builds a byte-exact Google Flights free-text search URL', () => {
    expect(buildGoogleFlightsUrl('Tokyo (HND)', 'Syracuse (SYR)')).toBe(
      'https://www.google.com/travel/flights?q=Flights%20from%20Tokyo%20(HND)%20to%20Syracuse%20(SYR)',
    );
  });
});
