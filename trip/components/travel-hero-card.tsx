'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Clock, ArrowRight, Calendar, MapPin } from 'lucide-react';
import { getNowUtcMsForPlace, getTodayInTrip, type TripToday } from '@/lib/trip-now';
import { useTravelTick } from '@/lib/travel-tick';
import { offsetForCountry, getCountryForDate, getCityForDate, TRIP_DATES } from '@/core/dates';
import { useItineraryContext } from '@/components/itinerary-provider';
import { describeItemTime } from '@/lib/item-time-display';
import { deriveTravelHero, type TravelHeroState } from '@/lib/travel-hero';

/**
 * → — Travel Mode Now/Next strip (the compact top-of-`/travel` line).
 *
 * made `/travel` checklist-first: the day's plan list is the primary surface, so this card
 * shrank from the full expand/progress/recalc/flip hero to a ONE-LINE now/next strip. The detail
 * it used to carry (expand region, progress bar, "then" line, manual recalculate) now lives in the
 * agenda rows below it (per-row now/upcoming/done phase + times, from the SAME `deriveTravelHero`
 * machine). This is a client island that only injects
 * the clock and renders — the phase is derived by the PURE `deriveTravelHero`, unchanged.
 *
 * Static by construction (no framer): a state change is an instant swap, so reduced motion
 * is a non-issue — the `travel-hero-flip`/`data-flip-animated="false"` marker is preserved for the
 * motion audit, always false here.
 *
 * @param date optional ISO `YYYY-MM-DD` to force a specific day. When omitted
 * the strip tracks the live day-in-trip; passing it resolves "now"/place for THAT day.
 */
export default function TravelHeroCard({ date }: { date?: string } = {}) {
  const { getDayPlan, hydrated } = useItineraryContext();

  const [todayInTrip, setTodayInTrip] = useState<TripToday | null>(null);
  const [nowUtcMs, setNowUtcMs] = useState<number>(0);

  // recompute on the shared `/travel` tick (base 20s) — and immediately on a `date` change.
  const tickN = useTravelTick();
  useEffect(() => {
    const t = getTodayInTrip();
    setTodayInTrip(t);
    const target = date ?? t?.date;
    if (target) setNowUtcMs(getNowUtcMsForPlace(target, offsetForCountry(getCountryForDate(target))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickN, date]);

  // Before hydration, reserve a little height so the island mount doesn't collapse→expand.
  if (!hydrated) {
    return (
      <div
        data-testid="travel-hero-skeleton"
        aria-hidden="true"
        className="mx-auto mt-4 h-16 max-w-2xl rounded-2xl glass-card"
      />
    );
  }

  // Off-trip (portfolio / pre-/post-trip) AND no forced day: honest state.
  if (!todayInTrip && !date) {
    return (
      <section
        aria-labelledby="travel-hero-title"
        data-testid="travel-hero"
        data-phase="off-trip"
        className="mx-auto mt-4 max-w-2xl rounded-2xl glass-card p-5 sm:p-6"
      >
        <p className="text-[11px] uppercase tracking-widest text-muted-foreground">Now &amp; next</p>
        <h2 id="travel-hero-title" className="mt-1 font-display text-lg font-bold text-white">
          Not on the road yet
        </h2>
        <p className="mt-1 text-sm text-white/60" data-testid="travel-hero-offtrip">
          Travel Mode lights up during your trip (Dec 9 – Jan 9).
        </p>
      </section>
    );
  }

  const resolvedDate = date ?? todayInTrip!.date;
  const resolvedDayNumber = TRIP_DATES.indexOf(resolvedDate) + 1;
  const resolvedCity = getCityForDate(resolvedDate);
  const items = getDayPlan(resolvedDate).items;
  const state = deriveTravelHero(items, {
    dayDate: resolvedDate,
    placeOffsetMin: offsetForCountry(getCountryForDate(resolvedDate)),
    nowUtcMs,
  });

  return (
    <section
      aria-labelledby="travel-hero-title"
      data-testid="travel-hero"
      data-phase={state.phase}
      className="mx-auto mt-4 max-w-2xl rounded-2xl glass-card px-4 py-3 sm:px-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="travel-hero-title" className="font-display text-sm font-bold leading-tight text-white">
          Day <span className="text-display-emphasis">{resolvedDayNumber}</span>
          <span className="mx-1.5 text-white/40">—</span>
          {resolvedCity}
        </h2>
      </div>
      <NowNextStrip state={state} date={resolvedDate} />
    </section>
  );
}

/** The one-line now/next body. `data-flip-animated="false"` is permanent here (static, no spring). */
function NowNextStrip({ state, date }: { state: TravelHeroState; date: string }) {
  if (state.phase === 'empty') {
    return (
      <p
        data-testid="travel-hero-empty"
        className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-white/60"
      >
        <Calendar className="h-4 w-4 text-white/25" aria-hidden="true" />
        Nothing planned yet.
        <Link
          href="/plan/"
          className="rounded font-medium text-primary underline decoration-white/20 underline-offset-2 outline-none hover:text-primary/80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          Open the planner
        </Link>
      </p>
    );
  }

  if (state.phase === 'untimed') {
    return (
      <p data-testid="travel-hero-untimed" className="mt-1 text-sm text-white/70">
        <span className="font-semibold text-foreground">{state.untimedCount}</span>{' '}
        {state.untimedCount === 1 ? 'thing' : 'things'} planned today — no set times.
      </p>
    );
  }

  if (state.phase === 'done') {
    return (
      <p data-testid="travel-hero-flip" data-flip-animated="false" className="mt-1 text-sm font-medium text-white/80">
        You&rsquo;re all caught up for today.
      </p>
    );
  }

  // now / upcoming — one headline line (current or next) + a compact "then" line while in "now".
  const isNow = state.phase === 'now';
  const headline = state.current ?? state.next;
  if (!headline) return null; // defensive; deriveTravelHero guarantees one here.
  const timeInfo = describeItemTime(headline, date);

  return (
    <div data-testid="travel-hero-flip" data-flip-animated="false" className="mt-1">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
        <span
          className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest ${
            isNow ? 'text-gold-400' : 'text-white/50'
          }`}
        >
          {isNow ? <Clock className="h-3 w-3" aria-hidden="true" /> : <ArrowRight className="h-3 w-3" aria-hidden="true" />}
          {isNow ? 'Now' : 'Up next'}
        </span>
        <span className="min-w-0 truncate font-semibold text-white" data-testid="travel-hero-headline">
          {headline.title}
        </span>
        {timeInfo && <span className="font-mono text-xs text-white/55">{timeInfo.label}</span>}
        {headline.location && (
          <span className="inline-flex min-w-0 items-center gap-1 text-xs text-white/45">
            <MapPin className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
            <span className="truncate">{headline.location}</span>
          </span>
        )}
      </p>
      {isNow && state.next && (
        <p className="mt-0.5 truncate text-xs text-white/45" data-testid="travel-hero-then">
          <span className="text-muted-foreground">Then ·</span> {state.next.title}
        </p>
      )}
    </div>
  );
}
