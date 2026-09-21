'use client';

import { useEffect, useState } from 'react';
import {
  joinTrip,
  parseTripToken,
  DEFAULT_SHARE_PREFIX,
  type TripToken,
} from '@/core/trips/registry';
import { getActiveTripId, getDefaultTripShareId, DEFAULT_TRIP_ID } from '@/core/storage/gateway';
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
 * TWO KINDS OF INVITATION (D-546). `parseTripToken` decides which the link carries before
 * anything is written. A `pack:`-prefixed token is the DEFAULT pack's share id: joining it keeps
 * the browser on Nepal × Japan — its two legs, NPT +345 / JST +540 and all its guide content —
 * and only points the pack at the sharer's remote id. Everything else is a custom trip's
 * capability token and switches packs as before. Before this, both resolved as a pack id, so a
 * share link silently converted the joiner to a single-leg, `utcOffsetMin: 0`, `contentRef:
 * 'empty'` trip and their clocks and guides were gone.
 *
 * "Already here?" is decided per kind: the SHARE ID for a default-pack invitation (its pack id
 * never changes, so comparing that would suppress every prompt) and `getActiveTripId()` for a
 * custom one — a custom trip's local id IS its capability token (#10).
 *
 * A token that can never be used (path-unsafe, reserved, empty after the prefix) draws a stated
 * refusal instead of prompting. Nothing is written on that path.
 *
 * THE THREE STATES ARE ALL DRAWN, and none of them is a lighter tint of another. Waiting says
 * SWITCHING in words on a disabled control; the failure states its condition as a sentence in the
 * error tier. Both are reachable: `joinTrip` writes through a storage layer that SWALLOWS a
 * denied or full write, so a browser with storage blocked used to reload straight back onto the
 * old trip with nothing said. The pointer is read back rather than assumed.
 *
 * A11y: reuses the app's Radix `AlertDialog` (focus trap + Esc-to-cancel + labelled dialog for
 * free); both actions clear the tap floor through the shared control recipe. Renders `null`
 * (nothing mounts) on every normal load, so it costs nothing unless a `?trip=` link is opened.
 */
export default function TripJoinHandshake() {
  const [token, setToken] = useState<TripToken | null>(null);
  const [status, setStatus] = useState<'idle' | 'joining' | 'error' | 'unusable'>('idle');
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
    if (!t) return;
    // D-546 — resolve WHICH namespace the link carries before anything is written. A token that
    // can never be used (empty, path-unsafe, reserved) stops here with a stated refusal rather
    // than being pasted into a Firestore path and opening a silently-empty trip.
    const parsed = parseTripToken(t);
    if (!parsed) {
      setStatus('unusable');
      return;
    }
    // Prompt only when this is NOT where the browser already is. For a default-pack invitation
    // that is the SHARE ID, not the pack id — the pack id never changes, so comparing it would
    // suppress every such prompt.
    const alreadyHere =
      parsed.kind === 'default'
        ? getActiveTripId() === DEFAULT_TRIP_ID && getDefaultTripShareId() === parsed.id
        : getActiveTripId() === parsed.id;
    if (!alreadyHere) setToken(parsed);
  }, [identified]);

  const stripParam = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('trip');
    window.history.replaceState(window.history.state, '', url.toString());
  };

  const handleCancel = () => {
    stripParam();
    setToken(null);
    setStatus('idle');
  };

  const handleJoin = () => {
    if (!token) return;
    setStatus('joining');
    // `joinTrip` writes the pointer AND reads it back (D-546): the storage layer SWALLOWS a denied
    // or full write, so a browser with storage blocked would otherwise reload straight back onto
    // the old trip with nothing said.
    const wire = token.kind === 'default' ? `${DEFAULT_SHARE_PREFIX}${token.id}` : token.id;
    if (!joinTrip(wire, 'Shared trip')) {
      setStatus('error');
      return;
    }
    // Full reload, landing on the HOME dashboard — a clean, param-free target, so the secret
    // token does not linger in the address bar / history either.
    window.location.replace(withBasePath('/'));
  };

  // D-546 — a link whose token can never be used. Drawn rather than ignored: an invitee who was
  // sent a mangled link must be told to ask for another, not left on a page where nothing happens.
  if (status === 'unusable') {
    return (
      <AlertDialog open onOpenChange={(open) => !open && handleCancel()}>
        <AlertDialogContent
          className="rounded-r3 border-2 border-border bg-surface-low text-ink-hi"
          data-testid="trip-join-dialog"
        >
          <AlertDialogHeader>
            <AlertDialogTitle>This link can&rsquo;t be opened</AlertDialogTitle>
            <AlertDialogDescription className="text-t-body text-ink-mid">
              The trip code in this link is incomplete, so nothing has been changed on this device.
              Links are often cut short by chat apps &mdash; ask whoever sent it to share the code
              itself instead, and paste it in Settings, under Trip access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="trip-join-cancel">Close</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  if (!token) return null;

  const joining = status === 'joining';
  const isDefaultPack = token.kind === 'default';
  // Show a shortened form of the (secret) token in copy — enough to recognise the link, not the
  // whole key spilled into a dialog.
  const shortToken = token.id.length > 12 ? `${token.id.slice(0, 8)}…` : token.id;

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
          <AlertDialogTitle>
            {isDefaultPack ? 'Open this shared plan?' : 'Add this trip?'}
          </AlertDialogTitle>
          {/* The two invitations have different consequences, so they get different sentences.
              A default-pack invitation keeps you on Nepal × Japan and joins you to someone else's
              copy of it — which REPLACES the plan on this device, the documented first-snapshot
              semantic (D-542). Saying "nothing is deleted" there would be false. */}
          <AlertDialogDescription className="text-t-body text-ink-mid">
            {isDefaultPack ? (
              <>
                This opens someone else&rsquo;s Nepal &times; Japan plan on this device, and keeps
                the two in step from now on. Their plan{' '}
                <strong className="font-semibold text-ink-hi">replaces the one you have here</strong>
                , so back yours up first if you have edits worth keeping.
              </>
            ) : (
              <>
                A Trip Token is one trip&rsquo;s key &mdash; anyone holding it opens the same plan.
                Adding this one switches this browser to that trip; your current view is replaced
                and nothing you already have is deleted. Switch back any time from your Trips page.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* The token itself, printed. It is the subject of this dialog, so it is drawn rather
            than mentioned mid-sentence. */}
        <div
          data-testid="trip-join-token"
          className="border-hair border-[color:hsl(var(--border))] bg-surface-raised px-gut py-2"
        >
          <span className="pr block">{isDefaultPack ? 'Shared plan code' : 'Trip Token'}</span>
          <span className="num block text-n-sm text-ink-hi">{shortToken}</span>
        </div>

        <p className="text-t-sm text-ink-lo">
          {isDefaultPack
            ? 'A shared plan code can’t be checked before it is used. If the plan opens as your own, nobody has uploaded to it yet.'
            : 'A Trip Token can’t be checked before it is used. If the trip opens empty, it may be mistyped, or the trip is brand new.'}
        </p>

        {status === 'error' && (
          <p
            role="alert"
            data-testid="trip-join-error"
            className="err border-hair border-[color:hsl(var(--destructive))] px-gut py-2 text-t-body"
          >
            This browser did not save the switch, so you are still on your current trip. Private
            browsing and a full storage box both block the write &mdash; try again in a normal
            window, or free some space.
          </p>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel data-testid="trip-join-cancel" disabled={joining}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            data-testid="trip-join-confirm"
            onClick={(e) => {
              // Radix closes the dialog on action-click; the switch owns the navigation, and on
              // the failure path the dialog has to stay up to carry the message.
              e.preventDefault();
              handleJoin();
            }}
            disabled={joining}
          >
            {joining
              ? 'Switching…'
              : status === 'error'
                ? 'Try again'
                : isDefaultPack
                  ? 'Open shared plan'
                  : 'Add trip'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
