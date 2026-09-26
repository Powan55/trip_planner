'use client';

// components/service-worker-registrar.tsx
//
// Registers the hand-rolled service worker (emitted to out/sw.js by
// scripts/gen-sw.mjs) and drives the NO-silent-auto-refresh update flow:
// updatefound -> new worker reaches `installed` while a controller exists
// -> show a persistent sonner toast "New version available" + Refresh action
// -> on Refresh, postMessage SKIP_WAITING to the waiting worker
// -> the SW calls skipWaiting() -> `controllerchange` fires -> reload().
//
// Renders nothing.
//
// Gating: registration is production-only AND requires SW support.
// `next dev` (NODE_ENV !== 'production') NEVER registers — the export's
// contenthash chunks make dev serve stale hashes, so a SW in dev is a
// footgun. Verified by DoD item 9.
//
// basePath: the registrar does NOT re-implement prefixing — it imports
// the single-source helper `withBasePath` from '@/lib/utils' (no-op when
// basePath is empty, so it never double-prefixes) and registers
// withBasePath('/sw.js').

import { useEffect } from 'react';
import { toast } from 'sonner';
import { withBasePath } from '@/lib/utils';

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    let refreshing = false;

    // Whether this page was ALREADY controlled by a worker when we registered.
    // On a FIRST-EVER visit the page starts uncontrolled and the activate handler's
    // `clients.claim()` fires `controllerchange` with no prior controller — reloading
    // then is a spurious ~200ms post-load refresh that re-hydrates the whole tree and
    // wipes any in-flight form state (e.g. a token typed into the gate). Only an UPDATE
    // (page was already controlled → SKIP_WAITING handshake) warrants a reload.
    const hadController = !!navigator.serviceWorker.controller;

    // clients.claim() in the activate handler fires `controllerchange` in EVERY
    // open tab, not just the one whose user clicked Refresh (#531) — so only the
    // tab that actually requested the skip-waiting handshake may auto-reload.
    // Other tabs get the same toast instead, so an in-progress form isn't wiped.
    let clickedRefresh = false;

    // When the controlling worker changes (i.e. the new worker took over after
    // SKIP_WAITING), reload once onto the new version — but never on the first-install
    // claim (see `hadController`), and never in a tab that didn't click Refresh.
    const onControllerChange = () => {
      if (!hadController || refreshing) return;
      if (!clickedRefresh) {
        // No worker ref: the controller here is already the NEW (active) worker,
        // so passing it would re-post SKIP_WAITING to an already-active worker
        // (a no-op — no second controllerchange, no reload). Omitting it routes
        // the click through the `else if (controller)` fallback below instead.
        promptUpdate();
        return;
      }
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      onControllerChange
    );

    // Prompt the user (persistent toast) that a new worker is waiting. Clicking
    // Refresh triggers the skip-waiting handshake. `worker` is omitted for the
    // passive-tab toast (#531) — that tab has no waiting worker reference of its
    // own, so Refresh there just marks this tab as the reloader and waits for
    // the controllerchange already in flight from the tab that sent SKIP_WAITING.
    const promptUpdate = (worker?: ServiceWorker) => {
      toast('New version available', {
        id: 'sw-update-available',
        description: 'Refresh to get the latest offline app shell.',
        duration: Infinity,
        action: {
          label: 'Refresh',
          onClick: () => {
            clickedRefresh = true;
            if (worker) {
              worker.postMessage({ type: 'SKIP_WAITING' });
            } else if (navigator.serviceWorker.controller) {
              // Already controlled by the new worker (another tab completed the
              // handshake) — just reload onto it.
              window.location.reload();
            }
          },
        },
      });
    };

    navigator.serviceWorker
      .register(withBasePath('/sw.js'), { updateViaCache: 'none' })
      .then((registration) => {
        // A worker already waiting at register time (e.g. user reopened the tab
        // after an update installed in the background) — prompt immediately,
        // but only if there's an active controller (first install => no prompt).
        if (registration.waiting && navigator.serviceWorker.controller) {
          promptUpdate(registration.waiting);
        }

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            // A new worker reached `installed` while a controller already
            // exists => this is an UPDATE (not the very first install), so
            // prompt. First install has no controller yet => stay silent.
            if (
              installing.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              promptUpdate(installing);
            }
          });
        });
      })
      .catch(() => {
        // Registration failures are non-fatal — the app works online without
        // the SW; offline capability is a progressive enhancement.
      });

    return () => {
      navigator.serviceWorker.removeEventListener(
        'controllerchange',
        onControllerChange
      );
    };
  }, []);

  return null;
}
