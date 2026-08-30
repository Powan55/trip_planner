'use client';

import { useEffect, useState } from 'react';
import { getNowUtcMsForPlace, getTodayInTrip, type TripToday } from '@/lib/trip-now';
import { useTravelTick } from '@/lib/travel-tick';
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
 *
 * Drawn as a printed row rather than a card, with the country chip carrying the leg. The heading
 * stays an `<h2>` because `/travel`'s only other headings are the masthead `<h1>` and the sibling
 * section `<h2>`s — an `<h3>` here would be a skipped level.
 */
export default function TravelTonightCard() {
  const { getDayPlan, hydrated } = useItineraryContext();

  const [todayInTrip, setTodayInTrip] = useState<TripToday | null>(null);
  const [nowUtcMs, setNowUtcMs] = useState<number>(0);

  // recompute on the shared `/travel` tick (base 20s) instead of a private 1s interval.
  const tickN = useTravelTick();
  useEffect(() => {
    const t = getTodayInTrip();
    setTodayInTrip(t);
    if (t) setNowUtcMs(getNowUtcMsForPlace(t.date, offsetForCountry(getCountryForDate(t.date))));
  }, [tickN]);

  if (!hydrated || !todayInTrip) return null;

  const country = getCountryForDate(todayInTrip.date);
  const offsetMin = offsetForCountry(country);
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
      className="mx-auto mt-4 grid max-w-2xl grid-cols-[80px_1fr_auto] items-start gap-3 border-t-2 border-border px-gut py-3"
    >
      <span className="num whitespace-nowrap text-t-sm text-ink-mid">
        {typeof start === 'number' ? formatTimeAmPm(start) : '—'}
      </span>
      <div className="min-w-0">
        <h2
          id="travel-tonight-title"
          data-testid="travel-tonight-title"
          className="text-t-body font-semibold leading-snug text-ink-hi"
        >
          {tonightItem.title}
        </h2>
        {tonightItem.location && <span className="pr pr--lo mt-1 block">{tonightItem.location}</span>}
      </div>
      <span className={country === 'japan' ? 'chip chip--jp' : 'chip chip--np'}>Tonight</span>
    </section>
  );
}
