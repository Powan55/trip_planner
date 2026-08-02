'use client';

// components/storage-persistence.tsx
//
// Three independent, low-noise storage-reliability surfaces, each gated purely on
// FEATURE-detection (no NODE_ENV gate, unlike the SW registrar — storage APIs are safe to run
// in `next dev` too; the registrar's production-only gate exists for a different reason, its
// own stale-hash-in-dev footgun, which doesn't apply here):
//
// 1. PERSIST: `navigator.storage.persist()` after the first user gesture (some engines
// require one — a one-shot pointerdown/keydown listener that self-removes). Quiet no-op on
// unsupported/denied/error — no toast, nothing written (persisted() IS the durable signal;
// there's nothing to remember locally).
// 2. NEAR-QUOTA WARNING: `navigator.storage.estimate()` checked once on mount; above
// threshold, ONE sonner toast pointing at the /plan Backup & Restore export. At most once
// per page session (a module-level flag, not sessionStorage — it only needs to survive one
// check per mount, and a fresh module instance already resets it every real page load, so
// this doesn't need to go through the gateway/ raw-storage rule). This is the
// PROACTIVE complement to reactive write-failure toast — deliberately not built here.
// 3. INSTALL-TO-HOME HINT: a single, dismissable, once-EVER sonner toast (persisted dismissal
// via the gateway's `installHintStore`, key 30) shown when the app is not already running
// standalone. Static hint only — no `beforeinstallprompt` capture/native-prompt flow (YAGNI).
// 4. REACTIVE WRITE-FAILURE TOAST: listens for the gateway's `trip:quota-exceeded`
// `window` `CustomEvent`, fired (defensively, never-throw) from `core/storage/gateway.ts`'s
// `writeString` and the itinerary Vault's `saveItinerary` when a write is rejected because
// storage is actually full. This is the REACTIVE complement to #2's PROACTIVE `estimate()`
// warning — #2 warns near the quota BEFORE a write fails; this fires AFTER one already has.
// At most one toast per page session (same module-level-flag discipline as #2).
//
// Follows components/service-worker-registrar.tsx's island shape: 'use client', run-once
// useEffect, renders null, uses sonner's `toast`.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { installHintStore } from '@/core/storage/gateway';

// 0.9 (90% of the StorageManager quota) is a heuristic threshold, not measured
// against any real device's actual eviction point — it exists to leave headroom for one more
// journal/expense/photo write before the browser starts throwing or evicting. Tune this constant
// if real-world quota reports come in tighter or looser than expected; no other change needed.
const QUOTA_WARN_THRESHOLD = 0.9;

// Per-page-load guard for the quota toast. Deliberately a module-level flag, not sessionStorage:
// it only needs to survive one estimate() check per mount, and a fresh module instance already
// resets it on every real navigation/reload — no need to route it through the gateway.
let quotaWarnedThisLoad = false;

// Per-page-load guard for the REACTIVE write-failure toast. Same shape/rationale as
// `quotaWarnedThisLoad` above — a throttle so a burst of rejected writes (e.g. several
// keystrokes each triggering a save) shows at most ONE toast per session, not one per failure.
let quotaExceededToastedThisLoad = false;

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const displayModeStandalone =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;
  // iOS Safari's non-standard flag — no display-mode media query support there.
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return !!displayModeStandalone || iosStandalone;
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function StoragePersistence() {
  const router = useRouter();

  useEffect(() => {
    // ── 1. Persist on first user interaction ─────────────────────────────
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      const requestPersist = () => {
        navigator.storage
          .persisted()
          .then((already) => (already ? undefined : navigator.storage.persist()))
          .catch(() => {
            /* quiet no-op — persist is best-effort */
          });
      };
      const onFirstInteraction = () => {
        requestPersist();
        window.removeEventListener('pointerdown', onFirstInteraction);
        window.removeEventListener('keydown', onFirstInteraction);
      };
      window.addEventListener('pointerdown', onFirstInteraction, { once: true });
      window.addEventListener('keydown', onFirstInteraction, { once: true });
    }

    // ── 2. Near-quota warning ──
    if (!quotaWarnedThisLoad && typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      navigator.storage
        .estimate()
        .then(({ usage, quota }) => {
          if (!usage || !quota || quota <= 0) return;
          if (usage / quota >= QUOTA_WARN_THRESHOLD) {
            quotaWarnedThisLoad = true;
            toast('Your device storage is nearly full', {
              description:
                'Back up your trip from the Plan page so your itinerary, journal, and photos stay safe.',
              duration: 10000,
              action: {
                label: 'Back up now',
                onClick: () => router.push('/plan'),
              },
            });
          }
        })
        .catch(() => {
          /* quiet no-op — estimate is best-effort */
        });
    }

    // ── 3. Install-to-Home education (once ever, dismissable) ────────────
    if (!isStandalone() && !installHintStore.hasBeenDismissed()) {
      const description = isIOS()
        ? 'Tap Share, then "Add to Home Screen" — installed apps are protected from Safari clearing their data.'
        : "Install this app to your Home Screen so your trip data can't be cleared.";
      const id = toast('Install this app to your Home Screen', {
        description,
        duration: Infinity,
        action: {
          label: 'Got it',
          onClick: () => {
            installHintStore.markDismissed();
            toast.dismiss(id);
          },
        },
        onDismiss: () => installHintStore.markDismissed(),
      });
    }

    // ── 4. Reactive write-failure toast (; complements #2's proactive estimate() warning) ──
    const onQuotaExceeded = () => {
      if (quotaExceededToastedThisLoad) return;
      quotaExceededToastedThisLoad = true;
      toast("Couldn't save — device storage is full", {
        description: 'Export your trip and free up space.',
        duration: 10000,
        action: {
          label: 'Export now',
          onClick: () => router.push('/plan'),
        },
      });
    };
    window.addEventListener('trip:quota-exceeded', onQuotaExceeded);

    return () => {
      window.removeEventListener('trip:quota-exceeded', onQuotaExceeded);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
