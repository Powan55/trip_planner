'use client';

import { MapPin, Heart } from 'lucide-react';
import { TRIP_DATE_LABEL } from '@/lib/trip-data';

export default function Footer() {
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
          <MapPin className="w-4 h-4 text-gold-400" />
          <span className="font-display font-bold tracking-tight text-white">Nepal <span className="text-gold-400">×</span> Japan Journey</span>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          {TRIP_DATE_LABEL}
        </p>
        {/* Muted footer type brightened to meet WCAG AA on the navy field
            (#0a0e27). `/40`→`/55` (3.77:1 → 6.22:1) and the quieter copyright
            `/30`→`/50` (2.63:1 → 5.32:1). Both stay clearly muted vs. the white
            wordmark above, preserving the glassmorphism hierarchy. */}
        <div className="flex items-center justify-center gap-1.5 text-xs text-white/55">
          <span>Made with</span>
          <Heart className="w-3 h-3 text-red-400 fill-red-400" />
          <span>for the journey ahead</span>
        </div>
        <p className="mt-4 text-xs text-white/50">
          &copy; {new Date().getFullYear()} Lax
          {' '}&middot;{' '}
          v{process.env.NEXT_PUBLIC_APP_VERSION}
        </p>
      </div>
    </footer>
  );
}
