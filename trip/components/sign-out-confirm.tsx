'use client';

import { useState } from 'react';
import { Download, Check, AlertTriangle } from 'lucide-react';
import { signOut } from '@/lib/token-auth';
import { downloadTripBackup } from '@/lib/trip-backup';
import { defaultBlobStore } from '@/core/photos/blob-store';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';

/**
 * Shared sign-out confirm dialog — the ONE teardown-confirm UI landed at all three
 * sign-out controls (`settings-panel.tsx`'s Identity row, `navbar.tsx`'s desktop traveler chip,
 * `app/more/more-list.tsx`'s mobile row), so the root-cause fix — `signOut()`'s full local teardown,
 * `core/storage/gateway.ts`'s `wipeAllTripData()` — is never a one-click-destructive surprise.
 *
 * Ruling 1's exact copy (sign-out is unrecoverable data loss in this window — lands before
 * — the User Token restores the ACCOUNT, not the plan). Ruling 2's backup offer, wired to the
 * extracted `downloadTripBackup()` (reused verbatim — no new export path, no new dependency): a
 * plain button that stays open on click, so backing up and still confirming (or cancelling) both
 * stay available.
 *
 * `forgetDevice` escalates to ALSO clear every locally
 * stored photo blob (IndexedDB, app-scoped) via `defaultBlobStore.clear()` before signing out —
 * strictly more destructive than a plain sign-out, which deliberately leaves photos alone (a photo
 * is expensive to re-acquire and is not identity-linked).
 *
 * Reload after teardown (Ruling 3): the local domain stores (`hooks/create-reactive-store.ts`) only
 * re-read on their own event or a cross-tab `storage` event, which never fires in the tab that made
 * the write — a raw sweep would leave every mounted store showing stale data. `signOut()` itself
 * stays reload-free — mirroring (a trip-pointer switch's
 * pure function doesn't reload either; the CALLER does) — so the reload lives HERE, not in the
 * gateway/token-auth layer.
 *
 * `children` composes via Radix's `asChild` (exactly `ClearRow`'s pattern in `settings-panel.tsx`)
 * so each of the three call sites keeps its own button markup/label; this component owns only the
 * dialog + the action. Testids follow the house convention: `{testId}` (trigger, supplied by the
 * caller's own button) / `{testId}-dialog` / `{testId}-cancel` / `{testId}-confirm`.
 */
export default function SignOutConfirm({
  testId,
  forgetDevice = false,
  children,
}: {
  testId: string;
  forgetDevice?: boolean;
  children: React.ReactNode;
}) {
  const [backup, setBackup] = useState<'idle' | 'done' | 'error'>('idle');

  const handleBackup = async () => {
    try {
      await downloadTripBackup();
      setBackup('done');
    } catch {
      setBackup('error');
    }
  };

  const handleConfirm = () => {
    void (async () => {
      if (forgetDevice) await defaultBlobStore.clear();
      signOut();
      // Reload after teardown (Ruling 3) — every mounted local store re-hydrates fresh; precedent.
      window.location.reload();
    })();
  };

  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (open) setBackup('idle'); // fresh dialog, fresh backup-offer state
      }}
    >
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent
        className="border-2 border-[hsl(var(--border))] bg-[rgb(var(--surface-raised))] text-white"
        data-testid={`${testId}-dialog`}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{forgetDevice ? 'Forget this device?' : 'Sign out of this device?'}</AlertDialogTitle>
          <AlertDialogDescription className="text-[color:var(--text-mid)]">
            {forgetDevice
              ? "This does everything signing out does, and also permanently deletes every photo stored on this device. Your key still gets you back into your account, but neither the plan nor these photos come back unless the trip was synced elsewhere first."
              : "This removes this trip's data from this device. Your key gets you back into your account, but the plan itself won't come back unless it's synced to another device."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <button
          type="button"
          onClick={handleBackup}
          data-testid={`${testId}-backup`}
          className="inline-flex min-h-tap items-center justify-center gap-2 self-start rounded-r1 border border-[color:var(--border-ui)] px-4 py-2.5 font-machine text-t-label font-semibold uppercase tracking-[0.12em] text-[color:var(--text-hi)] transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          {backup === 'done' ? (
            <Check className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Download className="h-4 w-4" aria-hidden="true" />
          )}
          {backup === 'done' ? 'Backup downloaded' : 'Back up this trip first'}
        </button>
        <div aria-live="polite" className="min-h-[1.25rem] text-xs">
          {backup === 'error' && (
            <p className="flex items-center gap-1.5 text-red-300">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Could not back up your trip. Please try again.
            </p>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel data-testid={`${testId}-cancel`}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            data-testid={`${testId}-confirm`}
            onClick={handleConfirm}
            className="btn btn--danger"
          >
            {forgetDevice ? 'Forget this device' : 'Sign out'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
