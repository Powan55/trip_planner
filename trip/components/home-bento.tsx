'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Compass, CloudSun, Map as MapIcon, ArrowRight } from 'lucide-react';
import { getTodayInTrip, getNowUtcMsForPlace, type TripToday } from '@/lib/trip-now';
import { offsetForCountry, formatDate } from '@/core/dates';
import { nextUp } from '@/lib/whats-next';
import { earliestTimedItem } from '@/lib/phase-of-day';
import { useItineraryContext } from '@/components/itinerary-provider';
import { useBudget } from '@/hooks/use-budget';
import { useExpenses } from '@/hooks/use-expenses';
import { usePacking } from '@/hooks/use-packing';
import { useDocs } from '@/hooks/use-docs';
import { useEnterTravelMode } from '@/hooks/use-travel-mode';
import { useOnline } from '@/hooks/use-online';
import { rollUp, formatMoney } from '@/core/budget/model';
import { expensesToSpent } from '@/core/budget/expenses';
import { getCachedForecastForDate, weatherTagForDay } from '@/lib/weather';
import { describeItemTime } from '@/lib/item-time-display';

/**
 * — the Home "at a glance" bento grid. A read-only composition of data already computed
 * by EXISTING hooks/selectors:
 * next-up, budget spent-so-far,
 * cached weather, packing % (`usePacking`,
 *), docs checklist %, a static map/photo link tile, and the shared Travel
 * Mode entry. Rendered as a lazy below-fold island
 * from `app/page.tsx` — its chunk is NOT in Home's First Load JS.
 *
 * The "in-trip" tiles (Next up / Weather) resolve `getTodayInTrip()` on a 30s interval — coarser
 * than the hero's 1s countdown tick (this is a satellite glance tile, not a live clock display),
 * refreshed once on mount so it's never stale on first paint.
 */
export default function HomeBento() {
  const [todayInTrip, setTodayInTrip] = useState<TripToday | null>(null);
  const [nowUtcMs, setNowUtcMs] = useState<number>(0);

  useEffect(() => {
    const tick = () => {
      const t = getTodayInTrip();
      setTodayInTrip(t);
      if (t) setNowUtcMs(getNowUtcMsForPlace(t.date, offsetForCountry(t.country)));
    };
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);

  const { plans, getDayPlan, hydrated: itineraryHydrated } = useItineraryContext();
  const { model } = useBudget();
  const { expenses } = useExpenses();
  const { progress: packingProgress, hydrated: packingHydrated } = usePacking();
  const { completion: docsCompletion, hydrated: docsHydrated } = useDocs();
  const enterTravel = useEnterTravelMode();
  // The one "where the trip stands" fact this band was missing (issue #92). The hook is the
  // app's existing connectivity signal — the same one the app-wide offline banner reads — so
  // the tile and the banner can never disagree about the state.
  const online = useOnline();

  const roll = rollUp(model, expensesToSpent(expenses));

  const todayItems = todayInTrip ? getDayPlan(todayInTrip.date).items : [];
  const upcoming =
    todayInTrip && itineraryHydrated
      ? nextUp(todayItems, {
          dayDate: todayInTrip.date,
          placeOffsetMin: offsetForCountry(todayInTrip.country),
          nowUtcMs,
        })
      : null;
  const upcomingTime = upcoming && todayInTrip ? describeItemTime(upcoming, todayInTrip.date) : null;

  // — pre-trip, "Next up" used to say "Appears once your trip begins", which is a tile
  // spending a whole card to tell you it has nothing. The genuinely useful answer to "next up"
  // before departure is the FIRST thing on the itinerary, and we already hold it: `plans` is on
  // the store's public surface, so this is presentation-only.
  // Sorted defensively — persisted day order is not guaranteed to be date order.
  const firstPlanned = useMemo(() => {
    if (!itineraryHydrated) return null;
    const day = [...plans]
      .filter((p) => p.items?.length)
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    // A-24: the day's EARLIEST timed item, not its first STORED item — persisted item order
    // is manual/drag order, not time order, so `items[0]` could be anything on the day.
    // `earliestTimedItem` falls back to `undefined`; `?? day.items[0]` is the same "nothing
    // timed → show whatever is first" fallback this tile already had.
    return day ? { date: day.date, item: earliestTimedItem(day.items) ?? day.items[0] } : null;
  }, [plans, itineraryHydrated]);

  const cachedForecast = todayInTrip
    ? getCachedForecastForDate(todayInTrip.city, todayInTrip.date)
    : null;
  const weatherTag = weatherTagForDay(cachedForecast);

  const packingPct = packingProgress.total > 0 ? Math.round((packingProgress.checked / packingProgress.total) * 100) : null;
  const docsPct = docsCompletion.total > 0 ? Math.round((docsCompletion.done / docsCompletion.total) * 100) : null;

  return (
    <section id="dashboard" aria-labelledby="dashboard-heading" data-testid="home-bento" className="relative bg-surface py-10 sm:py-14">
      <div className="max-w-[1200px] mx-auto">
        {/* `-heading`, and that suffix is load-bearing: globals.css hangs a decorative gradient
            underline off every `h2[id$="-heading"]`. This heading used to be `sr-only` and named
            `-title` precisely to dodge that rule, because hanging an underline off a
            visually-hidden heading paints a stray 3rem bar. Issue #106 made it a REAL centred
            section heading — which is the case that rule was written for — and gave it the
            `#dashboard` anchor the deleted trip-dashboard used to own, so the naming flips with
            it. `components/home-stat-row.tsx`'s heading is still hidden and still `-title`. */}
        <h2
          id="dashboard-heading"
          className="mb-8 px-gut text-center text-display-lg text-ink-hi"
        >
          At a glance
        </h2>
        {/* THE TILE GRAMMAR IS GONE, AND THAT IS THE RULING. A wrapping bento of mixed tiles
            has no analogue in this direction — the printed instrument has cells, lists and
            plates. What was a tile is now one of two things by what it actually holds: a
            SUBJECT WITH A VALUE is a `.cell` in the 4-up instrument block, and anything that
            is a line of prose or a place to go is a `.list` row. Every testid and every data
            source is the one that was here before.

            The wrapping flex row it replaces existed to dodge an empty grid track, because
            the dividers were the container showing through the gaps. `.cell` owns its own
            hairline edges, so a leftover track paints nothing and a conditional cell (weather
            is in-trip only) costs nothing to leave out. */}
        <ul className="list">
          {/* Next up.: no longer in-trip only, and no longer a "come back later"
              placeholder. In-trip it is the next upcoming item; PRE-trip it is the first
              thing on the itinerary. If there is genuinely nothing to say (an emptied
              itinerary, pre-trip) the row is not rendered — a row whose only content is an
              apology is worse than no row.

              Pre-trip the lead prints `formatDate()`, too wide for the default `--lead` track. */}
          {(todayInTrip || firstPlanned) && (
            <li data-testid="home-bento-next-up" className="r [--lead:5.75rem]">
              <span className="tm">
                {!todayInTrip
                  ? formatDate(firstPlanned!.date)
                  : upcomingTime?.label ?? '—'}
              </span>
              <span className="min-w-0">
                {!todayInTrip ? (
                  <>
                    <h3 className="truncate">{firstPlanned!.item.title}</h3>
                    <span className="mt">First up · next on the itinerary</span>
                  </>
                ) : upcoming ? (
                  <>
                    <h3 className="truncate">{upcoming.title}</h3>
                    <span className="mt">Next up · today</span>
                  </>
                ) : (
                  <>
                    <h3 className="empty">Nothing left today</h3>
                    <span className="mt">Next up · everything on today is done</span>
                  </>
                )}
              </span>
              <ArrowRight className="w-4 h-4 text-ink-lo" aria-hidden="true" />
            </li>
          )}

          {/* Weather now (cache-derived, no new fetch) — in-trip only, and makes that
              literal: the forecast cache only ever holds trip days, so pre-trip there is no
              useful thing to show and the row is simply not rendered. In-trip with a cold
              cache it still says so honestly — that state IS informative, because a fetch is
              expected. */}
          {todayInTrip && (
            <li
              data-testid="home-bento-weather"
              className="r"
              data-mark={weatherTag ? undefined : 'hollow'}
            >
              <span className="tm">
                <CloudSun className="w-4 h-4" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                {weatherTag ? (
                  <>
                    <h3>
                      <span aria-hidden="true">{weatherTag.icon}</span> {weatherTag.label}
                    </h3>
                    <span className="mt">Weather · {todayInTrip.city}</span>
                  </>
                ) : (
                  <>
                    <h3 className="empty">Awaiting a forecast</h3>
                    <span className="mt">Weather · {todayInTrip.city} · nothing cached yet</span>
                  </>
                )}
              </span>
              <span />
            </li>
          )}
        </ul>

        {/* The 4-up instrument block: the four subjects that carry a VALUE. It collapses to
            2x2 below 560px — four of these across a 390px phone puts every label on two
            lines. A subject with nothing in it yet is `.is-hollow`: the cell renders at full
            size with its unit and its condition, never as a grey sentence. */}
        <div className="cells cells--4 mt-6">
          <div
            data-testid="home-bento-budget"
            className={`cell${roll.totalBudgetHome > 0 ? '' : ' is-hollow'}`}
          >
            <span className="l">Budget</span>
            <div className="v">
              {roll.totalBudgetHome > 0 ? formatMoney(roll.totalSpentHome, roll.home) : '—'}
            </div>
            {/* The unset condition names the action that fills it rather than captioning
                absence, which is why it reads as a footnote on a hollow cell and not as a
                grey sentence where the value should be. `e2e/home-bento.spec.ts` pins this
                exact string. */}
            <span className="f">
              {roll.totalBudgetHome > 0
                ? `of ${formatMoney(roll.totalBudgetHome, roll.home)}`
                : 'Set a budget in Settings'}
            </span>
          </div>

          <div
            data-testid="home-bento-packing"
            className={`cell${packingHydrated && packingPct !== null ? '' : ' is-hollow'}`}
          >
            <span className="l">Packing</span>
            {!packingHydrated ? (
              <>
                <div className="v">—</div>
                <span className="f">Loading</span>
              </>
            ) : (
              <>
                <div className="v" data-testid="home-bento-packing-bar" data-pct={packingPct ?? 0}>
                  {packingPct ?? 0}
                  <small>%</small>
                </div>
                <span className="f">
                  {packingPct !== null
                    ? `${packingProgress.checked} of ${packingProgress.total} packed`
                    : 'Unfilled'}
                </span>
              </>
            )}
          </div>

          <div
            data-testid="home-bento-docs"
            className={`cell${docsHydrated && docsPct !== null ? '' : ' is-hollow'}`}
          >
            <span className="l">Docs</span>
            {!docsHydrated ? (
              <>
                <div className="v">—</div>
                <span className="f">Loading</span>
              </>
            ) : (
              <>
                <div className="v" data-testid="home-bento-docs-bar" data-pct={docsPct ?? 0}>
                  {docsPct ?? 0}
                  <small>%</small>
                </div>
                <span className="f">
                  {docsPct !== null
                    ? `${docsCompletion.done} of ${docsCompletion.total} filed`
                    : 'Unfiled'}
                </span>
              </>
            )}
          </div>

          {/* Connection. The state is written out in words, never carried by a mark or a
              colour alone. No `aria-live` here on purpose: the app-wide offline banner
              already announces the transition, and a second announcer would say it twice. */}
          <div data-testid="home-bento-connection" className="cell">
            <span className="l">Connection</span>
            <div className="v">{online ? 'Online' : 'Offline'}</div>
            <span className="f">
              {online ? 'Saves on this device' : 'Saved plans still open'}
            </span>
          </div>
        </div>

        <ul className="list mt-6">
          <li>
            <Link href="/map/" data-testid="home-bento-map" className="r group relative overflow-hidden">
              <span
                aria-hidden="true"
                className="absolute inset-0 opacity-40 transition-opacity group-hover:opacity-60"
                style={{ background: 'var(--map-wash)' }}
              />
              <span className="tm relative">
                <MapIcon className="w-4 h-4" aria-hidden="true" />
              </span>
              <span className="relative min-w-0">
                {/* role=presentation: the whole row is the link and a link is
                    children-presentational, so this never reached the outline (#364). */}
                <h3 role="presentation">Open the map</h3>
                <span className="mt">Every place on one map</span>
              </span>
              <ArrowRight className="relative w-4 h-4 text-ink-lo transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
          </li>

          {/* Travel Mode entry — shares the ONE entry path. */}
          <li>
            <button
              type="button"
              onClick={() => enterTravel()}
              data-testid="home-bento-travel-mode"
              className="r w-full text-left"
            >
              <span className="tm">
                <Compass className="w-4 h-4" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <h3 role="presentation">Open Travel Mode</h3>
                <span className="mt">One hand, no signal</span>
              </span>
              <ArrowRight className="w-4 h-4 text-ink-lo" aria-hidden="true" />
            </button>
          </li>
        </ul>
      </div>
    </section>
  );
}
