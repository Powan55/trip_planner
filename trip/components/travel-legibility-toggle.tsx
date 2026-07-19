'use client';

import { useEffect, useState } from 'react';
import { Sun } from 'lucide-react';
import { legibilityPrefs } from '@/core/storage/gateway';

/**
 * — Travel Mode outdoor high-legibility toggle.
 *
 * v5's deliberate substitute for a site-wide light mode: ONE tap flips `/travel`'s presentation
 * to a higher-contrast, larger-type mode for bright-sunlight use. The choice persists via the
 * gateway's `legibilityPrefs` so a reload/PWA relaunch restores it.
 *
 * Mechanism: this component owns the ONLY place `data-tm-legibility` is written —
 * stamped on `<html>` as `"high"` while ON, ABSENT while off. It is mounted exclusively inside
 * the `/travel` client island tree (`app/travel/page.tsx`, TM-local), so the attribute only ever
 * exists while a traveler is actually on `/travel`; the unmount cleanup removes it unconditionally
 * (route leave), which is this slice's main risk (a leaked attribute recoloring the rest of the
 * app — forbids that). `globals.css`'s `html[data-tm-legibility='high']` block does the
 * actual re-tinting/re-sizing; this component is pure state + the attribute handshake.
 *
 * Read-then-stamp on mount (not render): avoids an SSR/first-paint mismatch (the exported HTML
 * never has the attribute; the effect below applies the persisted choice right after hydration,
 * matching every other TM island's hydrate-then-tick pattern, e.g. travel-hero-card.tsx).
 */
export default function TravelLegibilityToggle() {
  const [high, setHigh] = useState(false);
  const [ready, setReady] = useState(false);

  // Restore the persisted choice once, on mount.
  useEffect(() => {
    setHigh(legibilityPrefs.get() === true);
    setReady(true);
  }, []);

  // Stamp/remove the root attribute to match `high`, and ALWAYS remove it on unmount
  // (route leave) regardless of the last value — the leak this slice must not allow.
  useEffect(() => {
    if (!ready) return;
    if (high) {
      document.documentElement.setAttribute('data-tm-legibility', 'high');
    } else {
      document.documentElement.removeAttribute('data-tm-legibility');
    }
    return () => {
      document.documentElement.removeAttribute('data-tm-legibility');
    };
  }, [high, ready]);

  const toggle = () => {
    const next = !high;
    setHigh(next);
    legibilityPrefs.set(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={high}
      aria-label="High legibility"
      data-testid="travel-legibility-toggle"
      className={`inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none ${
        high
          ? 'bg-gold-400/20 text-gold-300 hover:bg-gold-400/25'
          : 'text-white/60 hover:bg-white/10 hover:text-white'
      }`}
    >
      <Sun className="h-4 w-4" aria-hidden="true" />
      <span className="hidden sm:inline">High legibility</span>
    </button>
  );
}
