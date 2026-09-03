// The journey bar's derivation (issue #92). Two halves: the PURE function against a
// synthetic pack that is not the default one, and the app's binding of it against the pack
// that actually ships. The second half is what would go red if the itinerary's cities or the
// leg boundary moved without the bar being looked at.

import { describe, it, expect } from 'vitest';
import { deriveJourneyLegs, journeyLegs } from '@/lib/journey-legs';
import { TRIP_DATES } from '@/core/dates';

const dates = (...d: string[]) => d;

describe('deriveJourneyLegs', () => {
  const legs = [
    { id: 'a', countryLabel: 'Alpha', start: '2026-03-01', end: '2026-03-03' },
    { id: 'b', countryLabel: 'Beta', start: '2026-03-04', end: '2026-03-09' },
    { id: 'z', countryLabel: 'Zulu', start: '2026-04-01', end: '2026-04-02' },
  ];
  const CITIES: Record<string, string> = {
    '2026-02-28': 'Nowhere',
    '2026-03-01': 'One',
    '2026-03-02': 'One',
    '2026-03-03': 'Two',
    '2026-03-04': 'Three',
    '2026-03-09': 'Three',
    '2026-03-10': 'Four',
  };
  const cityFor = (d: string) => CITIES[d] ?? '';
  const all = dates('2026-02-28', '2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-09', '2026-03-10');

  it('weights each leg by the days the trip actually spends in it', () => {
    const out = deriveJourneyLegs(legs, all, cityFor);
    expect(out.map((l) => [l.id, l.days])).toEqual([
      ['a', 3],
      ['b', 2],
    ]);
  });

  it('drops a leg the trip dates never reach, rather than drawing a zero-width segment', () => {
    expect(deriveJourneyLegs(legs, all, cityFor).map((l) => l.id)).not.toContain('z');
    expect(deriveJourneyLegs(legs, [], cityFor)).toEqual([]);
  });

  it('reports the first and last date INSIDE the leg, not the leg’s declared span', () => {
    const [a, b] = deriveJourneyLegs(legs, all, cityFor);
    expect([a.start, a.end]).toEqual(['2026-03-01', '2026-03-03']);
    // b is declared through the 9th but the date list only holds the 4th and the 9th.
    expect([b.start, b.end]).toEqual(['2026-03-04', '2026-03-09']);
  });

  it('classifies the boundary days lexicographically and clamps nothing', () => {
    const out = deriveJourneyLegs(legs, all, cityFor);
    // The 3rd is the last day of a, the 4th the first day of b...
    expect(out[0].cities).toContain('Two');
    expect(out[1].cities).toContain('Three');
    // ...and a date OUTSIDE every leg belongs to none of them. `legForDate` clamps to the
    // nearest leg by design; this derivation must not, or the rail would grow days the trip
    // does not have. 3 + 2 = 5 of the 7 dates.
    expect(out.reduce((n, l) => n + l.days, 0)).toBe(5);
    expect(out.flatMap((l) => l.cities)).not.toContain('Nowhere');
    expect(out.flatMap((l) => l.cities)).not.toContain('Four');
  });

  it('deduplicates cities and keeps them in date order', () => {
    const [a] = deriveJourneyLegs(legs, all, cityFor);
    expect(a.cities).toEqual(['One', 'Two']);
  });

  it('carries the pack label through and never the raw leg id', () => {
    expect(deriveJourneyLegs(legs, all, cityFor).map((l) => l.label)).toEqual(['Alpha', 'Beta']);
  });

  it('skips an empty city answer rather than rendering a blank chip', () => {
    const out = deriveJourneyLegs(legs, all, () => '');
    expect(out[0].cities).toEqual([]);
  });
});

describe('journeyLegs (the shipped pack)', () => {
  it('is the two legs, and their days add up to the trip', () => {
    const out = journeyLegs();
    expect(out.map((l) => [l.id, l.label, l.days])).toEqual([
      ['nepal', 'Nepal', 10],
      ['japan', 'Japan', 22],
    ]);
    expect(out.reduce((n, l) => n + l.days, 0)).toBe(TRIP_DATES.length);
  });

  it('splits on the Dec 18 / Dec 19 boundary', () => {
    const [nepal, japan] = journeyLegs();
    expect([nepal.start, nepal.end]).toEqual(['2026-12-09', '2026-12-18']);
    expect([japan.start, japan.end]).toEqual(['2026-12-19', '2027-01-09']);
  });

  it('lists the real per-day cities, in date order', () => {
    const [nepal, japan] = journeyLegs();
    // Dec 9 is the departure day and is spent in New York (D-315) — the leg id stays
    // 'nepal' for currency and offset, so the rail shows the city the day is actually in.
    // Kirtipur (Dec 11) and Chitlang (Dec 15) joined the rail with the Nepal leg rebuild.
    expect(nepal.cities).toEqual([
      'New York',
      'Kathmandu',
      'Kirtipur',
      'Lalitpur',
      'Nagarkot',
      'Chitlang',
      'Bhaktapur',
    ]);
    expect(japan.cities).toEqual(['Osaka', 'Nara', 'Kyoto', 'Tokyo', 'Kamakura', 'Kawaguchiko']);
  });
});
