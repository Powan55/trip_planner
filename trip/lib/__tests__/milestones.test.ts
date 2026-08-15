import { describe, it, expect } from 'vitest';

/**
 * Milestone predicates (issue #31).
 *
 * The point of this file is the ZERO CASE, not the happy path. "Every plan ticked off" and
 * "every city on the itinerary" are both `done >= total` comparisons, and `0 >= 0` is true — so
 * without an explicit positive-total guard the app congratulates a brand-new device, on day
 * zero, for finishing a trip nobody has planned or taken. A milestone that fires for something
 * that did not happen is worse than no milestone, so every one of those guards gets its own
 * case below.
 *
 * The predicates are pure functions of an input the callers already hold — `deriveWrapped()`
 * (the recap's own producer) plus the visited-set counts — so nothing here needs storage, a
 * clock, or a DOM.
 */

import {
  MILESTONES,
  latestMilestone,
  milestonesReached,
  newlyReached,
  type MilestoneInput,
} from '@/lib/milestones';

/** A device that has done nothing: pre-trip, empty plan, empty visit record. The totals are the
 *  default pack's, counted the way `visitedTally()` counts them — 8 cities and 3 country
 *  LABELS (USA, Nepal, Japan), not the 2 leg ids `tripShape()` reports. */
const NOTHING: MilestoneInput = {
  status: 'pre',
  daysElapsed: 0,
  totalTripDays: 32,
  activitiesDone: 0,
  activitiesPlanned: 0,
  citiesVisited: 0,
  countriesVisited: 0,
  tripCities: 8,
  tripCountries: 3,
};

const at = (patch: Partial<MilestoneInput>): MilestoneInput => ({ ...NOTHING, ...patch });

describe('the zero case — nothing fires for something that did not happen', () => {
  it('a fresh device on a fresh trip has reached NO milestone', () => {
    expect(milestonesReached(NOTHING)).toEqual([]);
    expect(latestMilestone(NOTHING)).toBeNull();
  });

  it('an EMPTY plan is never "every plan ticked off" (0 >= 0 is the trap)', () => {
    expect(ids(at({ activitiesDone: 0, activitiesPlanned: 0 }))).not.toContain('every-plan');
    expect(ids(at({ activitiesDone: 3, activitiesPlanned: 3 }))).toContain('every-plan');
  });

  it('a trip with no cities is never "every city on the itinerary"', () => {
    expect(ids(at({ tripCities: 0, citiesVisited: 0 }))).not.toContain('every-city');
    expect(ids(at({ tripCities: 0, countriesVisited: 0, tripCountries: 0 }))).not.toContain(
      'every-country',
    );
  });

  it('day zero is never halfway, however short the trip', () => {
    expect(ids(at({ daysElapsed: 0, totalTripDays: 0 }))).not.toContain('halfway');
    expect(ids(at({ daysElapsed: 0, totalTripDays: 32 }))).not.toContain('halfway');
    expect(ids(at({ daysElapsed: 1, totalTripDays: 2 }))).toContain('halfway');
  });

  it('"the trip is underway" needs a day that has actually elapsed, not a date in the future', () => {
    expect(ids(NOTHING)).not.toContain('underway');
    expect(ids(at({ daysElapsed: 1 }))).toContain('underway');
  });

  it('a partial visit record does not claim the whole itinerary', () => {
    const partial = at({ citiesVisited: 7, tripCities: 8, countriesVisited: 2, tripCountries: 3 });
    expect(ids(partial)).toContain('first-city');
    expect(ids(partial)).not.toContain('every-city');
    expect(ids(partial)).not.toContain('every-country');
  });
});

describe('escalation — the biggest true thing, not a level counter', () => {
  it('latestMilestone is the LAST reached in authored order', () => {
    const midTrip = at({ status: 'mid', daysElapsed: 20, citiesVisited: 5 });
    expect(latestMilestone(midTrip)?.id).toBe('halfway');
    const done = at({
      status: 'post',
      daysElapsed: 32,
      citiesVisited: 8,
      countriesVisited: 3,
      activitiesDone: 4,
      activitiesPlanned: 4,
    });
    expect(latestMilestone(done)?.id).toBe('trip-complete');
  });

  it('every milestone id is unique — the ids are the edge-detection key', () => {
    expect(new Set(MILESTONES.map((m) => m.id)).size).toBe(MILESTONES.length);
  });

  it('reached milestones come back in authored order, so the caller can trust the last one', () => {
    const reached = milestonesReached(
      at({ status: 'post', daysElapsed: 32, citiesVisited: 8, countriesVisited: 3 }),
    );
    const authored = MILESTONES.map((m) => m.id).filter((id) => reached.some((r) => r.id === id));
    expect(reached.map((r) => r.id)).toEqual(authored);
  });
});

describe('newlyReached — fires on a crossing you were there to see (D-207)', () => {
  it('the FIRST observation seeds the baseline and never fires', () => {
    const done = at({ status: 'post', daysElapsed: 32, citiesVisited: 8, countriesVisited: 3 });
    expect(newlyReached(null, done)).toBeNull();
  });

  it('fires once on the crossing, and not again while it stays true', () => {
    const before = at({ daysElapsed: 0 });
    const after = at({ daysElapsed: 1, citiesVisited: 1 });
    const seeded = milestonesReached(before).map((m) => m.id); // [] — nothing yet
    const crossed = newlyReached(seeded, after);
    expect(crossed?.id).toBe('underway'); // the bigger of the two crossed at once
    expect(newlyReached(milestonesReached(after).map((m) => m.id), after)).toBeNull();
  });

  it('an already-known milestone never re-fires just because a smaller one arrives late', () => {
    const known = ['underway'];
    // Same trip, now with a city on the board: 'first-city' is new, 'underway' is not.
    expect(newlyReached(known, at({ daysElapsed: 1, citiesVisited: 1 }))?.id).toBe('first-city');
  });
});

function ids(input: MilestoneInput): string[] {
  return milestonesReached(input).map((m) => m.id);
}
