'use client';

import { useEffect } from 'react';
import { runVisitAutocount } from '@/lib/visit-autocount';

/**
 * Issue #30 — the boot-once trigger for visit auto-counting. Renders null; all of the behaviour and
 * every guard lives in `lib/visit-autocount.ts`, which is where to read about it.
 *
 * Boot-once (empty deps), like `travel-mode-relaunch.tsx`: it runs on the initial mount of the
 * persistent provider tree, i.e. once per full page load, and never on a client-side navigation.
 * That is also the ceiling, stated rather than hidden — **a day that turns over while the app is
 * left open is not noticed until the next load.** Closing it would need a timer, and a timer to
 * watch a clock is the shape of thing this feature is explicitly not (see rule 2 in the lib
 * module). The next launch backfills every arrived day anyway, so the planned count loses nothing;
 * only the confirmation stamp waits.
 *
 * Nothing renders, so there is no accessibility or motion surface here. The one user-visible effect
 * is a browser permission prompt, and it appears only inside the trip window, at most once per trip
 * day, for a signed-in traveller — and refusing it changes nothing else about the app.
 */
export default function VisitAutocount() {
  useEffect(() => {
    runVisitAutocount();
    // Boot-once: intentionally no deps — this must run on the initial load only.
  }, []);

  return null;
}
