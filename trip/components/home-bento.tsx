'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Compass, Wallet, CloudSun, Backpack, FileCheck2, Map as MapIcon, ArrowRight, Wifi, WifiOff } from 'lucide-react';
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
    <section id="dashboard" aria-labelledby="dashboard-heading" data-testid="home-bento" className="relative bg-surface py-10 sm:py-14 px-4 sm:px-6">
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
          className="mb-8 text-center font-display text-3xl font-bold tracking-tight text-ink-hi sm:text-4xl"
        >
          At a <span className="text-display-emphasis">glance</span>
        </h2>
        {/* `flex flex-wrap`, NOT a fixed-column grid. The tile count varies by design (weather
            and next-up are conditional), so no column count is exact for all of them: at
            `grid-cols-2 lg:grid-cols-4` with four double-width tiles the states came to 9, 10 and
            8 column units and every one of them left an EMPTY track. Wrapping spends the leftover
            width INSIDE the row instead, where a hole is not representable. DOM order is visual
            order — do not reach for `grid-auto-flow: dense`, which reorders position away from
            tab order. */}
        <div className="flex flex-wrap gap-3 sm:gap-4">
          {/* Next up — the widest tile (grows at 2× a narrow tile's rate).: no longer
              in-trip only, and no longer a "come back later" placeholder. In-trip it is the
              next upcoming item; PRE-trip it is the first thing on the itinerary. If there is
              genuinely nothing to say (an emptied itinerary, pre-trip) the whole tile is not
              rendered — a card whose only content is an apology is worse than no card. */}
          {(todayInTrip || firstPlanned) && (
          <BentoTile
            testId="home-bento-next-up"
            className="flex-[2_1_18rem] sm:flex-[2_1_26rem]"
            icon={<ArrowRight className="w-4 h-4" aria-hidden="true" />}
            label="Next up"
          >
            {!todayInTrip ? (
              firstPlanned && (
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{firstPlanned.item.title}</p>
                  <p className="text-xs text-ink-mid mt-0.5">First up &middot; {formatDate(firstPlanned.date)}</p>
                </div>
              )
            ) : upcoming ? (
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white truncate">{upcoming.title}</p>
                {upcomingTime && <p className="text-xs text-ink-mid mt-0.5">{upcomingTime.label}</p>}
              </div>
            ) : (
              <EmptyLine>You&rsquo;re all caught up today</EmptyLine>
            )}
          </BentoTile>
          )}

          {/* Budget spent-so-far. */}
          <BentoTile testId="home-bento-budget" icon={<Wallet className="w-4 h-4" aria-hidden="true" />} label="Budget">
            {roll.totalBudgetHome > 0 ? (
              <p className="text-sm font-semibold text-white">
                {formatMoney(roll.totalSpentHome, roll.home)}{' '}
                <span className="text-ink-mid font-normal">/ {formatMoney(roll.totalBudgetHome, roll.home)}</span>
              </p>
            ) : (
              <EmptyLine>Set a budget in Settings</EmptyLine>
            )}
          </BentoTile>

          {/* Weather now (cache-derived, no new fetch) — in-trip only, and makes that
              literal: the forecast cache only ever holds trip days, so pre-trip there is no
              useful thing to show and the tile is simply not rendered (it used to spend a card
              saying "Appears once you're on the trip"). In-trip with a cold cache it still
              says so honestly — that state IS informative, because a fetch is expected. */}
          {todayInTrip && (
          <BentoTile testId="home-bento-weather" icon={<CloudSun className="w-4 h-4" aria-hidden="true" />} label="Weather">
            {weatherTag ? (
              <p className="text-sm font-semibold text-white">
                <span aria-hidden="true">{weatherTag.icon}</span> {weatherTag.label}
              </p>
            ) : (
              <EmptyLine>No cached forecast yet</EmptyLine>
            )}
          </BentoTile>
          )}

          {/* Packing checklist %. */}
          <BentoTile testId="home-bento-packing" icon={<Backpack className="w-4 h-4" aria-hidden="true" />} label="Packing">
            {!packingHydrated ? (
              <EmptyLine>Loading…</EmptyLine>
            ) : packingPct !== null ? (
              <PctBar pct={packingPct} testId="home-bento-packing-bar" />
            ) : (
              <EmptyLine>No packing list yet</EmptyLine>
            )}
          </BentoTile>

          {/* Docs checklist %. */}
          <BentoTile testId="home-bento-docs" icon={<FileCheck2 className="w-4 h-4" aria-hidden="true" />} label="Docs">
            {!docsHydrated ? (
              <EmptyLine>Loading…</EmptyLine>
            ) : docsPct !== null ? (
              <PctBar pct={docsPct} testId="home-bento-docs-bar" />
            ) : (
              <EmptyLine>No checklist yet</EmptyLine>
            )}
          </BentoTile>

          {/* Connection. The state is written out in words, never carried by the icon or a
              colour alone. No `aria-live` here on purpose: the app-wide offline banner
              already announces the transition, and a second announcer would say it twice. */}
          <BentoTile
            testId="home-bento-connection"
            icon={
              online ? (
                <Wifi className="w-4 h-4" aria-hidden="true" />
              ) : (
                <WifiOff className="w-4 h-4" aria-hidden="true" />
              )
            }
            label="Connection"
          >
            <div>
              <p className="text-sm font-semibold text-white">{online ? 'Online' : 'Offline'}</p>
              <p className="text-xs text-ink-mid mt-0.5">
                {online ? 'Everything saves on this device' : 'Your saved plans still open'}
              </p>
            </div>
          </BentoTile>

          {/* Mini map/photo link tile — a wide tile, decorative gradient art. It and the Travel
              Mode button below hand-roll their class strings rather than going through
              `BentoTile`, so they carry the wide flex basis AND `min-h-[5.5rem]` explicitly:
              without the min-height they measured 57px tall against their 94-102px neighbours,
              which both ragged the last row and left two full-width tap targets under the
              comfortable size. `hover:bg-white/10` matches the Travel Mode button — two
              identical-looking bars owe the same hover response; the gradient's opacity lift
              is this tile's own extra. */}
          <Link
            href="/map/"
            data-testid="home-bento-map"
            className="flex-[2_1_18rem] sm:flex-[2_1_26rem] min-h-[5.5rem] group relative overflow-hidden rounded-2xl glass-card p-4 flex items-center justify-between gap-3 hover:bg-white/10 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <div
              aria-hidden="true"
              className="absolute inset-0 opacity-40 group-hover:opacity-60 transition-opacity"
              style={{ background: 'var(--map-wash)' }}
            />
            <div className="relative flex items-center gap-2">
              <MapIcon className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
              <span className="text-sm font-semibold text-white">Open the map</span>
            </div>
            <ArrowRight className="relative w-4 h-4 text-ink-mid group-hover:text-primary group-hover:translate-x-0.5 transition-all" aria-hidden="true" />
          </Link>

          {/* Travel Mode entry — a wide tile, shares the ONE entry path. */}
          <button
            type="button"
            onClick={() => enterTravel()}
            data-testid="home-bento-travel-mode"
            className="flex-[2_1_18rem] sm:flex-[2_1_26rem] min-h-[5.5rem] flex items-center justify-between gap-3 rounded-2xl glass-card p-4 hover:bg-white/10 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <span className="flex items-center gap-2">
              <Compass className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
              <span className="text-sm font-semibold text-white">Open Travel Mode</span>
            </span>
            <ArrowRight className="w-4 h-4 text-ink-mid" aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}

function BentoTile({
  testId,
  icon,
  label,
  className,
  children,
}: {
  testId: string;
  icon: React.ReactNode;
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      // The narrow flex basis is the DEFAULT, not part of the base string: a wide tile passes
      // its own, and if both landed in the list the winner would be decided by CSS source
      // order (which of the two utilities Tailwind emitted first), not by the order they were
      // written here. `??` makes it one or the other.
      //
      // `min-w-0` is NOT cosmetic. A flex item's automatic minimum size is its CONTENT's
      // min-content width, and "Next up" renders a `truncate` (white-space:nowrap) title, whose
      // min-content width is the whole untruncated string. Measured on the dev build at 390:
      // the tile refused to shrink below 494px inside a 356px row — 138px of horizontal page
      // overflow, and the title never ellipsised. The old `grid-cols-2` did not show this
      // because Tailwind's grid columns are `minmax(0, 1fr)`, which caps the track at 0 min;
      // flex-wrap has no equivalent, so the floor has to be written on the item.
      //
      // 8rem, and the root font is 17px so that is 136px: the largest basis that still PAIRS
      // two tiles at 320, the narrowest supported width (2×136 + the 12px gap = 284 ≤ 286 of
      // content box). At 9rem they went one-per-row there and the section grew by ~270px for
      // no gain; every wider breakpoint packs identically either way, and >=640 uses the
      // `sm:` basis regardless.
      className={`rounded-2xl glass-card p-4 flex flex-col justify-between min-h-[5.5rem] min-w-0 ${
        className ?? 'flex-[1_1_8rem] sm:flex-[1_1_12rem]'
      }`}
    >
      <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-ink-lo mb-2">
        <span className="text-muted-foreground">{icon}</span>
        {label}
      </p>
      {children}
    </div>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-ink-mid">{children}</p>;
}

function PctBar({ pct, testId }: { pct: number; testId: string }) {
  return (
    <div>
      <p className="text-sm font-semibold text-white mb-1">{pct}%</p>
      <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden" role="presentation">
        <div
          data-testid={testId}
          className="h-full rounded-full bg-primary"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
