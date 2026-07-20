'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { listKnownTrips, joinTrip, type TripMeta } from '@/core/trips/registry';
import { getActiveTripId, DEFAULT_TRIP_ID } from '@/core/storage/gateway';
import { useActiveTraveler } from '@/hooks/use-active-traveler';

/**
 * Home "Your trips" chip strip — makes Home recognizably multi-trip on first paint:
 * a compact horizontal chip row above the hero. Current trip highlighted (non-interactive,
 * `aria-current`); any other known trip is one tap away via the switch primitive
 * VERBATIM — `joinTrip(id)` then a full reload (we're already on the landing target, so
 * `location.reload()` IS the full navigation); `+ New` links to the `/trips/` hub for
 * everything beyond switching.
 *
 * GUESTS see no strip (`traveler === null` → null, the concierge-chat gate pattern) — the
 * registry is meaningless for local-only demo viewers. Storage is read post-mount only
 * (ssr:false island; mount-gate mirrors trips-hub).
 *
 * Mounted in `app/page.tsx` through the SAME `LazyVisible` + `dynamic(ssr:false)` island
 * recipe as `HomeSectionNav`: Home's First Load JS sits at the 107 kB boundary
 * with ~zero headroom, so this chunk must stay OUT of the initial preload set.
 *
 * `pt-16` clears the fixed navbar (h-16) — this is the first in-flow element on the page.
 * Chip styling reuses the navbar/trips-hub pill vocabulary (rounded-full, gold accent,
 * ≥44px targets, visible focus rings). No animation — nothing for reduced-motion to
 * neutralize.
 */
export default function HomeTripStrip() {
  const { traveler } = useActiveTraveler();
  const [trips, setTrips] = useState<TripMeta[] | null>(null);
  const [activeId, setActiveId] = useState<string>(DEFAULT_TRIP_ID);

  useEffect(() => {
    setTrips(listKnownTrips());
    setActiveId(getActiveTripId());
  }, []);

  if (!traveler || trips === null) return null;

  // switch = register + write the active-trip pointer, then a FULL reload
  // so the whole pack re-hydrates against the new trip.
  const switchTo = (id: string) => {
    joinTrip(id);
    window.location.reload();
  };

  return (
    <nav aria-label="Your trips" data-testid="home-trip-strip" className="pt-16">
      <div className="mx-auto flex max-w-[1200px] items-center gap-2 overflow-x-auto px-4 py-2 sm:px-6">
        <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-white/60">
          Your trips
        </span>
        {trips.map((t, i) =>
          t.id === activeId ? (
            <span
              key={t.id}
              aria-current="true"
              data-testid={`home-trip-chip-${i}`}
              className="inline-flex min-h-[44px] shrink-0 items-center rounded-full border border-gold-400/60 bg-gold-400/10 px-3.5 text-sm font-semibold text-gold-400"
            >
              <span className="max-w-[12rem] truncate">{t.name}</span>
            </span>
          ) : (
            <button
              key={t.id}
              type="button"
              onClick={() => switchTo(t.id)}
              aria-label={`Switch to trip ${t.name}`}
              data-testid={`home-trip-chip-${i}`}
              className="inline-flex min-h-[44px] shrink-0 items-center rounded-full border border-white/15 px-3.5 text-sm font-medium text-white/70 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
            >
              <span className="max-w-[12rem] truncate">{t.name}</span>
            </button>
          ),
        )}
        <Link
          href="/trips/"
          data-testid="home-trip-new"
          className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full border border-white/15 px-3.5 text-sm font-medium text-white/70 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New
        </Link>
      </div>
    </nav>
  );
}
