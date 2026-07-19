'use client';

import { useEffect, useState } from 'react';
import { m, useReducedMotion } from 'framer-motion';
import { MapPin, ArrowRight } from 'lucide-react';
import {
  formatDateLong,
  CATEGORY_COLORS,
  type ItineraryItem,
} from '@/lib/trip-data';
import { getNowUtcMsForPlace, getTodayInTrip, type TripToday } from '@/lib/trip-now';
import { offsetForCountry } from '@/core/dates';
import { nextUp } from '@/lib/whats-next';
import { useItineraryContext } from '@/components/itinerary-provider';
import { generateItemId } from '@/lib/item-id';
import QuickAddInput from '@/components/quick-add-input';
import WeatherCard from '@/components/weather-card';
import JournalCard from '@/components/journal-card';
import TripAgenda from '@/components/trip-agenda';
import { fetchWeather, type WeatherResult } from '@/lib/weather';
import { describeItemTime } from '@/lib/item-time-display';

/**
 * —: the "Today" screen (the operational core).
 *
 * A home-page island that, ONLY when the app clock is inside the trip window
 * (Dec 9 2026 – Jan 9 2027 — via `getTodayInTrip()` incl. the `?today=`
 * override), surfaces TODAY'S agenda with per-item done-tracking. Outside the
 * window it renders `null`, so the pre-/post-trip home page is byte-unchanged.
 *
 * Clock cadence (MIRRORS hero-section.tsx exactly — do NOT diverge): `todayInTrip`
 * is `null` until mount (SSR-safe), then resolved via `getTodayInTrip()` on mount
 * and re-resolved on the SAME 1s interval the hero uses, so at midnight it
 * self-corrects (rolls to the next trip day / disappears at trip end) without a
 * reload. `getTodayInTrip()` is cheap + pure over the cached `?today=` resolution.
 *
 * Done-tracking: each item's toggle calls the EXISTING store method
 * `updateItem(today.date, item.id, { done: !item.done })` — no new store method,
 * no `hooks/use-itinerary.ts` change. Sync-on, `updateItem` already stamps rev/hlc
 * so a done-toggle propagates to friends + merges LWW for free; dormant,
 * it's a plain local persisted update.
 */
export default function TodayPanel() {
  const { getDayPlan, updateItem, addItem, hydrated } = useItineraryContext();
  const prefersReducedMotion = useReducedMotion();

  // `null` until mount (SSR-safe default) and whenever the clock is outside the
  // trip window. Resolved on mount + re-resolved on the same 1s cadence as the
  // hero's countdown/travel-mode flip, so it self-corrects at day boundaries.
  const [todayInTrip, setTodayInTrip] = useState<TripToday | null>(null);
  // "Now" as a UTC epoch-ms instant re-interpreted at TODAY'S place offset (: via
  // getNowUtcMsForPlace, incl. the ?today= override — place-noon under a ?today=DATE clock).
  // Feeds the pure `nextUp` helper for the "Up next" rail; re-resolved on the SAME 1s cadence
  // as `todayInTrip` so the rail advances live and self-corrects at day boundaries. `0` until
  // mount (SSR-safe; only read once `todayInTrip` is non-null, so the 0 is never observed).
  const [nowUtcMs, setNowUtcMs] = useState<number>(0);

  useEffect(() => {
    const tick = () => {
      const t = getTodayInTrip();
      setTodayInTrip(t);
      if (t) setNowUtcMs(getNowUtcMsForPlace(t.date, offsetForCountry(t.country)));
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  // Weather + golden-hour for the current trip city. Fetched on mount and whenever the
  // trip city changes (Kathmandu → Tokyo at the Nepal/Japan handover), NOT on the 1s clock
  // tick — the effect is keyed on `city`, so a same-city re-resolve does not refetch. The
  // fetch is total (never throws) and returns the cached last-good value when offline, so a
  // failed request quietly shows stale data rather than an error.
  const city = todayInTrip?.city ?? null;
  const [weather, setWeather] = useState<WeatherResult | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);

  useEffect(() => {
    if (city === null) {
      setWeather(null);
      setWeatherLoading(false);
      return;
    }
    let cancelled = false;
    setWeatherLoading(true);
    fetchWeather(city).then((result) => {
      if (cancelled) return;
      setWeather(result);
      setWeatherLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [city]);

  // Renders nothing outside the trip window (the home page is unchanged pre-/post-trip). Dormant/
  // portfolio (clock outside Dec 9–Jan 9) always takes this branch → byte-identical to before.
  if (!todayInTrip) return null;

  // In-trip but the store hasn't hydrated yet: reserve the panel's settled min-height instead of
  // returning null, so the island mount doesn't collapse→expand. Presentation
  // only; carries no `today-panel` testid so it can't be mistaken for the live panel.
  if (!hydrated) {
    return (
      <section id="today" aria-hidden="true" className="relative bg-surface py-12 sm:py-16 px-4 sm:px-6">
        <div
          data-testid="today-panel-skeleton"
          className="mx-auto min-h-[420px] max-w-3xl rounded-2xl glass-card"
        />
      </section>
    );
  }

  const dayPlan = getDayPlan(todayInTrip.date);
  const items = dayPlan.items;
  const doneCount = items.filter((it) => it.done === true).length;
  // The next upcoming, not-done, timed item by the resolved place-clock (pure `nextUp`,
  // /). `null` when everything is done/past or nothing is timed → the rail shows "all
  // caught up" (but only when there ARE items; a zero-item day keeps the empty state below).
  const upcoming = nextUp(items, {
    dayDate: todayInTrip.date,
    placeOffsetMin: offsetForCountry(todayInTrip.country),
    nowUtcMs,
  });

  // axe-deterministic reveal: the non-reduced-motion variant slides from y:16 at
  // FULL opacity (opacity pinned to 1), so the axe scan (which runs WITHOUT reduced motion)
  // can never catch the muted subtitle mid-fade below AA. Reduced-motion branch unchanged.
  const reveal = prefersReducedMotion
    ? { hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: 0.3 } } }
    : {
        hidden: { opacity: 1, y: 16 },
        show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const } },
      };

  return (
    <section
      id="today"
      aria-labelledby="today-title"
      data-testid="today-panel"
      className="relative bg-surface py-12 sm:py-16 px-4 sm:px-6"
    >
      <m.div
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.2 }}
        variants={reveal}
        className="max-w-3xl mx-auto glass-card rounded-2xl p-6 sm:p-8"
      >
        {}/* Header — "Day N — {city}", consistent with the hero's travel mode. */
        <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
          <div>
            <p className="text-xs uppercase tracking-widest text-gold-400/80 mb-2">Today on the trip</p>
            <h2 id="today-title" className="font-display text-2xl sm:text-3xl font-bold text-white leading-tight">
              Day <span className="text-gradient-gold">{todayInTrip.dayNumber}</span>
              <span className="text-white/40 mx-2">—</span>
              {todayInTrip.city}
            </h2>
            <p className="text-sm text-white/50 mt-1">{formatDateLong(todayInTrip.date)}</p>
          </div>
          {items.length > 0 && (
            <p className="text-sm text-white/50" aria-live="polite">
              <span className="font-semibold text-gold-400">{doneCount}</span>
              <span aria-hidden="true"> / </span>
              <span className="sr-only"> of </span>
              {items.length} done
            </p>
          )}
        </header>

        {}/* Weather + golden-hour for today's city — sits above the agenda. */
        <div className="mb-6">
          <WeatherCard result={weather} loading={weatherLoading} />
        </div>

        {/* "Up next" rail — the next upcoming item by the resolved clock, above the
            agenda. Only rendered when there ARE items (a zero-item day keeps the empty state
}            below); shows the next item when one is upcoming, else an "all caught up" line. */
        {items.length > 0 && (
          <div className="mb-6">
            <NextUpRail item={upcoming} date={todayInTrip.date} />
          </div>
        )}

        {/* The agenda list — extracted to the shared `TripAgenda` (today variant is
            byte-equivalent to the pre- markup). The done-toggle routes through the SAME
}            `updateItem` store method as before. */
        <TripAgenda
          variant="today"
          items={items}
          date={todayInTrip.date}
          dayNumber={todayInTrip.dayNumber}
          city={todayInTrip.city}
          onToggle={(item) => updateItem(todayInTrip.date, item.id, { done: !item.done })}
        />

        {/* Inline quick-add for today — title → Enter →
            addItem on today's date, through the same commit() choke-point. The Today agenda
            previously had NO add affordance; this is the fast title-only path (detail is
            editable later in the /plan editor). Available in both the empty and populated
}            states so a free day can be filled without leaving Home. */
        <div className="mt-6">
          <QuickAddInput
            label={`Quick-add a plan for today, ${formatDateLong(todayInTrip.date)}`}
            testId="today-quick-add"
            onAdd={(title) => addItem(todayInTrip.date, { id: generateItemId(), title, category: 'sightseeing' })}
          />
        </div>

        {/* In-trip per-day TEXT journal — below the agenda. Reads/writes today's entry via
            useJournal() (gateway key 12, localStorage-only); intrinsically in-trip-gated by the
}            panel. Photos are OUT (declared future boundary). */
        <JournalCard date={todayInTrip.date} />
      </m.div>
    </section>
  );
}

/**
 * The "Up next" rail. A prominent, non-interactive band naming the next upcoming
 * agenda item (time + title + category + location) by the resolved clock, or an "all caught
 * up" line when nothing is upcoming. Static markup consistent with the panel's glass-card
 * design — no motion-only affordance, so it is reduced-motion-safe by construction (the
 * parent panel owns the already-gated reveal). Semantic: an `aria-live="polite"` region so
 * the change is announced when the rail advances (e.g. after toggling the current item done).
 */
function NextUpRail({ item, date }: { item: ItineraryItem | null; date: string }) {
  const cat = item ? CATEGORY_COLORS[item.category] : null;
  // Display rule — NOT the `nextUp` selection logic
  // purely how the already-chosen item's time renders.
  const timeInfo = item ? describeItemTime(item, date) : null;

  return (
    <div
      data-testid="today-next-up"
      aria-live="polite"
      className="rounded-xl border border-gold-400/25 bg-gold-400/[0.06] p-4"
    >
      <p className="text-[11px] uppercase tracking-widest text-gold-400/80 mb-2 flex items-center gap-1.5">
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        Up next
      </p>
      {item ? (
        <div className="flex items-start gap-3">
          {timeInfo && (
            <span className="flex-shrink-0 font-mono text-lg font-bold text-gold-400 leading-tight">
              {timeInfo.label}
              {timeInfo.badge && (
                <span className="block text-[10px] font-sans font-normal uppercase tracking-wide text-gold-400/80 leading-tight">
                  {timeInfo.badge}
                </span>
              )}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-white leading-snug">{item.title}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-white/50">
              {item.location && (
                <span className="inline-flex items-center gap-1 min-w-0">
                  <MapPin className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
                  <span className="truncate">{item.location}</span>
                </span>
              )}
              {cat && (
                <span className={`inline-flex rounded-full px-2 py-0.5 ${cat.bg} ${cat.text}`}>
                  {item.category}
                </span>
              )}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-sm text-white/60">You're all caught up for today.</p>
      )}
    </div>
  );
}
