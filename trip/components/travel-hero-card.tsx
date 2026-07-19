'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { m, useReducedMotion } from 'framer-motion';
import { Clock, MapPin, ArrowRight, Calendar, RotateCw, ChevronDown } from 'lucide-react';
import {
  formatDateLong,
  CATEGORY_COLORS,
  type ItineraryItem,
} from '@/lib/trip-data';
import { getNowUtcMsForPlace, getTodayInTrip, type TripToday } from '@/lib/trip-now';
import { offsetForCountry, getCountryForDate, getCityForDate, TRIP_DATES } from '@/core/dates';
import { useItineraryContext } from '@/components/itinerary-provider';
import { describeItemTime } from '@/lib/item-time-display';
import { deriveTravelHero, type TravelHeroState } from '@/lib/travel-hero';

/**
 * — Travel Mode Now/Next hero card (the top-of-`/travel` card).
 *
 * A client island that answers "what am
 * I doing right now, and what's next" for the day-in-trip. The phase (`upcoming`/`now`/`done`/
 * `untimed`/`empty`) is derived by the PURE `deriveTravelHero` — this component only
 * injects the clock and renders. Flighty-inspired: a framer spring flip on the current item
 * changing, an inline elapsed/remaining progress bar, a
 * tap-to-expand details region, and a manual recalculate control for the backgrounded-app
 * stale case.
 *
 * Clock cadence MIRRORS today-panel.tsx (do NOT diverge): `todayInTrip` + `nowUtcMs` resolve on
 * mount and re-resolve on a 1s interval (via `getTodayInTrip` / `getNowUtcMsForPlace`, incl. the
 * `?today=` override), so the card advances live and self-corrects at day boundaries.
 *
 * Reduced motion: the flip is React-level gated — under
 * `useReducedMotion()` the card renders a plain (non-animated) container (`data-flip-animated="false"`)
 * so a state change is an INSTANT swap, and the progress bar keeps a CSS `transition-none` so its
 * width is static-but-correct.
 *
 * @param date optional ISO `YYYY-MM-DD` to force a specific day. When
 * omitted the card tracks the live day-in-trip. Passing it freezes the resolved day but the
 * clock still ticks (progress/flip stay live for that day) — and the "now" instant / place
 * offset are resolved for THAT day (`getCountryForDate(date)`,), never today's, so a
 * preview of a different leg (the Dec 18/19 NPT→JST boundary) derives phases correctly.
 */
export default function TravelHeroCard({ date }: { date?: string } = {}) {
  const { getDayPlan, hydrated } = useItineraryContext();
  const prefersReducedMotion = useReducedMotion();

  const [todayInTrip, setTodayInTrip] = useState<TripToday | null>(null);
  const [nowUtcMs, setNowUtcMs] = useState<number>(0);
  const [expanded, setExpanded] = useState(false);

  // The one clock read, re-run on the 1s cadence (today-panel idiom). `recalc` is the same
  // read fired on demand by the manual button — for a backgrounded tab whose interval was
  // throttled, so the card can be forced fresh without waiting for the next tick. The "now"
  // instant is resolved for the FORCED `date` when one is passed, else the live trip day
  // — so a `?today=` override is re-interpreted at the PREVIEWED day's place, not today's.
  const recalc = () => {
    const t = getTodayInTrip();
    setTodayInTrip(t);
    const target = date ?? t?.date;
    if (target) setNowUtcMs(getNowUtcMsForPlace(target, offsetForCountry(getCountryForDate(target))));
  };

  useEffect(() => {
    recalc();
    const timer = setInterval(recalc, 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // Before hydration, reserve height so the island mount doesn't collapse→expand.
  if (!hydrated) {
    return (
      <div
        data-testid="travel-hero-skeleton"
        aria-hidden="true"
        className="mx-auto mt-6 min-h-[220px] max-w-2xl rounded-2xl glass-card"
      />
    );
  }

  // Off-trip (portfolio / pre-/post-trip) AND no forced day: the clock is outside Dec 9 – Jan 9
  // and nobody asked to preview a specific day either. Honest state. A
  // forced `date` bypasses this
  // and renders normally below, regardless of the live clock's trip-window status.
  if (!todayInTrip && !date) {
    return (
      <section
        aria-labelledby="travel-hero-title"
        data-testid="travel-hero"
        data-phase="off-trip"
        className="mx-auto mt-6 max-w-2xl rounded-2xl glass-card p-6 sm:p-8"
      >
        <p className="text-xs uppercase tracking-widest text-gold-400/80">Now &amp; next</p>
        <h2 id="travel-hero-title" className="mt-2 font-display text-2xl font-bold text-white">
          Not on the road yet
        </h2>
        <p className="mt-2 text-sm text-white/60" data-testid="travel-hero-offtrip">
          Travel Mode lights up during your trip (Dec 9 – Jan 9). Come back on a travel day for
          your live now-and-next.
        </p>
      </section>
    );
  }

  const resolvedDate = date ?? todayInTrip!.date;
  const resolvedCountry = getCountryForDate(resolvedDate);
  const resolvedDayNumber = TRIP_DATES.indexOf(resolvedDate) + 1;
  const resolvedCity = getCityForDate(resolvedDate);
  const items = getDayPlan(resolvedDate).items;
  const state = deriveTravelHero(items, {
    dayDate: resolvedDate,
    placeOffsetMin: offsetForCountry(resolvedCountry),
    nowUtcMs,
  });

  // The item whose details the expand region shows: the current activity, else the next.
  const focusItem = state.current ?? state.next;
  // Re-key the flip container on the focused item so a change springs; a stable key elsewhere.
  const flipKey = `${state.phase}:${focusItem?.id ?? 'none'}`;

  return (
    <section
      aria-labelledby="travel-hero-title"
      data-testid="travel-hero"
      data-phase={state.phase}
      className="mx-auto mt-6 max-w-2xl rounded-2xl glass-card p-6 sm:p-8"
    >
      {/* Day header — consistent with today-panel's "Day N — City". */}
      <header className="mb-5">
        <p className="text-xs uppercase tracking-widest text-gold-400/80">Now &amp; next</p>
        <h2
          id="travel-hero-title"
          className="mt-2 font-display text-2xl font-bold leading-tight text-white sm:text-3xl"
        >
          Day <span className="text-gradient-gold">{resolvedDayNumber}</span>
          <span className="mx-2 text-white/40">—</span>
          {resolvedCity}
        </h2>
        <p className="mt-1 text-sm text-white/50">{formatDateLong(resolvedDate)}</p>
      </header>

      <HeroBody
        state={state}
        date={resolvedDate}
        expanded={expanded}
        onToggleExpand={() => setExpanded((v) => !v)}
        prefersReducedMotion={!!prefersReducedMotion}
        flipKey={flipKey}
      />

      {/* Manual recalculate — the backgrounded-app stale fix. A deliberate ≥44px target that
          re-reads the clock and re-derives (not pull-to-refresh). Present whenever there is a
          live schedule to recompute. `aria-live` sibling announces the refresh. */}
      {(state.phase === 'now' || state.phase === 'upcoming' || state.phase === 'done') && (
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={recalc}
            data-testid="travel-hero-recalc"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white/70 outline-none transition-colors duration-200 hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
          >
            <RotateCw className="h-4 w-4" aria-hidden="true" />
            Recalculate
          </button>
        </div>
      )}
    </section>
  );
}

/** The phase-dependent body, wrapped in the reduced-motion-gated flip container. */
function HeroBody({
  state,
  date,
  expanded,
  onToggleExpand,
  prefersReducedMotion,
  flipKey,
}: {
  state: TravelHeroState;
  date: string;
  expanded: boolean;
  onToggleExpand: () => void;
  prefersReducedMotion: boolean;
  flipKey: string;
}) {
  const inner = (
    <PhaseContent
      state={state}
      date={date}
      expanded={expanded}
      onToggleExpand={onToggleExpand}
    />
  );

  // Reduced motion: render a plain container — the state swap is instant, no spring.
  if (prefersReducedMotion) {
    return (
      <div data-testid="travel-hero-flip" data-flip-animated="false">
        {inner}
      </div>
    );
  }

  // The Flighty-style spring flip: keyed on the focused item so a now/next change springs in.
  return (
    <m.div
      key={flipKey}
      data-testid="travel-hero-flip"
      data-flip-animated="true"
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
    >
      {inner}
    </m.div>
  );
}

function PhaseContent({
  state,
  date,
  expanded,
  onToggleExpand,
}: {
  state: TravelHeroState;
  date: string;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  if (state.phase === 'empty') {
    return (
      <div className="py-6 text-center" data-testid="travel-hero-empty">
        <Calendar className="mx-auto mb-3 h-10 w-10 text-white/10" aria-hidden="true" />
        <p className="text-sm text-white/60">Nothing planned for today yet.</p>
        <Link
          href="/plan/"
          className="mt-4 inline-flex items-center gap-2 rounded-lg glass-card px-4 py-2 text-sm font-medium text-white outline-none transition-colors duration-200 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
        >
          <Calendar className="h-4 w-4" aria-hidden="true" />
          Open the planner
        </Link>
      </div>
    );
  }

  if (state.phase === 'untimed') {
    return (
      <div className="py-6 text-center" data-testid="travel-hero-untimed">
        <p className="text-sm text-white/70">
          <span className="font-semibold text-gold-400">{state.untimedCount}</span>{' '}
          {state.untimedCount === 1 ? 'thing' : 'things'} planned today — no set times.
        </p>
        <p className="mt-1 text-xs text-white/50">See the full agenda below.</p>
      </div>
    );
  }

  if (state.phase === 'done') {
    return (
      <div className="py-6 text-center" data-testid="travel-hero-done">
        <p className="text-lg font-semibold text-white">You&rsquo;re all caught up.</p>
        <p className="mt-1 text-sm text-white/55">Everything planned for today is behind you.</p>
      </div>
    );
  }

  // now / upcoming — both show a headline activity (current or next) + expandable details.
  const isNow = state.phase === 'now';
  const headline = state.current ?? state.next;
  if (!headline) return null; // defensive; deriveTravelHero guarantees one here.

  const timeInfo = describeItemTime(headline, date);
  const cat = CATEGORY_COLORS[headline.category];

  return (
    <div>
      {/* Compact header is the expand toggle — a native button (keyboard-operable, aria-expanded). */}
      <button
        type="button"
        onClick={onToggleExpand}
        aria-expanded={expanded}
        aria-controls="travel-hero-details"
        data-testid="travel-hero-expand"
        className="group flex w-full items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left outline-none transition-colors duration-200 hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
      >
        <div className="min-w-0 flex-1">
          <p className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-gold-400/80">
            {isNow ? (
              <>
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                Happening now
              </>
            ) : (
              <>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                Up next
              </>
            )}
          </p>
          <p className="font-semibold leading-snug text-white" data-testid="travel-hero-headline">
            {headline.title}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-white/55">
            {timeInfo && (
              <span className="inline-flex items-center gap-1 font-mono">
                {timeInfo.label}
                {timeInfo.badge && (
                  <span className="text-[10px] uppercase tracking-wide text-white/45">
                    {timeInfo.badge}
                  </span>
                )}
              </span>
            )}
            {headline.location && (
              <span className="inline-flex min-w-0 items-center gap-1">
                <MapPin className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
                <span className="truncate">{headline.location}</span>
              </span>
            )}
          </p>
        </div>
        <ChevronDown
          aria-hidden="true"
          className={`mt-1 h-5 w-5 flex-shrink-0 text-white/40 transition-transform duration-200 ${
            expanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Inline progress bar — elapsed/remaining, only while something is in progress.
          Pure width from the injected clock; CSS transition is reduced-motion-neutralised app-wide. */}
      {isNow && state.progress !== null && (
        <div className="mt-3 px-1" data-testid="travel-hero-progress-wrap">
          <div
            role="progressbar"
            aria-label={`${headline.title} — elapsed`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(state.progress * 100)}
            data-testid="travel-hero-progress"
            data-progress={Math.round(state.progress * 100)}
            className="h-1.5 w-full overflow-hidden rounded-full bg-white/10"
          >
            <div
              className="h-full rounded-full bg-gold-400 transition-[width] duration-500"
              style={{ width: `${Math.round(state.progress * 100)}%` }}
            />
          </div>
          <p className="mt-1.5 flex justify-between text-[11px] text-white/45" aria-hidden="true">
            <span>{state.elapsedMinutes}m in</span>
            <span>{state.remainingMinutes}m left</span>
          </p>
        </div>
      )}

      {/* Expanded details — inline (not a navigation). Notes / category / duration and,
          while in "now", the following "then" line. */}
      {expanded && (
        <div
          id="travel-hero-details"
          data-testid="travel-hero-details"
          className="mt-3 space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm"
        >
          {cat && (
            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${cat.bg} ${cat.text}`}>
              {headline.category}
            </span>
          )}
          {headline.notes && <p className="whitespace-pre-wrap text-white/70">{headline.notes}</p>}
          {!headline.notes && !headline.location && (
            <p className="text-white/45">No extra details for this one.</p>
          )}
          {/* The "then" line: while in "now", name what follows. */}
          {isNow && state.next && (
            <p className="border-t border-white/10 pt-2 text-white/60" data-testid="travel-hero-then">
              <span className="text-gold-400/80">Then:</span> {state.next.title}
              {describeItemTime(state.next, date)?.label
                ? ` · ${describeItemTime(state.next, date)!.label}`
                : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
