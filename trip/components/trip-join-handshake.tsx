'use client';

import { useEffect, useState } from 'react';
import { joinTrip } from '@/core/trips/registry';
import { getTripId } from '@/lib/firebase-config';
import { withBasePath } from '@/lib/utils';
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
 * "Already on this trip?" is decided against `getTripId()` (the REMOTE capability token the link
 * encodes), NOT the local pack id: on the grandfathered default pack those two strings differ
 * (local `nepal-japan-2026` vs the build-time secret), so comparing the link's token to the remote
 * token is the correct "is this my current trip" test and avoids a needless self-switch.
 *
 * A11y: reuses the app's Radix `AlertDialog` (focus trap + Esc-to-cancel + labelled dialog for
 * free); both actions are ≥44px touch targets. Renders `null` (nothing mounts) on every normal
 * load, so it costs nothing unless a `?trip=` link is actually opened.
 */
export default function TripJoinHandshake() {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('trip');
    const t = raw?.trim();
    // Prompt only for a non-empty token that is NOT the trip we are already on.
    if (t && t !== getTripId()) setToken(t);
  }, []);

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
    joinTrip(token, 'Shared trip'); // register + write the pointer...
    // ..then full reload, landing on the HOME dashboard — a clean, param-free
    // target, so the secret token does not linger in the address bar / history either.
    window.location.replace(withBasePath('/'));
  };

  if (!token) return null;

  // Show a shortened form of the (secret) token in copy — enough to recognise the link, not the
  // whole key spilled into a dialog.
  const shortToken = token.length > 12 ? `${token.slice(0, 8)}…` : token;

  return (
    <AlertDialog open onOpenChange={(open) => { if (!open) handleCancel(); }}>
      <AlertDialogContent
        className="glass-card-dark border-white/10 text-white"
        data-testid="trip-join-dialog"
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Join this trip?</AlertDialogTitle>
          <AlertDialogDescription className="text-white/60">
            You opened a shared Trip Key (
            <span className="font-mono text-white/80">{shortToken}</span>). Joining switches this
            browser to that trip — your current view is replaced. You can switch back any time from
            Settings. Keys can&rsquo;t be verified in advance — if the trip opens empty, the key may
            be mistyped or the trip is brand new.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="trip-join-cancel" className="min-h-[44px]">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            data-testid="trip-join-confirm"
            onClick={handleJoin}
            className="min-h-[44px] bg-gold-500 text-surface hover:bg-gold-400"
          >
            Join trip
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
