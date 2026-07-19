'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Compass, Wallet, CloudSun, Backpack, FileCheck2, Map as MapIcon, ArrowRight } from 'lucide-react';
import { getTodayInTrip, getNowUtcMsForPlace, type TripToday } from '@/lib/trip-now';
import { offsetForCountry } from '@/core/dates';
import { nextUp } from '@/lib/whats-next';
import { useItineraryContext } from '@/components/itinerary-provider';
import { useBudget } from '@/hooks/use-budget';
import { useExpenses } from '@/hooks/use-expenses';
import { usePacking } from '@/hooks/use-packing';
import { useDocs } from '@/hooks/use-docs';
import { useEnterTravelMode } from '@/hooks/use-travel-mode';
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

  const { getDayPlan, hydrated: itineraryHydrated } = useItineraryContext();
  const { model } = useBudget();
  const { expenses } = useExpenses();
  const { progress: packingProgress, hydrated: packingHydrated } = usePacking();
  const { completion: docsCompletion, hydrated: docsHydrated } = useDocs();
  const enterTravel = useEnterTravelMode();

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

  const cachedForecast = todayInTrip
    ? getCachedForecastForDate(todayInTrip.city, todayInTrip.date)
    : null;
  const weatherTag = weatherTagForDay(cachedForecast);

  const packingPct = packingProgress.total > 0 ? Math.round((packingProgress.checked / packingProgress.total) * 100) : null;
  const docsPct = docsCompletion.total > 0 ? Math.round((docsCompletion.done / docsCompletion.total) * 100) : null;

  return (
    <section aria-labelledby="home-bento-title" data-testid="home-bento" className="relative bg-surface py-4 sm:py-6 px-4 sm:px-6">
      <div className="max-w-5xl mx-auto">
        <h2 id="home-bento-title" className="sr-only">
          Trip at a glance
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {/* Next up — spans 2 cols on every breakpoint (the widest tile). In-trip only. */}
          <BentoTile
            testId="home-bento-next-up"
            className="col-span-2"
            icon={<ArrowRight className="w-4 h-4" aria-hidden="true" />}
            label="Next up"
          >
            {!todayInTrip ? (
              <EmptyLine>Appears once your trip begins</EmptyLine>
            ) : upcoming ? (
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white truncate">{upcoming.title}</p>
                {upcomingTime && <p className="text-xs text-white/50 mt-0.5">{upcomingTime.label}</p>}
              </div>
            ) : (
              <EmptyLine>You&rsquo;re all caught up today</EmptyLine>
            )}
          </BentoTile>

          {/* Budget spent-so-far. */}
          <BentoTile testId="home-bento-budget" icon={<Wallet className="w-4 h-4" aria-hidden="true" />} label="Budget">
            {roll.totalBudgetHome > 0 ? (
              <p className="text-sm font-semibold text-white">
                {formatMoney(roll.totalSpentHome, roll.home)}{' '}
                <span className="text-white/40 font-normal">/ {formatMoney(roll.totalBudgetHome, roll.home)}</span>
              </p>
            ) : (
              <EmptyLine>Set a budget in Settings</EmptyLine>
            )}
          </BentoTile>

          {/* Weather now (cache-derived, no new fetch) — in-trip only. */}
          <BentoTile testId="home-bento-weather" icon={<CloudSun className="w-4 h-4" aria-hidden="true" />} label="Weather">
            {weatherTag ? (
              <p className="text-sm font-semibold text-white">
                <span aria-hidden="true">{weatherTag.icon}</span> {weatherTag.label}
              </p>
            ) : todayInTrip ? (
              <EmptyLine>No cached forecast yet</EmptyLine>
            ) : (
              <EmptyLine>Appears once you&rsquo;re on the trip</EmptyLine>
            )}
          </BentoTile>

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

          {/* Mini map/photo link tile — spans 2 cols, decorative gradient art. */}
          <Link
            href="/map/"
            data-testid="home-bento-map"
            className="col-span-2 group relative overflow-hidden rounded-2xl glass-card p-4 flex items-center justify-between gap-3 outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
          >
            <div
              aria-hidden="true"
              className="absolute inset-0 opacity-40 group-hover:opacity-60 transition-opacity"
              style={{
                background:
                  'radial-gradient(60% 80% at 0% 0%, rgba(244,196,107,0.35) 0%, rgba(244,196,107,0) 60%), radial-gradient(60% 80% at 100% 100%, rgba(244,143,177,0.30) 0%, rgba(244,143,177,0) 60%)',
              }}
            />
            <div className="relative flex items-center gap-2">
              <MapIcon className="w-4 h-4 text-gold-400" aria-hidden="true" />
              <span className="text-sm font-semibold text-white">Open the map</span>
            </div>
            <ArrowRight className="relative w-4 h-4 text-white/40 group-hover:text-gold-400 group-hover:translate-x-0.5 transition-all" aria-hidden="true" />
          </Link>

          {/* Travel Mode entry — spans 2 cols, shares the ONE entry path. */}
          <button
            type="button"
            onClick={() => enterTravel()}
            data-testid="home-bento-travel-mode"
            className="col-span-2 flex items-center justify-between gap-3 rounded-2xl glass-card p-4 hover:bg-white/10 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
          >
            <span className="flex items-center gap-2">
              <Compass className="w-4 h-4 text-gold-400" aria-hidden="true" />
              <span className="text-sm font-semibold text-white">Open Travel Mode</span>
            </span>
            <ArrowRight className="w-4 h-4 text-white/40" aria-hidden="true" />
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
      className={`rounded-2xl glass-card p-4 flex flex-col justify-between min-h-[5.5rem] ${className ?? ''}`}
    >
      <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-white/40 mb-2">
        <span className="text-gold-400">{icon}</span>
        {label}
      </p>
      {children}
    </div>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-white/35">{children}</p>;
}

function PctBar({ pct, testId }: { pct: number; testId: string }) {
  return (
    <div>
      <p className="text-sm font-semibold text-white mb-1">{pct}%</p>
      <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden" role="presentation">
        <div
          data-testid={testId}
          className="h-full rounded-full bg-gold-400"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
