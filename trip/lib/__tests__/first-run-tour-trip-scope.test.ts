// @vitest-environment jsdom
//
// #244 — the first-run tour's Plan stop read "Build the day-by-day itinerary across all 32 days
// in Nepal and Japan" on EVERY trip. The tour's show condition is mounted + a traveller + not yet
// seen; there is no trip check in it and no DefaultTripOnly around it, so a custom trip's very
// first screen named a destination and a day count that were not theirs. It fires ONCE per
// browser, which is why the ungated-routes sweep (#102/#95/#96/#99) never reached it — it is
// invisible to any repeat-visit check, and therefore invisible to every E2E spec in the pack,
// which seeds the tour-seen flag on purpose (e2e/fixtures.ts). That makes this unit guard the
// only automated coverage the string has.
//
// Second half of #244, pinned below: `hrefFor` looked up 'Home' while `lib/nav-items.ts` labels
// that entry 'Today'. The lookup missed and the `?? '/'` fallback returned Today's real href
// anyway, so a guard the file's own comment described as unable to drift had in fact already
// drifted, silently. The fallback is now '' — it cannot be accidentally correct, and this asserts
// no stop carries one.
//
// `stopsForActiveTrip()` is a plain function over the active `TripConfig`, so this needs no DOM
// render, no traveller stub and no framer-motion: seed the pointer, call it, read the copy.

import { describe, it, expect, beforeEach } from 'vitest';
import { stopsForActiveTrip } from '@/components/first-run-tour';
import { NAV_ITEMS } from '@/lib/nav-items';
import { setActiveTripId, DEFAULT_TRIP_ID } from '@/core/storage/gateway';
import { setTripConfig, upsertKnownTrip, type TripConfigBlock } from '@/core/trips/registry';

/** A 5-day Bali trip — the shape #102 and #95 were both reported against. */
const BALI: TripConfigBlock = {
  start: '2027-03-01',
  end: '2027-03-05',
  destinations: ['Bali'],
  vibe: 'beach',
  currency: 'IDR',
  updatedAt: 1000,
};

const planBlurb = () => stopsForActiveTrip().find((s) => s.key === 'plan')!.blurb;
const allCopy = () => stopsForActiveTrip().map((s) => `${s.label} ${s.blurb}`).join(' ');

beforeEach(() => {
  localStorage.clear();
});

describe('#244 — the first-run tour describes the ACTIVE trip', () => {
  it('default pack: the Plan blurb is unchanged, verbatim', () => {
    setActiveTripId(DEFAULT_TRIP_ID);
    // Byte-identical to the pre-#244 literal. The fix must be invisible on the default trip.
    expect(planBlurb()).toBe(
      'Build the day-by-day itinerary across all 32 days in Nepal and Japan — add, edit, and drag to reorder, then back up your plan any time.',
    );
  });

  it('custom trip: the day count and the destination are the traveller’s own', () => {
    setActiveTripId('custom-bali');
    setTripConfig('custom-bali', BALI);

    expect(planBlurb()).toBe(
      'Build the day-by-day itinerary across all 5 days in Bali — add, edit, and drag to reorder, then back up your plan any time.',
    );
  });

  it('custom trip: no stop leaks Nepal, Japan or the 32-day count', () => {
    setActiveTripId('custom-bali');
    setTripConfig('custom-bali', BALI);

    const copy = allCopy();
    expect(copy).not.toMatch(/Nepal|Japan/);
    expect(copy).not.toContain('32 days');
  });

  it('multi-destination custom trip names every destination', () => {
    setActiveTripId('custom-arc');
    setTripConfig('custom-arc', { ...BALI, destinations: ['Bali', 'Lombok'] });

    // `countryLabel` on a custom leg IS `destinations.join(' × ')` (core/trips/custom.ts) — the
    // same joined label wrapped-story and leg-label already surface, not a second format.
    expect(planBlurb()).toContain('across all 5 days in Bali × Lombok');
  });

  it('a trip joined by token with no config yet claims nothing at all', () => {
    // `customTripConfig` returns a FIXED 1-day placeholder for a registered trip with no config
    // block — the normal state for a joiner (D-342). "all 1 days in Shared trip" would be worse
    // than the leak, so the whole clause drops.
    setActiveTripId('joined-no-config');
    upsertKnownTrip('joined-no-config');

    expect(planBlurb()).toBe(
      'Build the day-by-day itinerary — add, edit, and drag to reorder, then back up your plan any time.',
    );
    expect(planBlurb()).not.toContain('1 days');
    expect(allCopy()).not.toMatch(/Nepal|Japan/);
  });

  it('the tour is not gated: all five stops render on a custom trip', () => {
    setActiveTripId('custom-bali');
    setTripConfig('custom-bali', BALI);

    // None of the five is a `defaultTripOnly` destination, so every one of them exists on a
    // custom trip — gating the tour away would delete onboarding for the traveller who has the
    // emptiest app. Step count is asserted at 5 by e2e/first-run-tour.spec.ts.
    expect(stopsForActiveTrip().map((s) => s.label)).toEqual([
      'Today',
      'Plan',
      'Budget',
      'Journal',
      'Map',
    ]);
  });
});

describe('#244 — every tour href resolves against NAV_ITEMS', () => {
  it('no stop falls back to an empty href (the 32-days fix’s sibling defect)', () => {
    setActiveTripId(DEFAULT_TRIP_ID);
    for (const stop of stopsForActiveTrip()) {
      // '' is `hrefFor`'s miss value. Before #244 the miss value was '/', which is Today's real
      // href — so `hrefFor('Home')` was wrong and undetectable at the same time.
      expect(stop.href, `${stop.key} resolved no nav href`).not.toBe('');
      expect(
        NAV_ITEMS.some((i) => i.href === stop.href),
        `${stop.key} href ${stop.href} is not in NAV_ITEMS`,
      ).toBe(true);
    }
  });

  it('Today resolves from the catalog entry actually labelled "Today"', () => {
    setActiveTripId(DEFAULT_TRIP_ID);
    const today = stopsForActiveTrip().find((s) => s.key === 'today')!;
    expect(NAV_ITEMS.some((i) => i.label === 'Home')).toBe(false); // the label the tour used to ask for
    expect(today.href).toBe(NAV_ITEMS.find((i) => i.label === 'Today')!.href);
  });

  it('Budget borrows the Plan route, since the budget panel has no route of its own', () => {
    setActiveTripId(DEFAULT_TRIP_ID);
    const stops = stopsForActiveTrip();
    const plan = NAV_ITEMS.find((i) => i.label === 'Plan')!.href;
    expect(NAV_ITEMS.some((i) => i.label === 'Budget')).toBe(false);
    expect(stops.find((s) => s.key === 'budget')!.href).toBe(plan);
    expect(stops.find((s) => s.key === 'plan')!.href).toBe(plan);
  });
});
