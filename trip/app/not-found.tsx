// Next's built-in 404 ships its own document with `body{color:#000;background:#fff}`
// inlined — a white page on a dark-only app. Under `output:'export'` this file is also
// what GitHub Pages serves as 404.html for every unknown path, so it is the entire
// mistyped-URL experience. Modelled on `app/error.tsx`: same printed panel inside
// normal app chrome, no motion (nothing to neutralize under reduced-motion).
//
// A Server Component on purpose — unlike error.tsx there is no `reset` callback, and
// Button/lucide icons are hook-free, so this costs no client JS. It also touches no
// network, which is the requirement and not a side effect: 404 is the page most likely
// to be reached offline, off a stale bookmark against a precached shell.

import { Home as HomeIcon, Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { withBasePath } from '@/lib/utils';

export default function NotFound() {
  return (
    <main className="flex min-h-[70vh] items-center justify-center px-gutter py-16">
      <div className="w-full max-w-md border-2 border-[hsl(var(--border))] bg-[rgb(var(--surface-low))] rounded-r1 p-gut py-7">
        <div className="mb-3 flex items-center gap-2">
          <Compass className="h-4 w-4 shrink-0 text-[color:var(--text-lo)]" aria-hidden="true" />
          <p className="pr pr--lo">Route · Not on file</p>
        </div>
        <h1 className="text-n-sm font-machine font-semibold uppercase tracking-[0.06em] text-[color:var(--text-hi)] mb-3">
          This page doesn&apos;t exist
        </h1>
        <p className="empty mb-6">
          The link may be mistyped or out of date. Nothing has been lost — your trip
          plans, itinerary, and settings are untouched.
        </p>
        <Button asChild variant="default" className="w-full">
          <a href={withBasePath('/')}>
            <HomeIcon aria-hidden="true" />
            Home
          </a>
        </Button>
      </div>
    </main>
  );
}
