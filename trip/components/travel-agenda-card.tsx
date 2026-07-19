'use client';

import { useEffect, useState } from 'react';
import { getNowUtcMsForPlace, getTodayInTrip, type TripToday } from '@/lib/trip-now';
import { offsetForCountry, getCountryForDate, getCityForDate, TRIP_DATES } from '@/core/dates';
import { useItineraryContext } from '@/components/itinerary-provider';
import TripAgenda from '@/components/trip-agenda';

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
  const [nowUtcMs, setNowUtcMs] = useState<number>(0);

  useEffect(() => {
    const tick = () => {
      const t = getTodayInTrip();
      setTodayInTrip(t);
      const target = date ?? t?.date;
      if (target) setNowUtcMs(getNowUtcMsForPlace(target, offsetForCountry(getCountryForDate(target))));
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [date]);

  // Reserve height before hydration so the island mount doesn't collapse→expand.
  if (!hydrated) {
    return (
      <div
        data-testid="travel-agenda-skeleton"
        aria-hidden="true"
        className="mx-auto mt-4 min-h-[160px] max-w-2xl rounded-2xl glass-card"
      />
    );
  }

  // Off-trip AND no forced day: the hero card already shows the honest off-trip state; the
  // agenda simply stays out. A forced `date` bypasses this.
  if (!todayInTrip && !date) return null;

  const resolvedDate = date ?? todayInTrip!.date;
  const resolvedCountry = getCountryForDate(resolvedDate);
  const items = getDayPlan(resolvedDate).items;

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
