'use client';

import { useEffect, useState } from 'react';
import { getNowUtcMsForPlace, getTodayInTrip, type TripToday } from '@/lib/trip-now';
import { useTravelTick } from '@/lib/travel-tick';
import { offsetForCountry, getCountryForDate, getCityForDate, TRIP_DATES } from '@/core/dates';
import { useItineraryContext } from '@/components/itinerary-provider';
import TripAgenda from '@/components/trip-agenda';
import { sortItemsByTime } from '@/lib/sort-items-by-time';

/**
 * — Travel Mode agenda island.
 *
 * A thin client shell: it injects the clock (the today-panel / hero-card idiom, incl. the
 * `?today=` override) and delegates ALL rendering to the shared `TripAgenda` (travel
 * variant). The done-toggle routes to the EXISTING `updateItem` store method — the SAME mutation
 * the Today panel uses — so a TM toggle reflects on the Today panel (and the hero card) and
 * survives reload for free. No new clock read lives in the shared component.
 *
 * @param date optional ISO `YYYY-MM-DD` to force a specific day; when
 * omitted it tracks the live day-in-trip. When passed, the "now" instant / place offset and
 * the header (day number / city) are resolved for THAT day (`getCountryForDate(date)`),
 * never today's — so a preview across the Dec 18/19 NPT→JST leg boundary derives correctly.
 */
export default function TravelAgendaCard({ date }: { date?: string } = {}) {
  const { getDayPlan, updateItem, hydrated } = useItineraryContext();

  const [todayInTrip, setTodayInTrip] = useState<TripToday | null>(null);
  const [nowUtcMs, setNowUtcMs] = useState<number>(() => Date.now());

  // recompute on the shared `/travel` tick (base 20s) — and immediately on a `date` change —
  // instead of a private 1s interval. `getNowUtcMsForPlace` still reads the real clock each run.
  const tickN = useTravelTick();
  useEffect(() => {
    const t = getTodayInTrip();
    setTodayInTrip(t);
    const target = date ?? t?.date;
    if (target) setNowUtcMs(getNowUtcMsForPlace(target, offsetForCountry(getCountryForDate(target))));
  }, [tickN, date]);

  // Reserve height before hydration so the island mount doesn't collapse→expand.
  if (!hydrated) {
    return (
      <div data-testid="travel-agenda-skeleton" className="load mx-auto mt-4 min-h-[160px] max-w-2xl">
        <span className="pr pr--lo">Loading</span>
      </div>
    );
  }

  // Off-trip AND no forced day: the hero card already shows the honest off-trip state; the
  // agenda simply stays out. A forced `date` bypasses this.
  if (!todayInTrip && !date) return null;

  const resolvedDate = date ?? todayInTrip!.date;
  const resolvedCountry = getCountryForDate(resolvedDate);
  // CHRONOLOGICAL (owner-instructed), matching the planner's day list and the Today panel: timed
  // items ascend by absolute instant (which is what gets the 2027-01-09 date-line day right),
  // untimed ones sink to a stable trailing run. Travel mode used to print the STORED order, so a
  // later plan entered first led the day. Pure view-level projection, no store write.
  //
  // Not a `useMemo`: this sits after the two early returns above, where a hook would break the
  // call-order rule. One day of a 32-day trip is a handful of rows, so the sort is free.
  const items = sortItemsByTime(
    getDayPlan(resolvedDate).items,
    resolvedDate,
    offsetForCountry(resolvedCountry),
  );

  return (
    <TripAgenda
      variant="travel"
      items={items}
      date={resolvedDate}
      dayNumber={TRIP_DATES.indexOf(resolvedDate) + 1}
      city={getCityForDate(resolvedDate)}
      onToggle={(item) => updateItem(resolvedDate, item.id, { done: !item.done })}
      ctx={{
        dayDate: resolvedDate,
        placeOffsetMin: offsetForCountry(resolvedCountry),
        nowUtcMs,
      }}
    />
  );
}
