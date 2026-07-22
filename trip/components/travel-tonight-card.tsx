'use client';

import { useEffect, useState } from 'react';
import { Music, MapPin } from 'lucide-react';
import { getNowUtcMsForPlace, getTodayInTrip, type TripToday } from '@/lib/trip-now';
import {
  offsetForCountry,
  getCountryForDate,
  placeWallClockToUtcMs,
  formatTimeAmPm,
  effectiveStartMinutes,
} from '@/core/dates';
import { useItineraryContext } from '@/components/itinerary-provider';
import { selectTonightItem } from '@/lib/travel-tonight';

/**
 * — Travel Mode "Tonight" emphasis.
 * A thin client shell over the PURE `selectTonightItem`: it
 * injects the clock (the same today-panel/hero-card cadence) and reads today's items via the
 * EXISTING `getDayPlan` lookup (`useItineraryContext`) — the SAME source the agenda/hero cards
 * read, so this never forks storage or duplicates a lookup.
 *
 * Only shows for the REAL today-in-trip (not a `?date=` preview — "tonight" is inherently
 * about today) once the place-local clock reaches 17:00 and today has a not-done item starting
 * at/after that hour. Static: no animation, so reduced motion is a non-issue by construction.
 */
export default function TravelTonightCard() {
  const { getDayPlan, hydrated } = useItineraryContext();

  const [todayInTrip, setTodayInTrip] = useState<TripToday | null>(null);
  const [nowUtcMs, setNowUtcMs] = useState<number>(0);

  useEffect(() => {
    const tick = () => {
      const t = getTodayInTrip();
      setTodayInTrip(t);
      if (t) setNowUtcMs(getNowUtcMsForPlace(t.date, offsetForCountry(getCountryForDate(t.date))));
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  if (!hydrated || !todayInTrip) return null;

  const offsetMin = offsetForCountry(getCountryForDate(todayInTrip.date));
  // Inverse of placeWallClockToUtcMs at minutes=0: today's place-local midnight, as a UTC
  // instant. The difference to "now" (also a UTC instant) is today's local minutes-of-day.
  const midnightUtcMs = placeWallClockToUtcMs(todayInTrip.date, 0, offsetMin);
  const nowLocalMinutes = Math.floor((nowUtcMs - midnightUtcMs) / 60000);

  const items = getDayPlan(todayInTrip.date).items;
  const tonightItem = selectTonightItem(items, nowLocalMinutes);
  if (!tonightItem) return null;

  const start = effectiveStartMinutes(tonightItem);

  return (
    <section
      aria-labelledby="travel-tonight-title"
      data-testid="travel-tonight"
      className="mx-auto mt-4 max-w-2xl rounded-2xl glass-card p-4 sm:p-5"
    >
      <p className="flex items-center gap-1.5 text-xs uppercase tracking-widest text-fuchsia-400/80">
        <Music className="h-3.5 w-3.5" aria-hidden="true" />
        Tonight
      </p>
      <h2
        id="travel-tonight-title"
        className="mt-1 font-display text-lg font-bold leading-snug text-white"
        data-testid="travel-tonight-title"
      >
        {tonightItem.title}
      </h2>
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-white/55">
        {typeof start === 'number' && (
          <span className="font-mono">{formatTimeAmPm(start)}</span>
        )}
        {tonightItem.location && (
          <span className="inline-flex min-w-0 items-center gap-1">
            <MapPin className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
            <span className="truncate">{tonightItem.location}</span>
          </span>
        )}
      </p>
    </section>
  );
}
