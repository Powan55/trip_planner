'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Link2, Users } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { setDefaultTripShareId } from '@/core/storage/gateway';
import { getActiveTraveler } from '@/lib/token-auth';
import { withBasePath } from '@/lib/base-path';

/**
 * D-542 — turn the built-in Nepal × Japan pack into a SHARED trip, without moving a single byte of
 * the traveler's data.
 *
 * WHY THIS IS NOT "create a trip and copy the data across". That was the obvious route and it is
 * the wrong one, twice over:
 *
 * 1. It loses the plan. `keyFor` namespaces on the PACK id, so the moment `joinTrip(newId)` moves
 * the pointer, `trip:{newId}:itinerary` is absent, `loadPlans()` falls to the custom-trip vault
 * fallback — `buildDayShells`, one BLANK day per date (`core/vault/storage.ts`) — and the real
 * itinerary is stranded at the legacy `nepal_japan_itinerary` key with no UI that can reach it.
 * 2. Even with a perfect copy it degrades the trip. A custom trip is SINGLE-leg with
 * `utcOffsetMin: 0` and `contentRef: 'empty'` (`core/trips/custom.ts`), so NPT +345 / JST +540
 * become "no geography" — `tripOffsetMinFor` returns `null` and every instant-derived surface
 * (the countdown, what's-next, preflight's clock check) silently re-anchors on the DEVICE's
 * offset — and all Nepal/Japan guide, nightlife and photography content disappears.
 *
 * So the pack stays exactly what it is and only gains a remote path: `getDefaultTripShareId()`
 * feeds `getTripId()`, `isTripRemoteConfigured()` flips true, and the ALREADY-EXISTING first-
 * snapshot seed branch in `lib/itinerary-remote.ts` uploads the local plan verbatim. Storage keys,
 * leg offsets, guide content and the on-disk bytes are all untouched. There is no migration here
 * because there is nothing to migrate.
 *
 * THE ORDERING TRAP, and why this deliberately does NOT call `createTripDoc`. `reconcileFirstSnapshot`
 * reads `if (tripExists && (remoteDays.length > 0 || localWasPersisted)) applyRemote(remoteDays)`.
 * Minting the trip doc first would make that true with an EMPTY remote and a PRESENT local key —
 * which is `applyRemote([])` → `savePlans([])` → the entire itinerary destroyed on the first
 * snapshot. Leaving the doc absent takes the seed branch instead, which writes the marker (with
 * this device as `owner` in `members`) and pushes the local days up. The trips-hub create flow is
 * safe from this only because a brand-new pack id always has an ABSENT local key.
 */

/** Read a share code offered by a `?share=` invite link, so a peer never has to retype a UUID. */
function pendingShareCode(): string {
  if (typeof window === 'undefined') return '';
  return (new URLSearchParams(window.location.search).get('share') ?? '').trim();
}

export function ShareDefaultTripDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<'choose' | 'join'>('choose');
  // Identity is read on mount, never during render: `getActiveTraveler()` reads localStorage, which
  // is absent server-side, and a render-time read would hydrate-mismatch.
  const [traveler, setTraveler] = useState<string | null>(null);
  const joinInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTraveler(getActiveTraveler()?.name ?? null);
    const pending = pendingShareCode();
    if (pending) {
      setCode(pending);
      setMode('join');
    }
  }, [open]);

  // Move focus to the code box when the join step opens, so a keyboard user is not left on a
  // button that has just been replaced.
  useEffect(() => {
    if (mode === 'join') joinInputRef.current?.focus();
  }, [mode]);

  /**
   * Both paths are the same one-line write plus a full reload. The reload is load-bearing, not
   * cosmetic: `subscribeRemote()` establishes its listener once per boot, so nothing syncs until
   * the app comes back up.
   */
  const applyShareId = (id: string) => {
    setDefaultTripShareId(id);
    window.location.assign(withBasePath('/'));
  };

  const startSharing = () => applyShareId(crypto.randomUUID());
  const joinShared = () => {
    const trimmed = code.trim();
    if (trimmed) applyShareId(trimmed);
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setMode('choose');
        onOpenChange(next);
      }}
    >
      <AlertDialogContent data-testid="share-default-trip-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {mode === 'choose' ? 'Share this plan' : 'Open a shared plan'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {mode === 'choose' ? (
              <>
                Your plan is saved on this device only. Sharing it uploads what you already have —
                every edit, exactly as it is now — and keeps it in step with anyone you invite.
                Nothing is overwritten and nothing is lost.
              </>
            ) : (
              <>
                Paste the code from the person who shared their plan. Their plan{' '}
                <strong className="font-semibold text-ink-hi">replaces the one on this device</strong>
                , so back yours up first if you have edits worth keeping.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* Ongoing pushes are gated on an identified traveler (`core/sync/outbox.ts`'s `enabled()`),
            so a nameless device would upload the plan once and then silently stop. Say so up front
            rather than letting it look like it worked. */}
        {traveler === null && (
          <p
            className="flex items-start gap-2 border-hair border-border bg-surface-low px-3 py-2 text-t-body text-amber-300"
            data-testid="share-default-trip-no-identity"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              Add your name in Settings, under Trip access, before you share. Without it this device
              can upload the plan once but cannot keep sending your later edits.
            </span>
          </p>
        )}

        {mode === 'join' && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="share-default-trip-code" className="text-t-body text-ink-mid">
              Shared plan code
            </label>
            <input
              ref={joinInputRef}
              id="share-default-trip-code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="paste the code here"
              data-testid="share-default-trip-code"
              className="border-hair border-border bg-surface-low px-3 py-2 font-machine text-t-body text-ink-hi"
            />
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Not now</AlertDialogCancel>
          {mode === 'choose' ? (
            <>
              <button
                type="button"
                onClick={() => setMode('join')}
                data-testid="share-default-trip-join-step"
                className="btn btn--2 px-4"
              >
                <Link2 className="h-4 w-4" aria-hidden="true" />
                I have a code
              </button>
              <AlertDialogAction onClick={startSharing} data-testid="share-default-trip-start">
                <Users className="h-4 w-4" aria-hidden="true" />
                Start sharing
              </AlertDialogAction>
            </>
          ) : (
            <AlertDialogAction
              onClick={joinShared}
              disabled={code.trim() === ''}
              data-testid="share-default-trip-join"
            >
              Open shared plan
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default ShareDefaultTripDialog;
