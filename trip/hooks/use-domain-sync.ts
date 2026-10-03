'use client';

import { useEffect } from 'react';
import type { StoragePort, SyncPort } from '@/core/ports';
import { flushOutbox, outboxRetryable, SYNC_OUTBOX_CHANGED_EVENT, type ChunkSync } from '@/core/sync/outbox';
import { getActiveTraveler, IDENTITY_CHANGED_EVENT } from '@/lib/token-auth';

// #748 retry backoff: 10s doubling to a 5 min cap, then hand back to the online/visible/edit
// triggers. The cap matters: each attempt is a Firestore write against a free-tier budget. The
// base sits above the 8s remote write timeout so a timed flush never joins a slow commit push,
// which would make it write twice.
export const RETRY_BASE_MS = 10_000;
export const RETRY_MAX_MS = 5 * 60_000;
export const RETRY_MAX_ATTEMPTS = 6;

const flushers = new Set<() => Promise<void>>();

/** Flush every mounted domain's outbox. Sign-out awaits this before wiping local data (#748). */
export function flushAllDomains(): Promise<void> {
  return Promise.all([...flushers].map((f) => f())).then(() => {});
}

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

    const gated = () => syncPort.isConfigured() && !!getActiveTraveler();

    // One retry timer per domain. Armed by any outbox change while this domain still has a
    // retryable chunk (a failed commit push leaves no further event, so the enqueue arms it), and
    // re-armed after each timed flush that left the chunk dirty.
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    // A flush still in flight at unmount resolves into armRetry; without this it arms a timer
    // nothing will ever clear.
    let disposed = false;
    const resetRetry = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      attempts = 0;
    };
    const armRetry = () => {
      if (disposed) return;
      if (!gated() || !outboxRetryable(outboxSync.domain)) return resetRetry();
      if (timer || attempts >= RETRY_MAX_ATTEMPTS || navigator.onLine === false) return;
      const delay = Math.min(RETRY_BASE_MS * 2 ** attempts, RETRY_MAX_MS);
      attempts += 1;
      timer = setTimeout(() => {
        timer = null;
        void flushOutbox(outboxSync, storagePort).then(armRetry);
      }, delay);
    };

    const flush = () => {
      resetRetry();
      void flushOutbox(outboxSync, storagePort).then(armRetry);
    };
    const flushNow = () => flushOutbox(outboxSync, storagePort);
    flushers.add(flushNow);
    window.addEventListener(SYNC_OUTBOX_CHANGED_EVENT, armRetry);

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
      resetRetry();
      teardown();
      activate();
    };
    window.addEventListener(IDENTITY_CHANGED_EVENT, onIdentityChanged);

    return () => {
      disposed = true;
      resetRetry();
      flushers.delete(flushNow);
      window.removeEventListener(SYNC_OUTBOX_CHANGED_EVENT, armRetry);
      window.removeEventListener(IDENTITY_CHANGED_EVENT, onIdentityChanged);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ports are module-scope singletons, mount-once by design like the five effects this replaces
  }, []);
}
