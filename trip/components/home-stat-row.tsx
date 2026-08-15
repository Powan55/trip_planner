'use client';

import { useEffect, useMemo, useState } from 'react';
import { TRIP_START } from '@/lib/trip-data';
import { computeCountdown } from '@/lib/countdown';
import { getNow, getNowAtTrip, getTodayInTrip } from '@/lib/trip-now';
import { tripShape } from '@/lib/home-stats';
import { deriveWrapped } from '@/core/recap/wrapped';
import { visitedTally } from '@/lib/visited-footprint';
import { useItineraryContext } from '@/components/itinerary-provider';
import HomeMilestone from '@/components/home-milestone';

/**
 * Home's stat row (issue #26) — the band directly under the hero.
 *
 * EVERY NUMBER HERE IS READ, NOT RE-DERIVED. The three fixed cells come from
 * `lib/home-stats.ts`, which counts the app's own per-day city/country answers over the
 * app's own trip-date list. The live cell comes from `computeCountdown`, the one countdown
 * implementation in the repo (D-313 governs its calendar-month arithmetic and its
 * `totalDays`); this file passes it a clock and formats the result. There is deliberately
 * no second piece of date maths in this component, and adding one would be the exact defect
 * D-313 was ruled on.
 *
 * WHY IT IS A BAND UNDER THE HERO AND NOT A ROW INSIDE IT. The hero's height is a budget
 * (D-311): `e2e/countdown.spec.ts` asserts the "Open Planner" CTA still clears a 740px fold
 * with 12px of margin at 320 and 360 wide, and the hero's content block is vertically
 * CENTRED, so anything added inside it spends that margin twice over. This section sits
 * below the `min-h-[100svh]` column entirely, where it costs the fold nothing.
 *
 * ISSUE #31 EXTENDS THIS by adding entries to `cells` — that is the whole extension point,
 * and it is why the cells are data rather than four hand-written blocks. Milestone moments
 * are #31's, not this file's. The grid is `grid-cols-2 sm:grid-cols-4`, so a fifth and
 * sixth cell wrap rather than squeeze; past six, revisit the reservation in `app/page.tsx`.
 *
 * ISSUE #31 TOOK BOTH OF THOSE SLOTS, and kept the rule above: neither is re-derived here.
 * `home-stat-plans` is `deriveWrapped(...).activitiesDone` — literally the producer behind
 * `/recap`'s "Activities" panel (`core/recap/wrapped.ts`), passed only the itinerary domain
 * because that is the only one it needs for this figure and `deriveWrapped` is TOTAL over the
 * five it is not given. A second count of done items on Home is the exact drift defect the
 * issue names. `home-stat-visited` is `visitedTally()`, which reads issue #29's lifetime set
 * through that module's own membership test (D-314) and intersects it with the trip's own
 * places. The band is now the trip's SHAPE on the first row and what has actually HAPPENED on
 * the second.
 *
 * The clock the two live cells use is `getNowAtTrip().date` — destination-local and
 * `?today=`-aware — rather than a hand-rolled device-local `YYYY-MM-DD`. That is the same
 * trip-clock day `lib/visit-autocount.ts` credits visits against, so the two new cells can
 * never disagree about which day it is.
 *
 * The milestone line below the grid is `components/home-milestone.tsx`, imported STATICALLY so
 * it rides this island's chunk rather than adding one to Home's First Load. Its box is a fixed
 * 44px + 12px of margin, which is baked into `STAT_ROW_H` in `app/page.tsx`.
 *
 * Clock cadence: 60s, NOT the hero's 1s. Both live values change at most once a day, the
 * countdown block above is the surface's live display, and a second per-second timer on
 * Home would be a repaint for nothing. A minute is fast enough to self-correct at midnight
 * without a reload. Seeded from a lazy initializer rather than a zeroed placeholder the
 * mount effect then corrects, for the reason issue #54 D records: a first frame showing a
 * different value is a layout the user watches change.
 */

/** One cell. `value` is already formatted; `caption` is the tier-lo line under it. */
interface StatCell {
  testId: string;
  value: string;
  caption: string;
}

/**
 * The live cell's value and caption for a given clock reading. Pure so the three states
 * (pre-trip / on the trip / home again) are readable in one place and testable without a
 * clock. `totalDays` and `dayNumber` are both taken from existing producers.
 */
function liveCell(now: Date, days: number): StatCell {
  const today = getTodayInTrip();
  if (today) {
    return { testId: 'home-stat-live', value: String(today.dayNumber), caption: 'Day on trip' };
  }
  const countdown = computeCountdown(TRIP_START, now);
  if (countdown.isPast) {
    return { testId: 'home-stat-live', value: String(days), caption: 'Days travelled' };
  }
  return { testId: 'home-stat-live', value: String(countdown.totalDays), caption: 'Days to go' };
}

export default function HomeStatRow() {
  const shape = useMemo(tripShape, []);
  const { plans } = useItineraryContext();
  const [live, setLive] = useState<StatCell>(() => liveCell(getNow(), shape.days));
  // Seeded from a lazy initializer for the same reason as `live`: a first frame showing 0 and
  // then correcting itself is a number the user watches change.
  const [visited, setVisited] = useState(visitedTally);
  const [tripDay, setTripDay] = useState(() => getNowAtTrip().date);

  useEffect(() => {
    const tick = () => {
      setLive(liveCell(getNow(), shape.days));
      // Re-read rather than subscribe: the visit record is written once per boot by #30's
      // autocount island, so a 60s poll on the tick this component already runs is enough and
      // costs one small JSON parse a minute.
      setVisited(visitedTally());
      setTripDay(getNowAtTrip().date);
    };
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, [shape.days]);

  // The recap's own producer, given the one domain this row reads from it. The other five
  // inputs are legitimately absent — `deriveWrapped` is total over a missing domain and their
  // stats are not rendered here.
  const wrapped = useMemo(
    () =>
      deriveWrapped(
        {
          plans,
          expenses: null,
          journalEntries: null,
          photos: null,
          packingItems: null,
          docItems: null,
        },
        tripDay,
      ),
    [plans, tripDay],
  );

  const cells: StatCell[] = [
    { testId: 'home-stat-days', value: String(shape.days), caption: 'Days' },
    { testId: 'home-stat-countries', value: String(shape.countries), caption: 'Countries' },
    { testId: 'home-stat-cities', value: String(shape.cities), caption: 'Cities' },
    live,
    { testId: 'home-stat-plans', value: String(wrapped.activitiesDone), caption: 'Plans done' },
    { testId: 'home-stat-visited', value: String(visited.cities), caption: 'Cities visited' },
  ];

  return (
    <section
      aria-labelledby="home-stats-title"
      data-testid="home-stat-row"
      className="bg-surface px-4 sm:px-6 py-4"
    >
      {/* `-title`, never `-heading`: globals.css hangs a decorative gradient underline off
          every `h2[id$="-heading"]`, and hanging one off a visually-hidden heading paints a
          stray 3rem bar. `components/home-bento.tsx` names its heading the same way for the
          same reason. */}
      <h2 id="home-stats-title" className="sr-only">
        The trip in numbers
      </h2>
      {/* The dividers are the container showing through 1px gaps rather than borders on the
          cells, so no cell owns an edge and the corners stay clean under `overflow-hidden`.
          --border is decorative at 1.99:1 and is never the only thing separating the cells —
          the fill step from --bg to --surface-low does that too. 20px is the ruled stat-tile
          radius; it has no Tailwind key (see `.countdown-cell` in globals.css). */}
      <div className="mx-auto grid max-w-[1200px] grid-cols-2 gap-px overflow-hidden rounded-[20px] bg-border sm:grid-cols-4">
        {cells.map((cell) => (
          <div key={cell.testId} data-testid={cell.testId} className="bg-surface-low px-4 py-4">
            {/* Tabular figures so a changing value never reflows its own cell — the live
                cell is the one that changes, and it sits in the same row as three that do
                not. ink-hi on --surface-low measures 17.88:1, the caption's ink-lo 6.89:1. */}
            <p className="text-2xl font-extrabold leading-none tabular-nums text-ink-hi sm:text-3xl">
              {cell.value}
            </p>
            <p className="mt-1.5 text-[10px] uppercase tracking-[0.12em] text-ink-lo">
              {cell.caption}
            </p>
          </div>
        ))}
      </div>
      <HomeMilestone
        input={{
          status: wrapped.status,
          daysElapsed: wrapped.daysElapsed,
          totalTripDays: wrapped.totalTripDays,
          activitiesDone: wrapped.activitiesDone,
          activitiesPlanned: wrapped.activitiesPlanned,
          citiesVisited: visited.cities,
          countriesVisited: visited.countries,
          // From `visitedTally()`, NOT from `shape` — those two count countries in different
          // vocabularies (labels vs leg ids), and mixing them would make "every country on the
          // itinerary" true one country early. The reasoning is on `visitedTally`.
          tripCities: visited.tripCities,
          tripCountries: visited.tripCountries,
        }}
      />
    </section>
  );
}
