'use client';

import { useEffect } from 'react';

import { getTodayInTrip } from '@/lib/trip-now';

/**
 * Trip-phase ambient island.
 *
 * RETIRED the route-driven warm/cool CHROME sweep.
 * Interactive chrome is now ONE static gold accent site-wide: `--accent-scroll`
 * simply rests at its gold default in globals.css and nothing re-colours it, so
 * every consumer (section-heading underline, `:focus-visible` ring, `--shadow-glow`,
 * today-pulse, drag glow, cmdk) is uniformly gold, route-independent. The whole
 * rAF HSL tween + per-route accent table are deleted (: dead once chrome
 * unified).
 *
 * What survives is the AMBIENT backdrop's leg colouring — CONTENT wayfinding, not
 * chrome. We stamp
 * `data-trip-phase` on <html> from getTodayInTrip() ('pre' | 'nepal' | 'japan'),
 * which globals.css uses to warm/cool ONLY the decorative `--gradient-aurora`
 * lead stops (html[data-trip-phase='nepal'|'japan']). Read-only consumption of the
 * clock (the `?today=` override resolves here too, so the visual baselines'
 * frozen date deterministically yields 'pre'). Set once per load — the phase is a
 * calendar-day fact.
 */
export default function RouteAccentEngine() {
  useEffect(() => {
    document.documentElement.dataset.tripPhase = getTodayInTrip()?.country ?? 'pre';
  }, []);

  return null;
}
