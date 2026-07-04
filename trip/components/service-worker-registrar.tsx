'use client';

// Registers the hand-rolled service worker (emitted to out/sw.js by
// scripts/gen-sw.mjs) and drives the NO-silent-auto-refresh update flow:
//   updatefound -> new worker reaches `installed` while a controller exists
//   -> show a persistent sonner toast "New version available" + Refresh action
//   -> on Refresh, postMessage SKIP_WAITING to the waiting worker
//   -> the SW calls skipWaiting() -> `controllerchange` fires -> reload().
//
// Renders nothing.
//
// Gating: registration is production-only AND requires SW support.
//   `next dev` (NODE_ENV !== 'production') NEVER registers — the export's
//   contenthash chunks make dev serve stale hashes, so a SW in dev is a
//   footgun.
//
// basePath: the registrar does NOT re-implement prefixing — it imports the
// single-source helper `withBasePath` from '@/lib/utils' (no-op when basePath
// is empty, so it never double-prefixes) and registers withBasePath('/sw.js').

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

    // When the controlling worker changes (i.e. the new worker took over after
    // SKIP_WAITING), reload once onto the new version.
    const onControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      onControllerChange
    );

    // Prompt the user (persistent toast) that a new worker is waiting. Clicking
    // Refresh triggers the skip-waiting handshake.
    const promptUpdate = (worker: ServiceWorker) => {
      toast('New version available', {
        description: 'Refresh to get the latest offline app shell.',
        duration: Infinity,
        action: {
          label: 'Refresh',
          onClick: () => {
            worker.postMessage({ type: 'SKIP_WAITING' });
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
