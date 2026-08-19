// Next's built-in 404 ships its own document with `body{color:#000;background:#fff}`
// inlined — a white page on a dark-only app. Under `output:'export'` this file is also
// what GitHub Pages serves as 404.html for every unknown path, so it is the entire
// mistyped-URL experience. Modelled on `app/error.tsx`: same glass-card panel inside
// normal app chrome, no motion (nothing to neutralize under reduced-motion).
//
// A Server Component on purpose — unlike error.tsx there is no `reset` callback, and
// Button/lucide icons are hook-free, so this costs no client JS.

import { Home as HomeIcon, Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { withBasePath } from '@/lib/utils';

export default function NotFound() {
  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4 py-16">
      <div className="glass-card w-full max-w-md rounded-2xl p-8 text-center">
        <Compass className="mx-auto mb-4 h-8 w-8 text-ink-mid" aria-hidden="true" />
        {/* no weight class beside `font-display`: Instrument Serif ships 400 only,
            so `font-bold` here would be a browser-synthesised faux bold (G-2). */}
        <h1 className="font-display text-2xl text-white mb-3">
          This page doesn&apos;t exist
        </h1>
        <p className="text-sm text-ink-mid mb-6">
          The link may be mistyped or out of date. Nothing has been lost — your trip
          plans, itinerary, and settings are untouched.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button asChild variant="outline">
            <a href={withBasePath('/')}>
              <HomeIcon aria-hidden="true" />
              Home
            </a>
          </Button>
        </div>
      </div>
    </main>
  );
}
