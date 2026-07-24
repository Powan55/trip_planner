'use client';

import { useEffect, useState, type ReactNode } from 'react';
// Inlined from lib/utils' withBasePath — importing that barrel eagerly drags
// clsx/tailwind-merge into the four gated routes' First Load (same bundle
// discipline as the lazy gateway import below). NEXT_PUBLIC_* is build-inlined.
const withBasePath = (path: string) =>
  `${process.env.NEXT_PUBLIC_BASE_PATH || ''}${path}`;

/**
 * DefaultTripOnly — gates an N×J-specific section island (Nepal, Japan,
 * Flights, Home's Travel Essentials) behind the active trip: renders `children` on the
 * default pack, else a small honest empty-state card ("This page belongs to the Nepal ×
 * Japan trip" + links out). No redirect.
 *
 * Bundle discipline: this component is statically imported by four routes,
 * so it must stay out of their First Load JS growth — the gateway is loaded LAZILY inside
 * the effect (an eager `@/core/trips` or gateway import measured +5-7 kB across the four
 * routes), and the links are plain `<a>` (an eager `next/link` measured ~+4 kB on Home,
 * which never loads it eagerly; a full page load on a rare empty-state path is fine).
 *
 * Pre-mount / while the chunk loads, render `children` — matching what SSR produced
 * (SSR always resolves the default pack), so there is no hydration mismatch; the same
 * post-mount storage-read pattern as `home-trip-strip.tsx`.
 */
export default function DefaultTripOnly({ children }: { children: ReactNode }) {
  // null = not yet resolved (pre-mount / chunk in flight) — render children, matching SSR.
  const [isDefault, setIsDefault] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    import('@/core/storage/gateway').then((g) => {
      if (alive) setIsDefault(g.getActiveTripId() === g.DEFAULT_TRIP_ID);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (isDefault !== false) return <>{children}</>;

  return (
    <div
      data-testid="default-trip-only-empty-state"
      className="mx-auto max-w-[1200px] px-4 py-16 text-center sm:px-6"
    >
      <p className="font-display text-lg font-semibold text-white">
        This page belongs to the Nepal × Japan trip
      </p>
      <p className="mt-2 text-sm text-white/60">
        Your current trip doesn&apos;t use this section.
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <a
          href={withBasePath('/plan/')}
          data-testid="default-trip-only-plan-link"
          className="inline-flex min-h-[44px] items-center rounded-lg border border-gold-400/40 px-4 text-sm font-medium text-gold-300 outline-none transition-colors hover:bg-gold-400/10 focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
        >
          Go to Plan
        </a>
        <a
          href={withBasePath('/trips/')}
          data-testid="default-trip-only-trips-link"
          className="inline-flex min-h-[44px] items-center rounded-lg border border-white/15 px-4 text-sm font-medium text-white/80 outline-none transition-colors hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
        >
          Manage trips
        </a>
      </div>
    </div>
  );
}
