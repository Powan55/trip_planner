'use client';

import { useEffect, useMemo, useState } from 'react';
import { TRIP_START } from '@/lib/trip-data';
import { computeCountdown } from '@/lib/countdown';
import { getNow, getNowAtTrip, getTodayInTrip } from '@/lib/trip-now';
import { tripShape, daysToGo } from '@/lib/home-stats';
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
 * D-313 was ruled on. The one exception is the pre-trip "Days to go" count, which is
 * `daysToGo()` from `lib/home-stats.ts` — the ONE derivation of that number, shared with the
 * hero's ring and `/travel` (A-23), and the reason those surfaces no longer disagree by a day.
 *
 * WHY IT IS A BAND UNDER THE HERO AND NOT A ROW INSIDE IT. The hero's height is a budget
 * (D-311): `e2e/countdown.spec.ts` asserts the "Open Planner" CTA still clears a 740px fold
 * with 12px of margin at 320 and 360 wide, and the hero's content block is vertically
 * CENTRED, so anything added inside it spends that margin twice over. This section sits
 * below the `min-h-[100svh]` column entirely, where it costs the fold nothing.
 *
 * ISSUE #31 EXTENDS THIS by adding entries to `cells` — that is the whole extension point,
 * and it is why the cells are data rather than four hand-written blocks. Milestone moments
 * are #31's, not this file's.
 *
 * ADDING A CELL IS NOT FREE: the column count must divide the cell count exactly, or the
 * leftover grid tracks paint as a solid `bg-border` slab (the dividers are the container
 * showing through — see the grid element below, where the full reasoning lives). The grid
 * is `grid-cols-2 sm:grid-cols-3` for the current SIX cells. Past six, move both the column
 * count and the reservation in `app/page.tsx`.
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
 * clock. `dayNumber` is taken from an existing producer.
 *
 * "Days to go" is a CALENDAR-day count, not `computeCountdown().totalDays`. A-23 (and
 * `lib/travel-date.ts`, which fixed the identical reading one file over) : `totalDays` is a
 * truncated whole-day count, so it drops to 0 as soon as fewer than 24h remain and this cell read
 * "0 Days to go" from midnight on Dec 8 onward while `/travel` on the same device read "1". This
 * does NOT reopen D-313 — `computeCountdown` is untouched and still owns the countdown breakdown
 * above; `totalDays` is correct for what it claims, it just is not "how many sleeps". The count
 * itself lives in `daysToGo()`, which the hero's ring and `/travel` call too — there is one
 * derivation, so there is nothing left to drift against.
 */
export function liveCell(now: Date, days: number): StatCell {
  const today = getTodayInTrip();
  if (today) {
    return { testId: 'home-stat-live', value: String(today.dayNumber), caption: 'Day on trip' };
  }
  if (computeCountdown(TRIP_START, now).isPast) {
    return { testId: 'home-stat-live', value: String(days), caption: 'Days travelled' };
  }
  return { testId: 'home-stat-live', value: String(daysToGo(now)), caption: 'Days to go' };
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
      className="bg-surface py-4"
    >
      {/* `-title`, never `-heading`: globals.css hangs a decorative gradient underline off
          every `h2[id$="-heading"]`, and hanging one off a visually-hidden heading paints a
          stray 3rem bar. `components/home-bento.tsx` names its heading the same way for the
          same reason. */}
      <h2 id="home-stats-title" className="sr-only">
        The trip in numbers
      </h2>
      {/* THE EMPTY-TRACK SLAB IS GONE WITH THE MECHANISM THAT CAUSED IT. The dividers used
          to be the container showing through 1px gaps, which meant an empty grid track was
          not empty — it painted `bg-border` as a solid block, and the row shipped that
          defect once (six cells against `sm:grid-cols-4`). `.cell` carries its own hairline
          right/bottom edges, so a leftover track now paints nothing at all and the column
          count no longer has to divide the cell count. The 2-up/3-up split is kept anyway:
          the value step is --n-md and six of those across a phone is not readable.
          `STAT_ROW_H` in `app/page.tsx` is a MEASURED literal and this changes the cell's
          box — it is left alone here and owed a remeasure on the built export. */}
      <div className="cells mx-auto max-w-[1200px] sm:grid-cols-3">
        {cells.map((cell) => (
          <div key={cell.testId} data-testid={cell.testId} className="cell">
            {/* TWO `<p>` ELEMENTS, VALUE FIRST, and that is a contract rather than a layout
                choice: `e2e/countdown.spec.ts`'s `liveStat()` reads the figure from
                `p:first` and the trip-lifecycle caption from `p:nth(1)`. `.cell .v` and
                `.cell .l` carry the tiers; the elements and their order do not move.
                Tabular figures come with `.v`, so a changing value never reflows its own
                cell — the live cell is the one that changes and it sits beside three that
                do not. ink-hi on --surface-low measures 17.88:1, the label's ink-lo 6.89:1. */}
            <p className="v">{cell.value}</p>
            <p className="l">{cell.caption}</p>
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
