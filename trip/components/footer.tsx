'use client';

import { Fragment } from 'react';
import { MapPin } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { TRIP_DATE_LABEL } from '@/lib/trip-data';
import { isTravelRoute } from '@/lib/travel-route';
import { getActiveTrip } from '@/core/trips';

/**
 * The wordmark's JSX — DEFAULT trip renders "Nepal × Japan Journey" (byte-identical to the
 * old literal), a custom trip its own leg labels (#596). Exported so the unit test renders
 * the exact same markup the footer does, not a parallel string-only copy of it.
 */
export function FooterWordmark({ legs }: { legs: { countryLabel: string }[] }) {
  const labels = legs.map((leg) => leg.countryLabel);
  return (
    <>
      {labels.map((label, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="text-[color:var(--text-lo)]"> × </span>}
          {label}
        </Fragment>
      ))}{' '}
      Journey
    </>
  );
}

export default function Footer() {
  // chrome-free Travel Mode — the app footer renders null under `/travel`.
  const pathname = usePathname();
  if (isTravelRoute(pathname)) return null;

  return (
    // The colophon: the imprint line at the foot of a printed form. A 2px rule across the
    // top, then three printed fields. The old soft accent-gradient hairline is gone — an
    // --accent RULE is unlimited, but a glow is not a rule, and a printed sheet does not
    // fade its own edge out at the margins.
    <footer className="relative px-gutter py-12 border-t-2 border-[hsl(var(--border))]">
      <div className="mx-auto flex max-w-[1200px] flex-col items-center gap-3 text-center">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 shrink-0 text-[color:var(--text-lo)]" aria-hidden="true" />
          <span className="font-machine text-t-label font-semibold uppercase tracking-[0.13em] text-[color:var(--text-hi)]">
            <FooterWordmark legs={getActiveTrip().legs} />
          </span>
        </div>
        <p className="pr pr--lo tabular-nums">{TRIP_DATE_LABEL}</p>
        {/* The copyright/version note qualifies the wordmark above rather than being the
            footer's subject, so it sits a tier down. */}
        <p className="pr pr--lo tabular-nums">
          &copy; {new Date().getFullYear()} Lax
          {' '}&middot;{' '}
          v{process.env.NEXT_PUBLIC_APP_VERSION}
        </p>
      </div>
    </footer>
  );
}
