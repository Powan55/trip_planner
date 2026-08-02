'use client';

// Travel Mode date picker — a THIN wrapper over the existing `day-strip.tsx`,
// reused verbatim (not forked): this file only supplies the 32 trip dates + per-day meta the
// presentational strip needs, exactly as `calendar-planner.tsx` already does for `/plan`. All
// scroll-snap / reduced-motion / today-marker behavior lives in `DayStrip` untouched.
import { useMemo } from 'react';
import DayStrip from '@/components/day-strip';
import { TRIP_DATES, getCountryForDate } from '@/core/dates';
import { useItineraryContext } from '@/components/itinerary-provider';

export default function TravelDayStrip({
  selectedDate,
  todayDate,
  onSelect,
}: {
  selectedDate: string;
  todayDate: string | null;
  onSelect: (date: string) => void;
}) {
  const { getDayPlan } = useItineraryContext();

  // memoized — this walks all 32 trip days and calls `getDayPlan` on each, and it ran on
  // EVERY render of Travel Mode (which re-renders on its own clock tick). `getDayPlan` is
  // `useCallback(…, [plans])` in use-itinerary, so its identity IS the itinerary version tick:
  // the scan re-runs exactly when the itinerary changes and not once more.
  const meta = useMemo(
    () =>
      TRIP_DATES.map((date) => ({
        date,
        country: getCountryForDate(date),
        count: getDayPlan(date).items.length,
      })),
    [getDayPlan],
  );

  return (
    <DayStrip
      dates={TRIP_DATES}
      selectedDate={selectedDate}
      onSelect={onSelect}
      meta={meta}
      todayDate={todayDate}
    />
  );
}
