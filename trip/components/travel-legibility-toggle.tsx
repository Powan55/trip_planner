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
 * (route leave), which is this change's main risk (a leaked attribute recoloring the rest of the
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
  // (route leave) regardless of the last value — the leak this change must not allow.
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
      className={`pr inline-flex min-h-tap min-w-tap shrink-0 items-center justify-center gap-1.5 rounded-r1 border-hair px-2 outline-none transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        high
          ? 'border-solid border-[color:hsl(var(--accent))] text-[color:hsl(var(--accent))]'
          : 'border-dashed border-[color:var(--text-lo)] text-ink-lo hover:bg-white/5 hover:text-ink-mid'
      }`}
    >
      <Sun className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="hidden sm:inline">{high ? 'Outdoor on' : 'Outdoor'}</span>
    </button>
  );
}
