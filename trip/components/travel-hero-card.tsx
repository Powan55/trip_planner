'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getNowUtcMsForPlace, getTodayInTrip, type TripToday } from '@/lib/trip-now';
import { useTravelTick } from '@/lib/travel-tick';
import { offsetForCountry, getCountryForDate, getCityForDate, TRIP_DATES } from '@/core/dates';
import { useItineraryContext } from '@/components/itinerary-provider';
import { describeItemTime } from '@/lib/item-time-display';
import { deriveTravelHero, type TravelHeroState } from '@/lib/travel-hero';

/** The printed stand-in for a row that carries no clock time. One em-dash, not a blanked
 *  ——:—— — five em-dashes overrun the 58px time column and wrap it to two lines. */
const NO_TIME = '—';

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
 * Drawn as the screen's headline instrument cell: the day number is the loudest object, at the
 * headline numeral step, and the now/next rows are printed list rows underneath it. `now` takes an
 * accent RULE (the row's inset bar), never an accent fill — the screen's one fill belongs to the
 * last-train stamp, the single mark here that is true only today.
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
  }, [tickN, date]);

  // Before hydration, reserve the height the cell will take. The word is a real text node and not
  // a `content:` string — a bare grey block is indistinguishable from an empty one.
  if (!hydrated) {
    return (
      <div data-testid="travel-hero-skeleton" className="load mx-auto mt-3 h-24 max-w-2xl">
        <span className="pr pr--lo">Loading</span>
      </div>
    );
  }

  // Off-trip (portfolio / pre-/post-trip) AND no forced day: honest state, drawn as the SHAPE the
  // day cell will take rather than as a grey sentence.
  if (!todayInTrip && !date) {
    return (
      <section
        aria-labelledby="travel-hero-title"
        data-testid="travel-hero"
        data-phase="off-trip"
        className="mx-auto mt-3 max-w-2xl border-t-2 border-border"
      >
        <div className="cell border-r-0">
          <h2 id="travel-hero-title">
            <span className="l">Day</span>{' '}
            <span className="v !text-n-lg !text-ink-lo">&mdash;</span>{' '}
            <span className="f">Not on the road yet</span>
          </h2>
        </div>
        <p className="empty px-gut py-3" data-testid="travel-hero-offtrip">
          Travel Mode lights up during your trip (Dec 9 &ndash; Jan 9).
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
      className="mx-auto mt-3 max-w-2xl border-t-2 border-border"
    >
      <div className={`cell border-r-0${resolvedDate === todayInTrip?.date ? ' is-now' : ''}`}>
        {/* The space-separated parts are the accessible name AND the printed cell: label, the
            headline numeral, the place it belongs to. */}
        <h2 id="travel-hero-title">
          <span className="l">Day</span>{' '}
          <span className="v !text-n-lg">
            {resolvedDayNumber}
            <small>/{TRIP_DATES.length}</small>
          </span>{' '}
          <span className="f">{resolvedCity}</span>
        </h2>
      </div>
      <NowNextStrip state={state} date={resolvedDate} />
    </section>
  );
}

/**
 * The now/next body, drawn as printed list rows. `data-flip-animated="false"` is permanent here
 * (static, no spring).
 */
function NowNextStrip({ state, date }: { state: TravelHeroState; date: string }) {
  if (state.phase === 'empty') {
    return (
      <div data-testid="travel-hero-empty" className="border-t-hair border-border px-gut py-3">
        <p className="empty">Nothing struck in for this day yet.</p>
        <Link href="/plan/" className="btn mt-3 w-full no-underline">
          Open the planner
        </Link>
      </div>
    );
  }

  if (state.phase === 'untimed') {
    return (
      <div className="list">
        <div className="r" data-mark="hollow">
          <span className="tm">{NO_TIME}</span>
          <div className="min-w-0">
            <h3 data-testid="travel-hero-untimed">
              {state.untimedCount} {state.untimedCount === 1 ? 'thing' : 'things'} planned
            </h3>
            <span className="mt">no set times</span>
          </div>
          <span className="hollow-tag">Not yet</span>
        </div>
      </div>
    );
  }

  if (state.phase === 'done') {
    return (
      <div className="list">
        <div className="r">
          <span className="tm">{NO_TIME}</span>
          <div className="min-w-0">
            <h3 data-testid="travel-hero-flip" data-flip-animated="false">
              All caught up for today
            </h3>
            <span className="mt">every item struck</span>
          </div>
          <span className="chip chip--struck">Struck</span>
        </div>
      </div>
    );
  }

  // now / upcoming — one headline row (current or next) + a compact "then" row while in "now".
  const isNow = state.phase === 'now';
  const headline = state.current ?? state.next;
  if (!headline) return null; // defensive; deriveTravelHero guarantees one here.
  const timeInfo = describeItemTime(headline, date);
  const remaining = isNow ? state.remainingMinutes : null;
  const thenTime = state.next ? describeItemTime(state.next, date) : null;

  return (
    <div className="list" data-testid="travel-hero-flip" data-flip-animated="false">
      {/* `aria-current` on the live row draws the recipe's accent RULE — a 3px inset bar — which
          spends nothing against the screen's one accent FILL. */}
      <div className="r" aria-current={isNow ? 'true' : undefined}>
        <span className="tm">{timeInfo ? timeInfo.label : NO_TIME}</span>
        <div className="min-w-0">
          <h3 data-testid="travel-hero-headline" className="truncate">
            {headline.title}
          </h3>
          <span className="mt">
            {isNow ? 'Now' : 'Up next'}
            {remaining !== null && ` · ${remaining} min left`}
            {headline.location ? ` · ${headline.location}` : ''}
          </span>
        </div>
        <span className={`chip${isNow ? ' border-[color:var(--accent)] text-[color:var(--accent)]' : ''}`}>
          {isNow ? 'Now' : 'Next'}
        </span>
      </div>
      {isNow && state.next && (
        <div className="r" data-mark="hollow">
          <span className="tm">{thenTime ? thenTime.label : NO_TIME}</span>
          <div className="min-w-0">
            <h3 data-testid="travel-hero-then" className="truncate">
              {state.next.title}
            </h3>
            <span className="mt">then</span>
          </div>
          <span className="hollow-tag">Not yet</span>
        </div>
      )}
    </div>
  );
}
