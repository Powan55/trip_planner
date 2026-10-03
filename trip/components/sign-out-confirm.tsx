'use client';

import { useRef, useState } from 'react';
import { Download, Check, AlertTriangle } from 'lucide-react';
import { signOut } from '@/lib/token-auth';
import { downloadTripBackup } from '@/lib/trip-backup';
import { isRemoteConfigured } from '@/lib/firebase-config';
import { defaultBlobStore } from '@/core/photos/blob-store';
import { getSyncCode, removeKey, STORAGE_KEYS } from '@/core/storage/gateway';
import { unsyncedEditCount } from '@/core/trips/registry';
import { flushAllDomains } from '@/hooks/use-domain-sync';
import UserTokenShowOnce from '@/components/user-token-show-once';
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
 * — logging back in restores the ACCOUNT, not the plan). Ruling 2's backup offer, wired to the
 * extracted `downloadTripBackup()` (reused verbatim — no new export path, no new dependency): a
 * plain button that stays open on click, so backing up and still confirming (or cancelling) both
 * stay available.
 *
 * `forgetDevice` escalates to ALSO clear every locally
 * stored photo blob (IndexedDB, app-scoped) via `defaultBlobStore.clear()`, and the three
 * lifetime-scoped keys (`lifetimeVisits`, `visitConfirmations`, `passportStamps`) that
 * `wipeAllTripData()` leaves behind, before signing out (D-503). Strictly more destructive than a
 * plain sign-out, which leaves photos and that travel history alone.
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
 *
 * TWO STEPS ON A DEVICE WITHOUT A PASSWORD YET (D-660): the wipe erases key 28, which such a
 * device needs to claim a username later, so confirming first shows the key (`UserTokenShowOnce`)
 * and the teardown runs from its confirm. A password session signs out in one step.
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
  const [backupMsg, setBackupMsg] = useState('');
  const [step, setStep] = useState<'confirm' | 'key'>('confirm');
  // Read post-open, never at mount: client-only storage and session reads.
  const [code, setCode] = useState<string | null>(null);
  /** `true` only once confirmed; unknown counts as anonymous, the safe side for both uses below. */
  const [passwordSession, setPasswordSession] = useState(false);
  const [unsynced, setUnsynced] = useState(0);
  const [busy, setBusy] = useState(false);
  const [flushing, setFlushing] = useState(false);
  const busyRef = useRef(false);

  // D-660: on a device still on its anonymous session, key 28 is the only way to carry the account
  // over to a username later, so the old show-once step stays until that device has a password.
  const keyNeeded = code !== null && isRemoteConfigured() && !passwordSession;

  const handleBackup = async () => {
    try {
      const { missing = 0, omitted = 0 } = (await downloadTripBackup()) ?? {};
      const left = missing + omitted;
      setBackupMsg(left > 0 ? `${left} photo${left === 1 ? ' was' : 's were'} left out of the backup.` : '');
      setBackup('done');
    } catch (e) {
      setBackupMsg(e instanceof Error && e.message.startsWith('This trip is too large') ? e.message : '');
      setBackup('error');
    }
  };

  const handleConfirm = () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    void (async () => {
      // #748: give queued edits one bounded chance to land before the wipe below discards them.
      // 8s matches the remote write timeout, so a hung network can't trap the user here.
      setFlushing(true);
      let cap: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([flushAllDomains(), new Promise((r) => (cap = setTimeout(r, 8000)))]);
      clearTimeout(cap);
      setFlushing(false);
      if (forgetDevice) {
        await defaultBlobStore.clear();
        // D-503: the lifetime keys stay out of `wipeAllTripData()` on purpose (D-314/D-320);
        // this is the one path that clears them, for a device changing hands.
        removeKey('local', STORAGE_KEYS.lifetimeVisits);
        removeKey('local', STORAGE_KEYS.visitConfirmations);
        removeKey('local', STORAGE_KEYS.passportStamps);
      }
      if (isRemoteConfigured()) {
        try {
          // A password session must not outlive the sign-out (D-660); an anonymous uid is what trip
          // rosters name, so only Forget this device drops it (D-576).
          const { clearRemoteCache } = await import('@/lib/firebase-remote');
          await clearRemoteCache({ signOutAuth: forgetDevice || passwordSession });
        } catch {
          // a failed chunk load must not block sign-out
        }
      }
      signOut();
      // Reload after teardown (Ruling 3) — every mounted local store re-hydrates fresh; precedent.
      window.location.reload();
    })();
  };

  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) return;
        setBackup('idle'); // fresh dialog, fresh backup-offer state
        setStep('confirm');
        setCode(getSyncCode());
        setUnsynced(unsyncedEditCount());
        setPasswordSession(false);
        if (isRemoteConfigured()) {
          void import('@/lib/firebase-remote')
            .then(({ isPasswordSession }) => isPasswordSession())
            .then(setPasswordSession, () => {});
        }
      }}
    >
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent
        className="border-2 border-[hsl(var(--border))] bg-[rgb(var(--surface-raised))] text-white"
        data-testid={`${testId}-dialog`}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {step === 'key'
              ? 'Save your key before you go.'
              : forgetDevice
                ? 'Forget this device?'
                : 'Sign out of this device?'}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-[color:var(--text-mid)]">
            {step === 'key'
              ? 'Signing out erases this key from this device, and nothing can re-issue it. Save it now — until you set up a username and password, it is the only way back into your account.'
              : keyNeeded
                ? forgetDevice
                  ? "This does everything signing out does, and also permanently deletes every photo stored on this device and your travel history (the places you've recorded visiting, and their passport stamps). It erases your key too, so you'll get one last look at it next. The plan and these photos come back only if the trip was synced elsewhere first; the travel history is kept only here, so it is gone for good."
                  : "This removes this trip's data from this device, and your key along with it. You'll get one last look at the key next — it's the only way back into your account, and the plan itself won't come back unless it's synced to another device."
                : forgetDevice
                  ? "This does everything signing out does, and also permanently deletes every photo stored on this device and your travel history (the places you've recorded visiting, and their passport stamps). Your username and password still log you back in. The plan and these photos come back only if the trip was synced elsewhere first; the travel history is kept only here, so it is gone for good."
                  : "This removes this trip's data from this device. Your username and password still log you back in, but the plan itself won't come back unless it's synced to another device."}
            {step !== 'key' && unsynced > 0 && (
              <span className="mt-2 block font-semibold text-[color:var(--text-hi)]" data-testid={`${testId}-unsynced`}>
                {unsynced} {unsynced === 1 ? 'change' : 'changes'} on this device{' '}
                {unsynced === 1 ? "hasn't" : "haven't"} synced yet and will be lost.
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p
          role="status"
          data-testid={`${testId}-flushing`}
          className={flushing ? 'text-sm text-[color:var(--text-mid)]' : 'sr-only'}
        >
          {flushing ? 'Syncing your last changes…' : ''}
        </p>

        {step === 'key' && code ? (
          <>
            <UserTokenShowOnce
              token={code}
              heading="This is your key."
              confirmLabel={forgetDevice ? 'Forget this device' : 'Sign out'}
              testIdPrefix={`${testId}-key`}
              onConfirm={handleConfirm}
              busy={busy}
            />
            <AlertDialogFooter>
              <AlertDialogCancel data-testid={`${testId}-cancel`}>Cancel</AlertDialogCancel>
            </AlertDialogFooter>
          </>
        ) : (
          <>
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
              {backup === 'done' && backupMsg && <p className="text-[color:var(--text-mid)]">{backupMsg}</p>}
              {backup === 'error' && (
                <p className="flex items-center gap-1.5 text-red-300">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {backupMsg || 'Could not back up your trip. Please try again.'}
                </p>
              )}
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel data-testid={`${testId}-cancel`}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                data-testid={`${testId}-confirm`}
                // `preventDefault` keeps Radix from closing the dialog: with a key to show, this
                // advances to the show-once step; otherwise the dialog stays up (busy) until the
                // teardown reloads the page.
                disabled={busy}
                aria-busy={busy || undefined}
                onClick={(e) => {
                  e.preventDefault();
                  if (!keyNeeded) return handleConfirm();
                  setStep('key');
                }}
                className="btn btn--danger"
              >
                {keyNeeded ? 'Show my key' : forgetDevice ? 'Forget this device' : 'Sign out'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
