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

  // Switch the active trip back to the default pack, then full-reload so this guide (and every
  // config-reading surface) re-hydrates with its content. Gateway is loaded LAZILY inside the
  // handler — same bundle discipline as the effect above; an eager gateway import measured
  // +5-7 kB across the four gated routes.
  const switchToDefault = () => {
    void import('@/core/storage/gateway').then((g) => {
      g.setActiveTripId(g.DEFAULT_TRIP_ID);
      window.location.reload();
    });
  };

  return (
    <div
      data-testid="default-trip-only-empty-state"
      className="mx-auto max-w-[1200px] px-4 py-16 text-center sm:px-6"
    >
      {/* NOT ON THIS TRIP is a true statement about a real section and it points forward:
          the two ways out are named right underneath it. Nothing here is captioned as
          absent, and the copy sits at --t-body, never at the micro floor. */}
      <p className="pr pr--lo mb-3">Section · Not on this trip</p>
      <p className="font-machine text-n-sm font-semibold uppercase tracking-[0.06em] text-[color:var(--text-hi)]">
        This page belongs to the Nepal × Japan trip
      </p>
      <p className="empty mt-2">Your current trip doesn&apos;t use this section.</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={switchToDefault}
          data-testid="default-trip-only-switch"
          className="pr inline-flex min-h-tap items-center rounded-r1 border border-[color:var(--accent)] px-4 text-[color:var(--accent)] outline-none transition-colors hover:bg-[rgb(62_216_255_/_0.10)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          Switch to the Nepal × Japan trip
        </button>
        <a
          href={withBasePath('/trips/')}
          data-testid="default-trip-only-trips-link"
          className="pr inline-flex min-h-tap items-center rounded-r1 border border-[color:var(--border-ui)] px-4 text-[color:var(--text-hi)] outline-none transition-colors hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          Manage trips
        </a>
      </div>
    </div>
  );
}
