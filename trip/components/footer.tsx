'use client';

import { MapPin } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { TRIP_DATE_LABEL } from '@/lib/trip-data';
import { isTravelRoute } from '@/lib/travel-route';

export default function Footer() {
  // chrome-free Travel Mode — the app footer renders null under `/travel`.
  const pathname = usePathname();
  if (isTravelRoute(pathname)) return null;

  return (
    // v2 cosmetic restyle: the footer becomes a quiet closing panel on the
    // aurora field — a luminous route-accent hairline across the top, richer
    // spacing rhythm, and legibility-tuned muted type. Content/logic unchanged.
    <footer className="relative py-18 px-gutter border-t border-white/[0.06]">
      {/* Route-accent hairline: a soft gradient rule keyed to --accent-scroll so
          the footer warms/cools with the page. Decorative, adds no layout box. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background:
            'linear-gradient(90deg, transparent 0%, hsl(var(--accent-scroll) / 0.6) 50%, transparent 100%)',
        }}
      />
      <div className="max-w-[1200px] mx-auto text-center">
        <div className="flex items-center justify-center gap-2 mb-4">
          <MapPin className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
          <span className="font-display font-bold tracking-tight text-white">Nepal <span className="text-muted-foreground">×</span> Japan Journey</span>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          {TRIP_DATE_LABEL}
        </p>
        {/* The copyright/version note qualifies the wordmark above rather than
            being the footer's subject, so it takes ink-mid (#27) — still clearly
            quieter than the white wordmark, and AA on the navy field by token. */}
        <p className="text-xs text-ink-mid">
          &copy; {new Date().getFullYear()} Lax
          {' '}&middot;{' '}
          v{process.env.NEXT_PUBLIC_APP_VERSION}
        </p>
      </div>
    </footer>
  );
}
