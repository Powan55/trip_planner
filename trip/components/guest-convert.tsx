'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { adoptSandbox, sessionGate, setSyncCode } from '@/core/storage/gateway';
import { joinTrip } from '@/core/trips/registry';
import { signIn, exitGuest } from '@/lib/token-auth';
import { useActiveTraveler } from '@/hooks/use-active-traveler';
import { isTravelRoute } from '@/lib/travel-route';
import { withBasePath } from '@/lib/utils';
import UserTokenShowOnce from '@/components/user-token-show-once';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
} from '@/components/ui/alert-dialog';

/**
 * "Keep this trip" — the guest → account conversion.
 *
 * The explorer→owner funnel: a guest who has been editing the demo turns, in one action, into an
 * account holder whose brand-new trip already contains everything they did as a guest. Nothing is
 * lost at the boundary — `adoptSandbox` MOVES every `trip:guest-sandbox:*` key to the new trip's
 * namespace by PREFIX SCAN (not a slot list), so a storage slot invented later is carried for free.
 *
 * TWO TOKENS, NEVER MIXED. One action mints BOTH:
 * - a **User Token** (`crypto.randomUUID()` → gateway key 28) — the ACCOUNT credential, shown
 * exactly once via the shared `UserTokenShowOnce` with the
 * never-share warning;
 * - a **Trip Token** (`crypto.randomUUID()` → the new trip's id) — the capability for THIS trip,
 * which is what they will later share. It is not shown here; `/trips` copies it on demand.
 *
 * THE SEQUENCE IS THE DECISION ( run synchronously in `convert()`):
 * `id = randomUUID()` → `adoptSandbox(id)` → mint userToken → `setSyncCode` → `signIn(name)` →
 * `clearGuest()` → `joinTrip(id, tripName)` → SHOW-ONCE → full reload to `/`.
 * The reload is discipline: `keyFor`'s guest branch and the active-trip pointer both change,
 * and neither may flip mid-session.
 *
 * THE `held` FLAG: `signIn` dispatches `identity:changed`, so
 * the instant it runs this island's `isGuest` goes false — which would unmount the dialog and the
 * show-once screen with it, losing the User Token forever. `held` keeps the component mounted from
 * the first storage write until the navigation.
 *
 * WHERE THE CTA LIVES (both widths, one dialog):
 * - DESKTOP: the navbar's guest chip dispatches
 * `guest-convert:open`. The identity cluster is the established home for this affordance, and
 * the chip is `hidden md:flex` — so it covers desktop only.
 * - MOBILE: a quiet fixed pill above the bottom tab bar, rendered HERE (`md:hidden`) because the
 * navbar's identity cluster is hidden below `md` and LOCKS the tab bar at five slots. It
 * sits bottom-LEFT on the presence-bar's coordinates — that cluster is identity-gated, so it is
 * guaranteed empty for a guest — leaving the bottom-right quick-add FAB and the toasts clear.
 * The `guest-convert:open` CustomEvent is the app's existing trigger idiom (`quickadd:open`,
 * `expense:open`, `palette:open`), so the chip needs no state and there is still only ONE dialog.
 *
 * HONESTY. The copy promises exactly what
 * conversion delivers: the guest's own edits move; the Nepal × Japan guide pages stay with the
 * demo (the new trip is not the default pack, so `DefaultTripOnly` shows its empty state there);
 * and the account is what unlocks the identity-gated features (sync, sharing, Travel Mode). It does
 * NOT promise the concierge, which is gated on the DEFAULT pack, not on identity.
 *
 * A11y: Radix AlertDialog (the `trips-hub` forget-confirm precedent) carries the contract —
 * labelled dialog, focus trap, focus return to the trigger, Escape, scroll lock. Divergences, both
 * deliberate: initial focus is moved to the first field (a form, not a confirm), and while the
 * show-once screen is up Escape is swallowed — the confirm is the only way forward.
 */

/** Trigger idiom (see header): any surface can open the one dialog by dispatching this. */
export const GUEST_CONVERT_OPEN_EVENT = 'guest-convert:open';

/** Pre-filled, editable trip name — the demo they were exploring, made theirs. */
const DEFAULT_TRIP_NAME = 'My Nepal × Japan trip';

export default function GuestConvert() {
  const { isGuest } = useActiveTraveler();
  const pathname = usePathname();

  // SSR / first-paint safety, mirroring TokenGate: `useActiveTraveler` yields the inert snapshot on
  // the server and the first client render, so gate every render on a post-mount flag.
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [held, setHeld] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [tripName, setTripName] = useState(DEFAULT_TRIP_NAME);
  /** Non-null once the account exists on disk: the dialog becomes the show-once screen. */
  const [minted, setMinted] = useState<string | null>(null);

  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(GUEST_CONVERT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(GUEST_CONVERT_OPEN_EVENT, onOpen);
  }, []);

  /**: Travel Mode is chrome-free (and guest-blocked anyway) — no pill there. */
  if (!mounted || isTravelRoute(pathname) || (!isGuest && !held)) return null;

  /**
   * The conversion sequence, synchronous and in order. Every step is a local storage write
   * (no network, no firebase): the account, the adoption, the identity, the registry. The reload
   * that `finish()` performs is what re-arms the app with the new pointer + identity.
   */
  const convert = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const who = name.trim();
    if (!who) return;
    const label = tripName.trim() || DEFAULT_TRIP_NAME;

    setBusy(true);
    setHeld(true); // survive the identity:changed that `signIn` is about to fire (see header)

    const id = crypto.randomUUID(); // the new trip's Trip Token
    adoptSandbox(id); // prefix-scan MOVE — every guest byte becomes this trip's
    const userToken = crypto.randomUUID(); // the User Token — the account itself
    setSyncCode(userToken); // key 28
    if (!signIn(who)) {
      // Only reachable on an empty name, which the submit guard already refused — but never
      // strand the user in a half-converted state if it ever changes.
      setBusy(false);
      setHeld(false);
      return;
    }
    sessionGate.clearGuest(); // `signIn` already cleared it (invariant (a)); states it too
    joinTrip(id, label); // registry entry + active-trip pointer
    setMinted(userToken); // → the show-once screen; `finish` reloads on its confirm
  };

  /** FULL reload to Home: the new trip's data re-hydrates from its own keys. */
  const finish = () => window.location.replace(withBasePath('/'));

  return (
    <>
      {/* MOBILE-only CTA (see header for why it is here and not a sixth tab). */}
      {!held && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-testid="guest-convert-cta"
          className="md:hidden fixed left-4 z-40 inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-gold-400/40 bg-surface/90 px-4 text-sm font-semibold text-gold-200 shadow-lg backdrop-blur-xl outline-none transition-colors hover:bg-gold-400/15 hover:text-gold-100 focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
          style={{ bottom: 'calc(var(--tab-bar-h, 64px) + env(safe-area-inset-bottom) + 1rem)' }}
        >
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          Keep this trip
        </button>
      )}

      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!next && minted) return; // the show-once screen has no dismiss
          setOpen(next);
        }}
      >
        <AlertDialogContent
          data-testid="guest-convert-dialog"
          className="glass-card-dark max-h-[90vh] overflow-y-auto border-white/10 text-white"
          onOpenAutoFocus={(e) => {
            // Divergence: this is a FORM, so focus the first field rather than an action button.
            e.preventDefault();
            nameRef.current?.focus();
          }}
          onEscapeKeyDown={(e) => {
            if (minted) e.preventDefault();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {minted ? 'Your trip is yours now' : 'Keep this trip'}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-white/60">
              {minted
                ? `Saved as “${tripName.trim() || DEFAULT_TRIP_NAME}”. One thing left, ${name.trim()}.`
                : 'Everything you changed in the demo — your plan, checklists, budget, journal and saved places — moves into a new trip of your own. We’ll create your account at the same time.'}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {minted ? (
            <UserTokenShowOnce
              token={minted}
              heading="Save your User Token"
              confirmLabel="I saved it — open my trip"
              testIdPrefix="guest-convert-show-once"
              onConfirm={finish}
            />
          ) : (
            <form onSubmit={convert} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor="guest-convert-name" className="text-xs text-white/50">
                  Your name
                </label>
                <input
                  id="guest-convert-name"
                  ref={nameRef}
                  data-testid="guest-convert-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter your name"
                  maxLength={24}
                  required
                  autoComplete="off"
                  autoCapitalize="words"
                  spellCheck={false}
                  readOnly={busy}
                  className="min-w-0 rounded-lg border border-white/15 bg-surface/60 px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus-visible:border-gold-400/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/40"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="guest-convert-trip-name" className="text-xs text-white/50">
                  Name this trip
                </label>
                <input
                  id="guest-convert-trip-name"
                  data-testid="guest-convert-trip-name"
                  value={tripName}
                  onChange={(e) => setTripName(e.target.value)}
                  maxLength={40}
                  autoComplete="off"
                  readOnly={busy}
                  className="min-w-0 rounded-lg border border-white/15 bg-surface/60 px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus-visible:border-gold-400/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/40"
                />
              </div>

              <p className="text-xs leading-relaxed text-white/50">
                Your account is what unlocks keeping this trip across devices, sharing it with its
                Trip Token, and Travel Mode. The Nepal and Japan guide pages stay part of the demo.
              </p>

              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="submit"
                  disabled={!name.trim() || busy}
                  data-testid="guest-convert-submit"
                  className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg bg-gold-500 px-4 py-2.5 text-sm font-semibold text-surface transition-colors hover:bg-gold-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  Keep this trip
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={busy}
                  data-testid="guest-convert-cancel"
                  className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-white/15 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50"
                >
                  Not yet
                </button>
              </div>

              {/* The other half of the funnel: someone who ALREADY has an account should log in,
                  not mint a second one. `exitGuest` clears the flag, so the front door returns. */}
              <button
                type="button"
                onClick={exitGuest}
                disabled={busy}
                data-testid="guest-convert-login"
                className="self-start rounded text-xs text-gold-400 underline underline-offset-4 outline-none transition-colors hover:text-gold-300 focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none disabled:opacity-50"
              >
                Already have a User Token? Log in instead
              </button>
            </form>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
