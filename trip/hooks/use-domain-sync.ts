'use client';

import { useEffect } from 'react';
import type { StoragePort, SyncPort } from '@/core/ports';
import { flushOutbox, type ChunkSync } from '@/core/sync/outbox';
import { getActiveTraveler, IDENTITY_CHANGED_EVENT } from '@/lib/token-auth';

/**
 * useDomainSync — the ONE app-root wiring effect for a synced domain's flush-then-subscribe
 * lifecycle (D-378). Extracted from `components/itinerary-provider.tsx`, where it was
 * copy-pasted five times (itinerary/expenses/budget/docs/places) with only the port triple
 * differing. Behavior is byte-identical to those five effects:
 * flush the outbox, then open the subscribe; both on mount and reactively on
 * `IDENTITY_CHANGED_EVENT` (D-240 — sign-out fires it without a reload, so this must
 * teardown/re-activate, never mount-once); `online`/tab-return flush and reopen a dead subscribe.
 *
 * The outer gate is `syncPort.isConfigured()`, not a hardcoded `isRemoteConfigured()` — every
 * `SyncPort` already surfaces its own dormant/config gate (`core/ports.ts`), and places'
 * is `isTripRemoteConfigured()` (a per-trip domain), stricter than the other four's
 * `isRemoteConfigured()`. Routing through the port is what keeps this one hook correct for
 * all five without a per-domain special case.
 */
export function useDomainSync<T>(
  outboxSync: ChunkSync<T>,
  storagePort: StoragePort<T>,
  syncPort: SyncPort<T>,
): void {
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    const teardown = () => {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    };

    const flush = () => {
      void flushOutbox(outboxSync, storagePort);
    };

    const gated = () => syncPort.isConfigured() && !!getActiveTraveler();

    // Only a dead subscribe is reopened; reopening a healthy one re-reads every doc (D-591).
    const open = () => {
      if (unsubscribe) return;
      let mine: (() => void) | null = null;
      mine = syncPort.subscribe(() => {
        if (unsubscribe === mine) unsubscribe = null;
      });
      unsubscribe = mine;
    };

    const activate = () => {
      if (!gated() || unsubscribe) return;
      flush(); // ① flush the outbox before ② opening the subscribe (push-before-subscribe)
      open();
    };

    const onOnline = () => {
      if (!gated()) return;
      flush();
      open();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') onOnline();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);

    activate();

    const onIdentityChanged = () => {
      teardown();
      activate();
    };
    window.addEventListener(IDENTITY_CHANGED_EVENT, onIdentityChanged);

    return () => {
      window.removeEventListener(IDENTITY_CHANGED_EVENT, onIdentityChanged);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ports are module-scope singletons, mount-once by design like the five effects this replaces
  }, []);
}
