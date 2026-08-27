'use client';

// — Next.js NATIVE error boundary for the route segments below the root
// layout (D-none needed: this is a documented Next App Router file convention,
// not a custom class-based boundary). Next mounts this in place of the failed
// segment and calls it with `{ error, reset }`. Root layout (ThemeProvider,
// Navbar, etc.) is still mounted here — only `global-error.tsx` (see that file)
// covers a crash IN the root layout itself, which is why this file can stay a
// plain glass-card panel inside normal app chrome instead of its own <html>.
//
// Deliberately no framer-motion / reveal animation: a crash screen has nothing
// to prove by moving, and skipping motion entirely is the simplest way to be
// reduced-motion-safe (nothing to neutralize).
//
// Distinct from `components/chunk-load-error-handler.tsx` (untouched): that
// listens for `window.onerror` ChunkLoadErrors and silently reloads once; this
// catches actual React render crashes and asks the person, with a calm message
// and two ways out (Try again / Home).

import { RefreshCw, Home as HomeIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { withBasePath } from '@/lib/utils';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-gutter py-16">
      {/* Printed stock, not glass: a 2px rule and a stated condition. The failure is
          carried by the WORDS on the annunciator line, never by colour alone, and the
          `.err` tier is spent on that one line rather than on the whole panel. */}
      <div
        role="alert"
        className="w-full max-w-md border-2 border-[hsl(var(--border))] bg-[rgb(var(--surface-low))] rounded-r1 p-gut py-7"
      >
        <p className="pr err mb-3">Render · Failed</p>
        <h1 className="text-n-sm font-machine font-semibold uppercase tracking-[0.06em] text-[color:var(--text-hi)] mb-3">
          Something went wrong
        </h1>
        <p className="empty mb-3">
          This page hit a snag and couldn&apos;t render. It&apos;s a display glitch, not
          data loss — your trip plans, itinerary, and settings are safe in this
          device&apos;s local storage.
        </p>
        {error?.message && (
          <p className="font-machine text-t-sm text-[color:var(--text-lo)] mb-6 break-words border-t border-hair border-[hsl(var(--border))] pt-3">
            {error.message}
          </p>
        )}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button onClick={() => reset()} variant="default" className="flex-1">
            <RefreshCw aria-hidden="true" />
            Try again
          </Button>
          <Button asChild variant="outline" className="flex-1">
            <a href={withBasePath('/')}>
              <HomeIcon aria-hidden="true" />
              Home
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}
