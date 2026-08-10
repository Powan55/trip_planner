import { describe, it, expect } from 'vitest';
import {
  buildFlightTrackerUrl,
  buildRome2RioUrl,
  buildGoogleFlightsUrl,
} from '@/lib/flight-deep-links';
import { JOURNEYS } from '@/lib/booking-data';
import { TRAVEL_DAY_JOURNEYS } from '@/components/travel-essentials-card';

/**
 * S325 — the "one tested source" guarantee for flight deep-links.
 *
 * TWO surfaces render FlightRadar24 / Rome2Rio / Google-Flights deep-links:
 *   1. `/flights` (components/flights-section.tsx — the "Check live status" rail), and
 *   2. Travel Mode's `travel-essentials-card.tsx` (the day-gated FlightCard).
 * Both build their hrefs from the SAME `lib/flight-deep-links.ts` builders fed by the
 * SAME `lib/booking-data.ts#JOURNEYS`. Before this slice, nothing tied the two together,
 * so they could silently drift. These assertions pin that shared derivation:
 *   - every JOURNEYS leg resolves a real FR24 tracker (what BOTH rails render per leg),
 *   - every journey yields https Rome2Rio + Google-Flights routes from its verbatim
 *     from/to summaries (D-034: no parse/recompute — the summary strings are passed as-is),
 *   - Travel Mode's TRAVEL_DAY_JOURNEYS references ONLY objects that are members of
 *     JOURNEYS by identity — so it can never point at a stale/forked copy.
 */

describe('flight deep-links bind to booking-data JOURNEYS (shared by /flights + Travel Mode)', () => {
  it('every leg of every journey resolves a real FlightRadar24 tracker (no silent nulls)', () => {
    for (const journey of JOURNEYS) {
      for (const leg of journey.legs) {
        const url = buildFlightTrackerUrl(leg.flightNumber);
        expect(url, `no tracker for ${journey.id}/${leg.id} (${leg.flightNumber})`).not.toBeNull();
        expect(url).toMatch(/^https:\/\/www\.flightradar24\.com\/data\/flights\//);
      }
    }
  });

  it('every journey yields https Rome2Rio + Google-Flights routes from its verbatim summaries', () => {
    for (const journey of JOURNEYS) {
      const r2r = buildRome2RioUrl(journey.fromSummary, journey.toSummary);
      const gf = buildGoogleFlightsUrl(journey.fromSummary, journey.toSummary);
      expect(r2r).toMatch(/^https:\/\/www\.rome2rio\.com\/s\//);
      expect(gf).toMatch(/^https:\/\/www\.google\.com\/travel\/flights\?q=/);
      // D-034: summaries are passed through untouched (URL-encoded), never reparsed.
      expect(r2r).toContain(encodeURIComponent(journey.fromSummary));
      expect(gf).toContain(encodeURIComponent(`Flights from ${journey.fromSummary} to ${journey.toSummary}`));
    }
  });
});

describe('Travel Mode day-gated journeys stay consistent with JOURNEYS', () => {
  it('every TRAVEL_DAY_JOURNEYS entry is a JOURNEYS member by identity (no drift/fork)', () => {
    for (const [date, journeys] of Object.entries(TRAVEL_DAY_JOURNEYS)) {
      for (const j of journeys) {
        expect(JOURNEYS, `${date} references a journey not in JOURNEYS: ${j.id}`).toContain(j);
      }
    }
  });
});
