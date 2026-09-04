'use client';

import { useEffect, useState } from 'react';
import { joinTrip, JOIN_REFUSAL_COPY } from '@/core/trips/registry';
import { getActiveTripId } from '@/core/storage/gateway';
import { withBasePath } from '@/lib/utils';
import { useActiveTraveler } from '@/hooks/use-active-traveler';
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

/**
 * Shared-link join handshake. An always-mounted, zero-footprint
 * client island: it reads `?trip=<token>` ONCE on mount and, only if that token differs from the
 * trip this browser is already on, shows a confirm before switching. A confirm step (rather than
 * silently switching on page load) is the deliberate safety net against a stray/malicious link
 * quietly reassigning someone's active trip.
 *
 * - "Join" = the switch primitive via the registry: `joinTrip(token, 'Shared trip')`
 * (register + write the pointer) + a full reload via `location.replace` to the HOME dashboard
 * (`withBasePath('/')`,), so the switch happens, the browser lands somewhere oriented, AND
 * the secret token does not linger in the address bar / history.
 * - "Cancel" (button, Esc, or outside-click via Radix) = strip the param via `history.replaceState`
 * and stay on the current trip — no switch, no reload.
 *
 * "Already on this trip?" is decided against `getActiveTripId()` (the LOCAL pack id). #10 made
 * this the right comparison everywhere: a custom trip's local id IS its capability token, and the
 * default pack no longer has a remote token at all (`getTripId()` returns '' for it — comparing
 * against that would wrongly prompt a self-join for a `?trip=nepal-japan-2026` link on the
 * default pack).
 *
 * THE THREE STATES ARE ALL DRAWN, and none of them is a lighter tint of another. Waiting says
 * SWITCHING in words on a disabled control; the failure states its condition as a sentence in the
 * error tier. TWO DIFFERENT FAILURES reach that tier and they do not share a sentence: the
 * registry can REFUSE the token (`joinTrip` reports it; the shared `JOIN_REFUSAL_COPY` says which
 * refusal, and the confirm is disabled because a token that came off the URL cannot be corrected
 * here), or the write can be SWALLOWED by a storage layer that never throws, which is transient
 * and retryable. The pointer is read back rather than assumed, which is what catches the second.
 *
 * A11y: reuses the app's Radix `AlertDialog` (focus trap + Esc-to-cancel + labelled dialog for
 * free); both actions clear the tap floor through the shared control recipe. Renders `null`
 * (nothing mounts) on every normal load, so it costs nothing unless a `?trip=` link is opened.
 */
export default function TripJoinHandshake() {
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'joining'>('idle');
  /**
   * The failure, as a sentence plus whether pressing the button again could ever help. Two causes
   * reach this dialog and they need opposite affordances: a swallowed storage write is transient
   * (retry), a registry refusal is a fact about the token in the URL and is not (the exit is
   * Cancel). One state, not two, so "is there an error" cannot disagree with "what was it".
   */
  const [failure, setFailure] = useState<{ text: string; retryable: boolean } | null>(null);
  const { traveler } = useActiveTraveler();
  // Depend on the BOOLEAN, not the traveler object: `useActiveTraveler` re-resolves a fresh object
  // on every identity:changed, which would re-run this effect for no reason.
  const identified = traveler !== null;

  useEffect(() => {
    // / + /: adding a trip is a trip-MUTATING registry action (it moves
    // the active-trip pointer) and, per the two-token rule, requires a LOGGED-IN user. With no
    // guest mode, UNIDENTIFIED is the only bail case: the front door owns it —
    // `token-gate.tsx` reads the same `?trip=` param, HOLDS it through log-in / create-account, and
    // joins before its reload. Bailing here keeps a second, invisible dialog from mounting behind
    // the wall.
    if (!identified) return;
    const raw = new URLSearchParams(window.location.search).get('trip');
    const t = raw?.trim();
    // Prompt only for a non-empty token that is NOT the trip we are already on.
    if (t && t !== getActiveTripId()) setToken(t);
  }, [identified]);

  const stripParam = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('trip');
    window.history.replaceState(window.history.state, '', url.toString());
  };

  const handleCancel = () => {
    stripParam();
    setToken(null);
  };

  const handleJoin = () => {
    if (!token) return;
    setStatus('joining');
    setFailure(null);
    const joined = joinTrip(token, 'Shared trip'); // register + write the pointer...
    // The registry can refuse the token outright, and that is a different fact from a write that
    // did not stick. Both used to land on the storage sentence below, which told someone holding a
    // refused token to go and free up disk space.
    if (!joined.ok) {
      setStatus('idle');
      setFailure({ text: JOIN_REFUSAL_COPY[joined.reason], retryable: false });
      return;
    }
    // ...but the write is best-effort, so read the pointer back before navigating. If it did not
    // stick, the reload would land on the OLD trip and look like the token was wrong.
    if (getActiveTripId() !== token) {
      setStatus('idle');
      setFailure({
        text: 'This browser did not save the switch, so you are still on your current trip. Private browsing and a full storage box both block the write — try again in a normal window, or free some space.',
        retryable: true,
      });
      return;
    }
    // Full reload, landing on the HOME dashboard — a clean, param-free target, so the secret
    // token does not linger in the address bar / history either.
    window.location.replace(withBasePath('/'));
  };

  if (!token) return null;

  const joining = status === 'joining';
  // Show a shortened form of the (secret) token in copy — enough to recognise the link, not the
  // whole key spilled into a dialog.
  const shortToken = token.length > 12 ? `${token.slice(0, 8)}…` : token;

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !joining) handleCancel();
      }}
    >
      <AlertDialogContent
        className="rounded-r3 border-2 border-border bg-surface-low text-ink-hi"
        data-testid="trip-join-dialog"
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Add this trip?</AlertDialogTitle>
          <AlertDialogDescription className="text-t-body text-ink-mid">
            A Trip Token is one trip&rsquo;s key &mdash; anyone holding it opens the same plan.
            Adding this one switches this browser to that trip; your current view is replaced and
            nothing you already have is deleted. Switch back any time from your Trips page.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* The token itself, printed. It is the subject of this dialog, so it is drawn rather
            than mentioned mid-sentence. */}
        <div
          data-testid="trip-join-token"
          className="border-hair border-[color:hsl(var(--border))] bg-surface-raised px-gut py-2"
        >
          <span className="pr block">Trip Token</span>
          <span className="num block text-n-sm text-ink-hi">{shortToken}</span>
        </div>

        <p className="text-t-sm text-ink-lo">
          A Trip Token can&rsquo;t be checked before it is used. If the trip opens empty, it may be
          mistyped, or the trip is brand new.
        </p>

        {failure && (
          <p
            role="alert"
            data-testid="trip-join-error"
            className="err border-hair border-[color:hsl(var(--destructive))] px-gut py-2 text-t-body"
          >
            {failure.text}
          </p>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel data-testid="trip-join-cancel" disabled={joining}>
            Cancel
          </AlertDialogCancel>
          {/* A refused token cannot be edited from here (it came off the URL), so offering
              "Try again" on it would be a control that is guaranteed not to work. Cancel is the
              exit; the dialog keeps carrying the reason. */}
          <AlertDialogAction
            data-testid="trip-join-confirm"
            onClick={(e) => {
              // Radix closes the dialog on action-click; the switch owns the navigation, and on
              // the failure path the dialog has to stay up to carry the message.
              e.preventDefault();
              handleJoin();
            }}
            disabled={joining || failure?.retryable === false}
          >
            {joining ? 'Switching…' : failure ? 'Try again' : 'Add trip'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
