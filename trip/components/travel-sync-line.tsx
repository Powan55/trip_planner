'use client';

import { Wifi, WifiOff } from 'lucide-react';
import { useOnline } from '@/hooks/use-online';

/**
 * — Travel Mode connection line. A visible, honest "are my changes safe" indicator on the
 * during-trip screen (this screen gets used on dead connections).
 *
 * no last-sync TIMESTAMP is tracked anywhere to show a literal "synced HH:MM" — the
 * itinerary/expenses/budget/docs sync layer is fire-and-forget (flushOutbox + onSnapshot in
 * itinerary-provider), and nothing persists or exposes a `pushedAt`/`pulledAt` on the store. So
 * this shows honest CONNECTION state from the one existing signal (`useOnline()` ← navigator.onLine),
 * never an invented time. Either way the plan is on localStorage, so "saved on this device" holds.
 * Upgrade path: have itinerary-remote record a `lastPushedAt`/`lastPulledAt` on a successful flush/
 * snapshot, surface it through the itinerary store, and render "Synced HH:MM" here.
 */
export default function TravelSyncLine() {
  const online = useOnline();

  return (
    <p
      data-testid="travel-sync-line"
      data-online={online ? 'true' : 'false'}
      className="mx-auto mt-2 flex max-w-2xl items-center gap-1.5 px-1 text-xs text-ink-mid"
    >
      {online ? (
        <Wifi className="h-3.5 w-3.5 shrink-0 text-emerald-400/70" aria-hidden="true" />
      ) : (
        <WifiOff className="h-3.5 w-3.5 shrink-0 text-amber-400/80" aria-hidden="true" />
      )}
      <span>{online ? 'Online' : 'Offline'} &middot; changes saved on this device</span>
    </p>
  );
}
