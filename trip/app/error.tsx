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
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-16">
      <div
        role="alert"
        className="glass-card w-full max-w-md rounded-2xl p-8 text-center"
      >
        <h1 className="font-display text-2xl font-bold text-white mb-3">
          Something went wrong
        </h1>
        <p className="text-sm text-white/70 mb-2">
          This page hit a snag and couldn&apos;t render. It&apos;s a display glitch, not
          data loss — your trip plans, itinerary, and settings are safe in this
          device&apos;s local storage.
        </p>
        {error?.message && (
          <p className="text-xs text-white/40 mb-6 break-words">{error.message}</p>
        )}
        <div className="flex flex-wrap items-center justify-center gap-3 mt-2">
          <Button onClick={() => reset()} variant="default">
            <RefreshCw aria-hidden="true" />
            Try again
          </Button>
          <Button asChild variant="outline">
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
