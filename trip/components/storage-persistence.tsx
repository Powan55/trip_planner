'use client';

// components/storage-persistence.tsx
//
// Five independent, low-noise storage-reliability surfaces, each gated purely on
// FEATURE-detection (no NODE_ENV gate, unlike the SW registrar — storage APIs are safe to run
// in `next dev` too; the registrar's production-only gate exists for a different reason, its
// own stale-hash-in-dev footgun, which doesn't apply here):
//
// 1. PERSIST: `navigator.storage.persist()` after the first user gesture (some engines
// require one — a one-shot pointerdown/keydown listener that self-removes). Quiet no-op on
// unsupported/denied/error — no toast, nothing written (persisted() IS the durable signal;
// there's nothing to remember locally).
// 2. NEAR-QUOTA WARNING: `navigator.storage.estimate()` checked once on mount; above
// threshold, ONE sonner toast pointing at the Settings → Data Backup & Restore export (it lived
// on /plan until BackupRestore moved; /plan has had no export control since). At most once
// per page session (a module-level flag, not sessionStorage — it only needs to survive one
// check per mount, and a fresh module instance already resets it every real page load, so
// this doesn't need to go through the gateway/ raw-storage rule). This is the
// PROACTIVE complement to reactive write-failure toast — deliberately not built here.
// 3. INSTALL-TO-HOME HINT: a single, dismissable, once-EVER sonner toast (persisted dismissal
// via the gateway's `installHintStore`, key 30) shown when the app is not already running
// standalone AND a traveler is signed in. Static hint only — no `beforeinstallprompt`
// capture/native-prompt flow (YAGNI).
// 4. REACTIVE WRITE-FAILURE TOAST: listens for the gateway's `trip:quota-exceeded`
// `window` `CustomEvent`, fired (defensively, never-throw) from `core/storage/gateway.ts`'s
// `writeString` and the itinerary Vault's `saveItinerary` when a write is rejected because
// storage is actually full. This is the REACTIVE complement to #2's PROACTIVE `estimate()`
// warning — #2 warns near the quota BEFORE a write fails; this fires AFTER one already has.
// At most one toast per page session (same module-level-flag discipline as #2).
// 5. BACKUP NUDGE ON LEG CHANGE (issue #222): a dismissable sonner toast suggesting a manual
// backup export, fired once per trip leg the traveller moves into (Nepal → Japan). There is no
// discrete "leg changed" event anywhere in the app, so this polls `getTodayInTrip()?.country`
// on an interval and compares it against the previously-seen leg in a ref — same edge-detection
// shape as hero-section.tsx's arrival-celebration `hadArrivedRef` (a `undefined` baseline seeds
// quietly on first read, so a page that loads mid-leg never nudges; only an OBSERVED change
// while mounted does). A custom trip has exactly one leg ('main'), so it never "changes" and this
// branch alone can never fire there (#330) — the day number advancing is the stand-in signal for
// that case, deduped by PRESENCE (fire once for the whole trip) rather than equality, since every
// day is a new value. The gateway's `backupPromptStore` (key 42; TRIP-SCOPED via `keyFor`, #330 —
// a stored leg id is only meaningful relative to the trip it came from) makes the "already nudged"
// dedup survive a reload, not just this mount. Reminder only — no upload, no auto export; the
// toast action just routes to Settings → Data, same as the quota toasts above.
//
// Follows components/service-worker-registrar.tsx's island shape: 'use client', run-once
// useEffect, renders null, uses sonner's `toast`.

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { installHintStore, backupPromptStore } from '@/core/storage/gateway';
import { getActiveTraveler } from '@/lib/token-auth';
import { getTodayInTrip } from '@/lib/trip-now';
import { legLabel } from '@/lib/leg-label';
import { getActiveTrip } from '@/core/trips';
// 0.9 (90% of the StorageManager quota) is a heuristic threshold, not measured against any real
// device's actual eviction point — it exists to leave headroom for one more journal/expense/photo
// write before the browser starts throwing or evicting. #20 MOVED it to `lib/preflight.ts`, whose
// night-before "Storage room" row reads the same `estimate()` and must call "nearly full" at the
// same point this toast does; tune it there and both surfaces move together.
// From lib/storage-quota.ts, NOT lib/preflight.ts — this component is mounted in app/layout.tsx,
// and importing the constant from preflight put that module's `maplibregl` marker into the root
// layout's chunk. See the header of lib/storage-quota.ts; e2e/pwa.spec.ts:651 is the proof.
import { QUOTA_WARN_THRESHOLD } from '@/lib/storage-quota';

// Per-page-load guard for the quota toast. Deliberately a module-level flag, not sessionStorage:
// it only needs to survive one estimate() check per mount, and a fresh module instance already
// resets it on every real navigation/reload — no need to route it through the gateway.
let quotaWarnedThisLoad = false;

// Per-page-load guard for the REACTIVE write-failure toast. Same shape/rationale as
// `quotaWarnedThisLoad` above — a throttle so a burst of rejected writes (e.g. several
// keystrokes each triggering a save) shows at most ONE toast per session, not one per failure.
let quotaExceededToastedThisLoad = false;

// Poll cadence for the leg-change backup nudge (#5 below). A leg changes at most once a day, so
// this is a plain low-frequency poll rather than hero-section's 1s countdown tick.
const LEG_CHECK_INTERVAL_MS = 60_000;

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
  // `undefined` = not yet seeded this mount (so a page loading mid-leg never nudges); `null` =
  // seeded, but currently outside the trip window. Mirrors hero-section.tsx's `hadArrivedRef`.
  const seenLegRef = useRef<string | null | undefined>(undefined);
  // Same seed/observed-change shape, tracking the day number instead — the single-leg (custom
  // trip) change-detection fallback (#330, see below).
  const seenDayRef = useRef<number | undefined>(undefined);

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
                'Back up your trip from Settings → Data so your itinerary, journal, and photos stay safe.',
              duration: 10000,
              action: {
                label: 'Back up now',
                // `/settings/`, not `/plan`: BackupRestore moved out of app/plan into the Settings
                // Data group, so these two toasts — the app's ONLY recovery affordance when
                // storage is full — were landing the user on a page with nothing to press.
                onClick: () => router.push('/settings/'),
              },
            });
          }
        })
        .catch(() => {
          /* quiet no-op — estimate is best-effort */
        });
    }

    // ── 3. Install-to-Home education (once ever, dismissable) ────────────
    // Signed-in only. The Toaster is position:fixed, so this `duration: Infinity` toast is the
    // one piece of chrome that does NOT clear on scroll — parked over the front door at 375x667
    // it covered all three of TokenGate's CTAs (#352). "Install so your trip data can't be
    // cleared" has nothing to say to a visitor with no trip data anyway. `!!getActiveTraveler()`
    // is the same "gate passed" read first-run-tour.tsx uses; every sign-in path ends in a full
    // reload, so a traveler who signs in still gets the hint on the very next mount.
    if (getActiveTraveler() && !isStandalone() && !installHintStore.hasBeenDismissed()) {
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
        // Swipe-away only — the explicit "Got it" button above is the sole once-ever-dismissal
        // path. onDismiss also fires on a swipe gesture, which must NOT be treated as consent
        // (#249): a swipe just closes this toast; the hint can still show on a later visit.
      });
    }

    // ── 4. Reactive write-failure toast (; complements #2's proactive estimate() warning) ──
    const onQuotaExceeded = () => {
      if (quotaExceededToastedThisLoad) return;
      quotaExceededToastedThisLoad = true;
      toast("Couldn't save — device storage is full", {
        description: 'Export your trip from Settings → Data and free up space.',
        duration: 10000,
        action: {
          label: 'Export now',
          onClick: () => router.push('/settings/'),
        },
      });
    };
    window.addEventListener('trip:quota-exceeded', onQuotaExceeded);

    // ── 5. Backup nudge on leg change (once per leg, #222) ──
    const fireBackupNudge = (promptedValue: string, message: string) => {
      backupPromptStore.setPromptedLeg(promptedValue);
      toast(message, {
        description: 'Back up your trip so far — photos, journal, and plans live only on this device.',
        duration: 10000,
        action: {
          label: 'Back up now',
          onClick: () => router.push('/settings/'),
        },
      });
    };
    const checkLegChange = () => {
      const today = getTodayInTrip();
      const leg = today?.country ?? null;
      const prevLeg = seenLegRef.current;
      seenLegRef.current = leg;
      if (leg === null) return; // off-trip

      // A custom trip has exactly one leg ('main'), so it never changes and the leg-compare
      // below can never fire for it (#330) — the day number advancing while mounted is the
      // "something worth backing up" stand-in there. Dedup is a PRESENCE check (fire once for
      // the whole trip, not once per day) rather than an equality check, since every day is a
      // new value.
      if (getActiveTrip().legs.length === 1) {
        const day = today!.dayNumber;
        const prevDay = seenDayRef.current;
        seenDayRef.current = day;
        if (prevDay === undefined || day === prevDay) return; // seed-only / unchanged
        if (backupPromptStore.getPromptedLeg() !== null) return; // already nudged once for this trip
        fireBackupNudge(leg, `Day ${day} of your trip`);
        return;
      }

      if (prevLeg === undefined || leg === prevLeg) return; // seed-only / unchanged
      if (backupPromptStore.getPromptedLeg() === leg) return; // already nudged for this leg (incl. across a reload)
      fireBackupNudge(leg, `Now in ${legLabel(leg)}`);
    };
    checkLegChange();
    const legTimer = setInterval(checkLegChange, LEG_CHECK_INTERVAL_MS);

    return () => {
      window.removeEventListener('trip:quota-exceeded', onQuotaExceeded);
      clearInterval(legTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
