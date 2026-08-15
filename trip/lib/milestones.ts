/**
 * Trip milestones (issue #31) — the moments worth marking, derived ENTIRELY from numbers the
 * app already works out.
 *
 * NO NEW STATE, PERSISTED OR OTHERWISE. Every predicate below is a pure function of an input
 * the callers already hold: `deriveWrapped()` (`core/recap/wrapped.ts`, the post-trip recap's
 * own producer — the same one, not a second copy) plus the visited-set counts from
 * `lib/visited-footprint.ts`. There is no "milestones" storage key and no achievement ledger,
 * so nothing here can disagree with the surface it sits next to.
 *
 * ── THE HONESTY RULE, WHICH IS THE WHOLE POINT ─────────────────────────────────────────────
 * A milestone that fires for something that did not happen is worse than no milestone. So
 * every predicate that compares a count against a total ALSO requires the total to be positive.
 * Without that, an empty plan makes `done >= planned` true (`0 >= 0`) and the app congratulates
 * you for finishing a trip you have not planned, let alone taken. Each guard has a test.
 *
 * ── THE ORDER IS THE ESCALATION ────────────────────────────────────────────────────────────
 * `MILESTONES` is authored smallest-first, and `latestMilestone` returns the LAST one reached.
 * They are not strictly nested (you can tick every plan without finishing the trip), so this is
 * "the biggest thing true right now", not a level counter.
 */

import { crossedIntoComplete } from '@/lib/celebration';

/** Everything a milestone predicate may look at — all of it read from an existing producer. */
export interface MilestoneInput {
  /** `deriveWrapped().status` — 'pre' | 'mid' | 'post'. */
  status: 'pre' | 'mid' | 'post';
  /** `deriveWrapped().daysElapsed` — trip days that have actually happened. */
  daysElapsed: number;
  /** `deriveWrapped().totalTripDays` — `TRIP_DATES.length`. */
  totalTripDays: number;
  /** `deriveWrapped().activitiesDone` / `.activitiesPlanned`. */
  activitiesDone: number;
  activitiesPlanned: number;
  /** `visitedTripPlaces().length` — trip cities the visit record confirms. */
  citiesVisited: number;
  /** Distinct countries across those confirmed places. */
  countriesVisited: number;
  /** `tripShape().cities` / `.countries` — what the itinerary contains. */
  tripCities: number;
  tripCountries: number;
}

export interface Milestone {
  /** Stable id — the edge-detection key. Never reuse one for different copy. */
  id: string;
  /** The line the banner shows. Present tense, no exclamation marks. */
  label: string;
  reached: (input: MilestoneInput) => boolean;
}

export const MILESTONES: readonly Milestone[] = [
  {
    id: 'first-city',
    label: 'First city on the board',
    reached: (i) => i.citiesVisited >= 1,
  },
  {
    id: 'underway',
    label: 'The trip is underway',
    // `daysElapsed` is 0 until a trip day has actually passed, so this cannot fire pre-trip.
    reached: (i) => i.daysElapsed >= 1,
  },
  {
    id: 'every-country',
    // Deliberately not "every country in the world" — this is the itinerary's own list.
    label: 'Every country on the itinerary',
    reached: (i) => i.tripCountries > 0 && i.countriesVisited >= i.tripCountries,
  },
  {
    id: 'halfway',
    label: 'Halfway through the trip',
    reached: (i) => i.totalTripDays > 0 && i.daysElapsed > 0 && i.daysElapsed * 2 >= i.totalTripDays,
  },
  {
    id: 'every-city',
    label: 'Every city on the itinerary',
    reached: (i) => i.tripCities > 0 && i.citiesVisited >= i.tripCities,
  },
  {
    id: 'every-plan',
    label: 'Every plan ticked off',
    reached: (i) => i.activitiesPlanned > 0 && i.activitiesDone >= i.activitiesPlanned,
  },
  {
    id: 'trip-complete',
    label: 'The whole trip, behind you',
    reached: (i) => i.status === 'post',
  },
];

/** Every milestone currently true, smallest-first. */
export function milestonesReached(input: MilestoneInput): Milestone[] {
  return MILESTONES.filter((milestone) => milestone.reached(input));
}

/** The biggest milestone currently true, or `null` when none is. */
export function latestMilestone(input: MilestoneInput): Milestone | null {
  const reached = milestonesReached(input);
  return reached.length > 0 ? reached[reached.length - 1] : null;
}

/**
 * The biggest milestone that has just been crossed, or `null`.
 *
 * `prevIds === null` is the FIRST observation and always returns `null` — it seeds the baseline
 * without firing, which is D-207's rule and the reason opening the app mid-trip does not throw
 * confetti for six things that happened last week. The edge itself is
 * `crossedIntoComplete(prev, next)` from `lib/celebration.ts` rather than a second `&& !prev`
 * written out here, so there is one definition of "crossed while watching" in the app.
 */
export function newlyReached(
  prevIds: readonly string[] | null,
  input: MilestoneInput,
): Milestone | null {
  const reached = milestonesReached(input);
  for (let i = reached.length - 1; i >= 0; i--) {
    const had = prevIds === null ? null : prevIds.includes(reached[i].id);
    if (crossedIntoComplete(had, true)) return reached[i];
  }
  return null;
}
