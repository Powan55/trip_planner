'use client';

import { useEffect, useState } from 'react';
import { getCountryForDate, TRIP_DATES } from '@/core/dates';
import { useOnline } from '@/hooks/use-online';

/**
 * — Travel Mode running head. The one piece of chrome on a chrome-free route: a scroller of
 * printed key/value fields, sticky under the safe-area inset, carrying the day, the leg and the
 * honest connection state. Instrumentation, not a warning banner — offline is the DESIGNED case
 * on this route, so `NET · OFFLINE` is a reading like any other and nothing here changes shape
 * for it. The state is carried by the WORD, never by colour alone.
 *
 * no last-sync TIMESTAMP is tracked anywhere to show a literal "synced HH:MM" — the
 * itinerary/expenses/budget/docs sync layer is fire-and-forget (flushOutbox + onSnapshot in
 * itinerary-provider), and nothing persists or exposes a `pushedAt`/`pulledAt` on the store. So
 * this shows honest CONNECTION state from the one existing signal (`useOnline()` — navigator.onLine
 * corroborated by real cross-origin traffic), never an invented time. Either way the plan is on
 * localStorage, so SAVED · THIS DEVICE holds regardless. Upgrade path: have itinerary-remote record
 * a `lastPushedAt`/`lastPulledAt` on a successful flush/snapshot, surface it through the itinerary
 * store, and add a `SYNC` field here — which is also where a `SYNC FAILED` field would live, once
 * there is a failure signal to read.
 *
 * The CACHED figure is a real `navigator.storage.estimate()` reading. It renders only once the
 * browser answers with a number, so a browser that reports nothing shows no field rather than a
 * made-up one.
 *
 * A `<dl>`: these are literally key/value pairs, and the description-list mapping gives assistive
 * tech the pairing for free, with no ARIA attribute and therefore no name-from-author question on
 * an element whose implicit role may not permit one. `tabIndex` is not decoration — the recipe
 * scrolls horizontally, and a scrollable region with no focusable child is unreachable by
 * keyboard.
 */
export default function TravelSyncLine({ date }: { date: string }) {
  const online = useOnline();
  const [cachedMb, setCachedMb] = useState<number | null>(null);

  // Read on each offline transition only: the figure is information while offline and noise while
  // online, and estimate() is comparatively expensive on some engines.
  useEffect(() => {
    if (online) return;
    let cancelled = false;
    navigator.storage
      ?.estimate?.()
      .then(({ usage }) => {
        if (!cancelled && typeof usage === 'number') setCachedMb(Math.max(1, Math.round(usage / 1e6)));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [online]);

  const country = getCountryForDate(date);
  const dayNumber = TRIP_DATES.indexOf(date) + 1;

  return (
    <dl
      data-testid="travel-sync-line"
      data-online={online ? 'true' : 'false'}
      tabIndex={0}
      className="head mx-auto mt-3 max-w-2xl top-[max(20px,env(safe-area-inset-top))]"
    >
      <div className="f">
        <dt className="k">Day</dt>
        <dd className="v">
          {dayNumber > 0 ? dayNumber : '—'}
          <span className="text-ink-lo"> / {TRIP_DATES.length}</span>
        </dd>
      </div>
      <div className="f f--now">
        <dt className="k">Leg</dt>
        <dd className="v capitalize">{country}</dd>
      </div>
      <div className="f">
        <dt className="k">Net</dt>
        <dd className="v">{online ? 'Online' : 'Offline'}</dd>
      </div>
      {!online && cachedMb !== null && (
        <div className="f">
          <dt className="k">Cached</dt>
          <dd className="v">{cachedMb} MB</dd>
        </div>
      )}
      <div className="f">
        <dt className="k">Saved</dt>
        <dd className="v">This device</dd>
      </div>
    </dl>
  );
}
