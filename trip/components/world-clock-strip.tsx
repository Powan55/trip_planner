'use client';

import { useEffect, useState } from 'react';
import { isDefaultTrip } from '@/core/trips';
import { HOME_TIME_ZONE, formatZoneClock } from '@/core/dates';

// Home is an assumption (see HOME_TIME_ZONE) and Kathmandu/Tokyo are the default pack's two
// legs, so a custom trip renders nothing.
const CLOCKS = [
  { id: 'home', label: 'Home', timeZone: HOME_TIME_ZONE },
  { id: 'kathmandu', label: 'Kathmandu', timeZone: 'Asia/Kathmandu' },
  { id: 'tokyo', label: 'Tokyo', timeZone: 'Asia/Tokyo' },
] as const;

/**
 * Home / Kathmandu / Tokyo wall clocks for `/travel` and `/flights`. Minute resolution on a 30s
 * tick; deliberately not an aria-live region, so a screen reader is never interrupted by a clock.
 * Reads the REAL clock, never `getNow()`: `?today=` moves the trip's day, not the wall time.
 */
export default function WorldClockStrip() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!isDefaultTrip()) return null;

  return (
    <ul
      aria-label="World clocks"
      data-testid="world-clock-strip"
      className="mx-auto mt-2 flex max-w-2xl list-none flex-wrap gap-x-4 gap-y-1 px-gut py-1"
    >
      {CLOCKS.map(({ id, label, timeZone }) => {
        const time = formatZoneClock(now, timeZone);
        if (time === null) return null;
        return (
          <li key={id} data-testid={`world-clock-${id}`} className="flex items-baseline gap-2">
            <span className="pr pr--lo">{label}</span>
            <time dateTime={now.toISOString()} className="text-ink-hi tabular-nums">
              {time}
            </time>
          </li>
        );
      })}
    </ul>
  );
}
