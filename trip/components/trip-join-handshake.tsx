'use client';

import { useEffect, useState } from 'react';
import { joinTrip } from '@/core/trips/registry';
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
 * A11y: reuses the app's Radix `AlertDialog` (focus trap + Esc-to-cancel + labelled dialog for
 * free); both actions are ≥44px touch targets. Renders `null` (nothing mounts) on every normal
 * load, so it costs nothing unless a `?trip=` link is actually opened.
 */
export default function TripJoinHandshake() {
  const [token, setToken] = useState<string | null>(null);
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
          <AlertDialogTitle>Add this trip?</AlertDialogTitle>
          <AlertDialogDescription className="text-ink-mid">
            You opened a shared Trip Token (
            <span className="font-mono text-ink-hi">{shortToken}</span>). Adding it switches this
            browser to that trip — your current view is replaced. You can switch back any time from
            your Trips page. A Trip Token can&rsquo;t be verified in advance — if the trip opens
            empty, it may be mistyped or the trip is brand new.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="trip-join-cancel" className="min-h-[44px]">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            data-testid="trip-join-confirm"
            onClick={handleJoin}
            className="min-h-[44px] bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Add trip
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
