'use client';

// Travel Mode date picking. The single client island that owns the
// `?date=YYYY-MM-DD` URL param (bounded Dec 9 – Jan 9), reusing `day-strip.tsx` (via the thin
// `TravelDayStrip` wrapper) to pick a day, and feeding the resolved day to the hero card +
// agenda through their existing `date` seam. `?date=` is read via `useSearchParams` (the
// `?focus=` precedent) so a strip tap updates in place — no remount — and this whole
// module is mounted `ssr:false` (app/travel/sections.tsx), the same way `calendar-planner.tsx`
// avoids needing a separate Suspense boundary for `useSearchParams` in the static export.
//
// ── composition ───────────────────────────────────────────────────────────────
// `?date=` (which day) is decoupled from `?today=` (what time, — resolved entirely inside
// `getTodayInTrip()`/`getNow()`; this module never parses `?today=` itself). All the bounds/
// default-resolution logic is the PURE `resolveTravelDate` (`lib/travel-date.ts`) — this
// component only reads the URL + the clock and renders.
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { Calendar } from 'lucide-react';
import { TRIP_DATE_LABEL, formatDateLong } from '@/core/dates';
import { getNow, getTodayInTrip, type TripToday } from '@/lib/trip-now';
import { resolveTravelDate } from '@/lib/travel-date';
import { useItineraryContext } from '@/components/itinerary-provider';
import TravelDayStrip from '@/components/travel-day-strip';
import TravelHeroCard from '@/components/travel-hero-card';
import TravelAgendaCard from '@/components/travel-agenda-card';

// the Essentials block (weather/currency/safety/flight deep-links) is its OWN lazy
// island — a nested dynamic(ssr:false) import (fine inside a Client Component, unlike inside a
// Server Component) — so its currency-rate fetch + deep-link code splits into a separate chunk
// and never inflates `/travel`'s first-load JS.
const TravelEssentialsCard = dynamic(() => import('@/components/travel-essentials-card'), {
  ssr: false,
  loading: () => (
    <div aria-hidden="true" className="mx-auto mt-4 min-h-[160px] max-w-2xl rounded-2xl glass-card" />
  ),
});

// — two small night-out affordances (plan-audit-nightlife-2026-07-21.md), same nested
// dynamic(ssr:false) pattern as TravelEssentialsCard just above: both are
// pure/clock-driven reads with nothing to render server-side, so they split off the initial
// `/travel` chunk too.
const TravelLastTrainChip = dynamic(() => import('@/components/travel-last-train-chip'), {
  ssr: false,
  loading: () => <div aria-hidden="true" className="mx-auto mt-3 h-4 max-w-2xl" />,
});
const TravelTonightCard = dynamic(() => import('@/components/travel-tonight-card'), {
  ssr: false,
  loading: () => <div aria-hidden="true" className="mx-auto mt-4 min-h-0 max-w-2xl" />,
});

/** Rebuild the current query string with `date` set/cleared, preserving every other param
 * — mirrors calendar-planner's `?focus=` strip-and-replace. */
function withDateParam(current: URLSearchParams, date: string | null): string {
  const params = new URLSearchParams(current.toString());
  if (date === null) params.delete('date');
  else params.set('date', date);
  const qs = params.toString();
  return qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
}

export default function TravelDatePicker() {
  const { hydrated } = useItineraryContext();
  const searchParams = useSearchParams();

  const [todayInTrip, setTodayInTrip] = useState<TripToday | null>(null);
  const [nowMs, setNowMs] = useState<number>(0);

  useEffect(() => {
    const tick = () => {
      setTodayInTrip(getTodayInTrip());
      setNowMs(getNow().getTime());
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  if (!hydrated) {
    return (
      <div
        data-testid="travel-date-skeleton"
        aria-hidden="true"
        className="mx-auto mt-4 h-16 max-w-2xl rounded-2xl glass-card"
      />
    );
  }

  const dateParam = searchParams?.get('date') ?? null;
  const resolution = resolveTravelDate({
    dateParam,
    todayDate: todayInTrip?.date ?? null,
    now: new Date(nowMs),
  });

  // (TM-11 real defect): `router.replace` made this same-page param change fetch the RSC
  // payload (`/travel/index.txt?…`) — OFFLINE that fetch fails and Next hard-navigates to the
  // txt URL, which the SW can only answer with the nav-fallback Home shell: day picking died
  // offline. A same-document `history.replaceState` (Next ≥14.2 syncs it into
  // `useSearchParams`) is the network-free equivalent — same URL shape, every other param
  // still preserved by `withDateParam`, nothing fetched.
  const goTo = (date: string | null) =>
    window.history.replaceState(null, '', withDateParam(searchParams ?? new URLSearchParams(), date));

  // `?date=` present but malformed/outside Dec 9 – Jan 9: an honest empty state, never a crash
  // or a silent clamp, with a one-tap return to the default day.
  if (resolution.outOfRange) {
    return (
      <section
        aria-labelledby="travel-date-empty-title"
        data-testid="travel-date-empty"
        className="mx-auto mt-6 max-w-2xl rounded-2xl glass-card p-6 text-center sm:p-8"
      >
        <Calendar className="mx-auto mb-3 h-10 w-10 text-white/10" aria-hidden="true" />
        <h2 id="travel-date-empty-title" className="font-display text-xl font-bold text-white">
          Not a trip day
        </h2>
        <p className="mt-2 text-sm text-white/60">
          That date isn&rsquo;t part of the trip ({TRIP_DATE_LABEL}).
        </p>
        <button
          type="button"
          onClick={() => goTo(null)}
          data-testid="travel-date-empty-return"
          className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-lg glass-card px-4 py-2 text-sm font-medium text-white outline-none transition-colors duration-200 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
        >
          Back to today
        </button>
      </section>
    );
  }

  // Off-trip (pre-/post-trip clock) with no forced day and no pre-trip default: nothing for the
  // picker to show — the hero card's own off-trip fallback renders.
  if (resolution.date === null) {
    return <TravelHeroCard />;
  }

  const selectedDate = resolution.date;

  return (
    <>
      <div className="mx-auto mt-4 max-w-2xl">
        <TravelDayStrip
          selectedDate={selectedDate}
          todayDate={todayInTrip?.date ?? null}
          onSelect={(date) => goTo(date)}
        />
      </div>

      {resolution.isPreTripDefault && (
        <p
          data-testid="travel-pretrip-notice"
          className="mx-auto mt-3 max-w-2xl text-center text-sm text-white/60"
        >
          Trip starts in {resolution.daysUntilStart} {resolution.daysUntilStart === 1 ? 'day' : 'days'}
        </p>
      )}

      {resolution.isPreview && (
        <div
          data-testid="travel-preview-banner"
          className="mx-auto mt-3 flex max-w-2xl items-center justify-between gap-3 rounded-xl border border-gold-400/20 bg-gold-400/[0.06] px-4 py-2 text-sm text-gold-100"
        >
          <span>Previewing {formatDateLong(selectedDate)} — not today</span>
          <button
            type="button"
            onClick={() => goTo(null)}
            data-testid="travel-preview-back"
            className="shrink-0 rounded-lg px-3 py-1.5 font-medium text-gold-300 outline-none transition-colors duration-200 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
          >
            Back to today
          </button>
        </div>
      )}

      <TravelHeroCard date={selectedDate} />
      {/* today's evening item, only rendered once it's actually evening (component's own
          check) — a real `?date=` preview of another day naturally shows nothing, since "tonight"
          is about the real today-in-trip, not the previewed day. */}
      <TravelTonightCard />
      <TravelAgendaCard date={selectedDate} />
      {/* Japan-phase-only static last-train chip for the day being viewed. */}
      <TravelLastTrainChip date={selectedDate} />
      <TravelEssentialsCard date={selectedDate} />
    </>
  );
}
