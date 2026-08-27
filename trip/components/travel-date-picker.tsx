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
import { TRIP_DATE_LABEL, formatDateLong, getCountryForDate } from '@/core/dates';
import { getNow, getTodayInTrip, type TripToday } from '@/lib/trip-now';
import { useTravelTick } from '@/lib/travel-tick';
import { resolveTravelDate } from '@/lib/travel-date';
import { useItineraryContext } from '@/components/itinerary-provider';
import TravelDayStrip from '@/components/travel-day-strip';
import TravelHeroCard from '@/components/travel-hero-card';
import TravelAgendaCard from '@/components/travel-agenda-card';
import TravelSyncLine from '@/components/travel-sync-line';
import TravelLogDifferent from '@/components/travel-log-different';
import TravelExpenseQuickAdd from '@/components/travel-expense-quickadd';

// the Essentials block (weather/currency/safety/flight deep-links) is its OWN lazy
// island — a nested dynamic(ssr:false) import (fine inside a Client Component, unlike inside a
// Server Component) — so its currency-rate fetch + deep-link code splits into a separate chunk
// and never inflates `/travel`'s first-load JS.
const TravelEssentialsCard = dynamic(() => import('@/components/travel-essentials-card'), {
  ssr: false,
  loading: () => (
    <div className="load mx-auto mt-4 min-h-[160px] max-w-2xl">
      <span className="pr pr--lo">Loading</span>
    </div>
  ),
});

// — two small night-out affordances (plan-audit-nightlife-2026-07-21.md), same nested
// dynamic(ssr:false) pattern as TravelEssentialsCard just above: both are
// pure/clock-driven reads with nothing to render server-side, so they split off the initial
// `/travel` chunk too.
const TravelLastTrainChip = dynamic(() => import('@/components/travel-last-train-chip'), {
  ssr: false,
  loading: () => <div aria-hidden="true" className="mx-auto mt-4 h-12 max-w-2xl" />,
});
const TravelTonightCard = dynamic(() => import('@/components/travel-tonight-card'), {
  ssr: false,
  loading: () => <div aria-hidden="true" className="mx-auto mt-4 min-h-0 max-w-2xl" />,
});

// — the day's map (a collapsed <details> hosting the existing <PlanDayMap>). Same nested
// dynamic(ssr:false) island pattern as the three above: its own chunk, and the maplibre
// runtime inside it stays interaction-lazy because the pane only renders once the row is opened.
const TravelDayMap = dynamic(() => import('@/components/travel-day-map'), {
  ssr: false,
  loading: () => (
    <div className="load mx-auto mt-4 min-h-tap max-w-2xl">
      <span className="pr pr--lo">Loading</span>
    </div>
  ),
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
  // / /: deliberately NO traveler redirect here. TokenGate's wall (mounted
  // unconditionally, no pathname term — `components/token-gate.tsx`'s
  // `show = mounted && (held || !traveler)`) already covers an unidentified visitor on /travel
  // exactly like every other route; `{children}` (this component included) stays mounted BEHIND
  // it, unrendered to the eye — the same "hidden render needs no action" reasoning
  // `trips-hub.tsx`'s `canManage` already uses. A redirect used to live here as "defense-in-depth
  // against the hidden render," but a hidden render needs no NAVIGATION response — and paired
  // with `travel-mode-relaunch.tsx`'s un-guarded PWA-boot bounce, the two `replace` calls formed
  // an inescapable reload loop for a signed-out visitor with a stale `travelMode` flag (sign-out
  // never clears it). Do not reintroduce a traveler check here without re-reading that file's
  // docstring first.

  // Seeded from LAZY INITIALIZERS, the pattern `hero-section.tsx` and `home-stat-row.tsx` already
  // use: the effect below runs after the FIRST PAINT, and `resolveTravelDate` has no "clock not
  // read yet" state — it read the old `0` seed as a real instant (1970-01-01), took the pre-trip
  // branch and painted "Trip starts in 20797 days". `null` for `todayInTrip` is a real sentinel;
  // `0` for an epoch never was. This island is `ssr: false` (`app/travel/sections.tsx`), so
  // reading the clock during render is safe — there is no server frame to mismatch.
  const [todayInTrip, setTodayInTrip] = useState<TripToday | null>(() => getTodayInTrip());
  const [nowMs, setNowMs] = useState<number>(() => getNow().getTime());

  // recompute on the shared `/travel` tick (base 20s) instead of a private 1s interval.
  const tickN = useTravelTick();
  useEffect(() => {
    setTodayInTrip(getTodayInTrip());
    setNowMs(getNow().getTime());
  }, [tickN]);

  if (!hydrated) {
    return (
      <div data-testid="travel-date-skeleton" className="load mx-auto mt-4 h-16 max-w-2xl">
        <span className="pr pr--lo">Loading</span>
      </div>
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
        className="mx-auto mt-6 max-w-2xl border-t-2 border-border"
      >
        {/* The shape the day cell will take, drawn hollow, rather than a grey sentence. */}
        <div className="cell is-hollow border-r-0">
          <h2 id="travel-date-empty-title">
            <span className="l">Day</span>{' '}
            <span className="v !text-n-lg">&mdash;</span>{' '}
            <span className="f">Not a trip day</span>
          </h2>
        </div>
        <p className="empty px-gut py-3">
          The trip runs {TRIP_DATE_LABEL}. Nothing is filed outside it.
        </p>
        <div className="px-gut pb-3">
          <button
            type="button"
            onClick={() => goTo(null)}
            data-testid="travel-date-empty-return"
            className="btn w-full"
          >
            Back to today
          </button>
        </div>
      </section>
    );
  }

  // Off-trip (pre-/post-trip clock) with no forced day and no pre-trip default: nothing for the
  // picker to show — the hero card's own off-trip fallback renders.
  if (resolution.date === null) {
    return <TravelHeroCard />;
  }

  const selectedDate = resolution.date;

  // The leg the whole day subtree is read against. `--now` resolves off this one attribute, so
  // every country-aware mark below (cells, chips, the running head's leg field) follows the
  // picked day rather than being repainted per component.
  const leg = getCountryForDate(selectedDate);

  return (
    <div data-leg={leg}>
      {/* the running head — the one piece of chrome on a chrome-free route, and the honest
          connection field lives in it (see travel-sync-line.tsx). Placed first so its sticky
          position pins under the safe-area inset with nothing above it to fight. */}
      <TravelSyncLine date={selectedDate} />

      <div className="mx-auto mt-3 max-w-2xl">
        <TravelDayStrip
          selectedDate={selectedDate}
          todayDate={todayInTrip?.date ?? null}
          onSelect={(date) => goTo(date)}
        />
      </div>

      {resolution.isPreTripDefault && (
        <p data-testid="travel-pretrip-notice" className="pr pr--l mx-auto mt-3 max-w-2xl px-gut">
          Trip starts in {resolution.daysUntilStart} {resolution.daysUntilStart === 1 ? 'day' : 'days'}
        </p>
      )}

      {resolution.isPreview && (
        <div
          data-testid="travel-preview-banner"
          className="mx-auto mt-3 flex max-w-2xl flex-wrap items-center justify-between gap-x-3 gap-y-2 border-y-hair border-border px-gut py-2"
        >
          <span className="pr pr--lo min-w-0">
            Previewing {formatDateLong(selectedDate)} &mdash; not today
          </span>
          <button
            type="button"
            onClick={() => goTo(null)}
            data-testid="travel-preview-back"
            className="chip min-h-tap shrink-0 border-[color:var(--accent)] px-3 text-[color:var(--accent)] outline-none transition-colors duration-200 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Back to today
          </button>
        </div>
      )}

      {/* the hero shrank to a ONE-LINE now/next strip so the checklist below is the primary
          surface. Its off-trip fallback still renders above (resolution.date === null branch). */}
      <TravelHeroCard date={selectedDate} />

      {/* CHECKLIST-FIRST — the day's plan is
          now the primary thing on screen. */}
      <TravelAgendaCard date={selectedDate} />

      {/* — the day's stops on a map, directly under the checklist they belong to. Scoped to
          `selectedDate` ONLY (one day plan in, one day's pins out) and re-scoped automatically on
          every chip tap, since this whole subtree re-renders with the new resolved date. */}
      <TravelDayMap date={selectedDate} />

      {/* — the "Log something different" quick-add (T3): an inline ≤2-field add (title +
          optional category) that lands an item on the viewed day ALREADY checked `done` (
          "✓ Completed · <name>" footer). INLINE inside the TM root — no modal/portal. */}
      <TravelLogDifferent date={selectedDate} />

      {/* #260 — inline expense quick-add: logging a spend no longer means leaving Travel Mode
          and scrolling to the calendar's budget panel. INLINE inside the TM root — no
          modal/portal, same TM-9 contract as TravelLogDifferent just above. */}
      <TravelExpenseQuickAdd date={selectedDate} />

      {/* secondary affordances — demoted below the checklist so they never compete with it for
          primary attention. Tonight only shows once it's actually evening (its own check); a
          real `?date=` preview of another day shows nothing since "tonight" is about the real
          today-in-trip. The last-train chip is Japan-phase only for the viewed day. */}
      <TravelTonightCard />
      <TravelLastTrainChip date={selectedDate} />

      {/* Essentials collapsed to ONE expandable row (closed by default). */}
      <TravelEssentialsCard date={selectedDate} />
    </div>
  );
}
