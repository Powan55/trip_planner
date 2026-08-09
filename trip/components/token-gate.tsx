'use client';

import { useState, useEffect, useRef, useId } from 'react';
import { m, AnimatePresence } from 'framer-motion';
import { Plane, KeyRound, User, ArrowRight } from 'lucide-react';
import { signIn, DEFAULT_TRAVELER_NAME } from '@/lib/token-auth';
import { getUserName } from '@/lib/identity';
import { getSyncCode, setSyncCode } from '@/core/storage/gateway';
import { joinTrip } from '@/core/trips/registry';
import { useActiveTraveler } from '@/hooks/use-active-traveler';
import { withBasePath } from '@/lib/utils';
import { TRIP_START } from '@/lib/trip-data';
import { computeCountdown, type Countdown } from '@/lib/countdown';
import UserTokenShowOnce from '@/components/user-token-show-once';
import LandingPage from '@/components/landing-page';

/**
 * The front door — the app's WALL, shown iff
 * `!traveler`. There is no guest mode: a logged-out visitor sees this wall on every
 * route, with no bypass.
 *
 * TWO VIEWS: the wall opens on the marketing LANDING (`components/landing-page.tsx`,
 * zero live trip data) and swaps to the boarding-pass AUTH card when a landing CTA is pressed. Both
 * views render inside the SAME `role="dialog"` panel, which is the whole point of — the
 * landing inherits the focus trap, aria wiring and Esc capture instead of rebuilding them.
 * The dialog's `aria-labelledby`/`aria-describedby` targets move with the view: the landing puts
 * them on its <h1>/lead paragraph, the auth view on its own heading/blurb.
 *
 * TWO TOKENS, NEVER MIXED:
 * - **User Token** = the ACCOUNT credential. It is the promoted Sync Code — SAME on-disk key
 * (`tripPlannerSyncCode`, gateway key 28), so every device that ever minted one is already an
 * account, with zero migration. It is what this door asks for, and the ONLY thing it asks for.
 * - **Trip Token** = one trip's capability (the trip id). It is NEVER a login. It is entered on
 * `/trips` ("add a trip"), by a user who is already logged in.
 * The guard is LABELS + FLOW, not validation: both are UUIDs, and this door must stay firebase-free
 * (see below), so there is nothing to validate against. records the accepted residual risk —
 * a Trip Token pasted here yields a working-but-empty account, losslessly recoverable by signing
 * out and logging in again.
 *
 * TWO PATHS, both ending in a FULL reload ( shape — the reload is what re-arms the
 * provider's trip-list subscribe with code + traveler both present, so the door itself never needs
 * the network):
 * (a) **Log in** — User Token ONLY (decision 2026-07-30; the door asks for nothing else) →
 * `setSyncCode` → `signIn(displayName)` → reload landing `/trips/`. The display name is not
 * asked for here: it is reused from this device's identity slot if present, else defaults to
 * "Traveler" (renamable in Settings → Identity). The name is still load-bearing — it is the
 * identity slot `getActiveTraveler` reads to dismiss the wall and to attribute edits — the door
 * just no longer collects it. Offers this device's stored key-28 token when present ( soft
 * security; prevents orphan accounts after a sign-out with an unsaved token).
 * (b) **Create an account** — name → mint `crypto.randomUUID()` → `setSyncCode` + `signIn` →
 * SHOW-ONCE screen (shared `UserTokenShowOnce`) → explicit confirm → reload landing `/trips/`.
 * The door does NOT create a trip: account creation and trip creation are separate acts
 * (trip creation lives on `/trips`).
 *
 * `?trip=` INVITATION: an unidentified visitor opening a share link has the pending Trip
 * Token read straight off the URL here (the door is on the same page as the link) and HELD; on
 * completion of (a) or (b) we `joinTrip(pending)` BEFORE the reload and land on `/` — the join IS
 * the selection. `trip-join-handshake.tsx` correspondingly skips unidentified visitors: joining now
 * requires a login, so the door owns that case.
 *
 * ALWAYS-ON + DORMANT-SAFE: this shows in EVERY build, and imports ONLY pure
 * modules (token-auth · gateway · trips/registry · trip-data · countdown · the show-once view) and
 * NEVER firebase — no lookup, no push at the door. `subscribeTripList`'s existing absent-first-
 * snapshot seed / present-snapshot merge does the remote work AFTER the reload.
 *
 * A11y reuses the modal contract VERBATIM: role="dialog" aria-modal aria-labelledby
 * aria-describedby, document-level Esc, a Tab-trap inside the panel, autofocus on the first field
 * (re-asserted when the form changes). Intentional DIVERGENCES — it is a WALL, not a dismissible
 * modal: NON-dismissible (no overlay-click-close, no X, Esc does not dismiss); no error state (a
 * submit is simply disabled until its fields are non-empty); no focus-return-to-trigger.
 *
 * Motion uses the lightweight `m.*` only; reduced motion is honored by
 * the global <MotionConfig reducedMotion="user">. Tailwind classes are static literals; the
 * card is sized to never overflow @360/390/414. Countdown reuses the shared pure helper.
 */

export default function TokenGate() {
  const { traveler } = useActiveTraveler();

  // SSR-safe first paint: `useActiveTraveler` yields the inert `{traveler:null}` snapshot on the
  // server and the first client render, which would spuriously show the wall for EVERYONE for one
  // frame. Gate on a post-mount flag.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  /**
   * the wall must OUTLIVE `signIn`. Every identified path signs in *before* it is finished
   * with the user — path (b) still owes them the show-once screen, and both paths still owe a full
   * reload. `signIn` dispatches identity:changed, so without this hold the derived `show` would
   * drop mid-flow and dissolve the wall (flashing the app behind, and unmounting the show-once
   * screen outright). The wall itself sets this before it touches identity, and only a navigation
   * ever clears it.
   */
  const [held, setHeld] = useState(false);

  const show = mounted && (held || !traveler);

  return (
    <AnimatePresence>{show && <TokenGateWall onHold={() => setHeld(true)} />}</AnimatePresence>
  );
}

type Mode = 'login' | 'create';
/**: the wall opens on the marketing landing; a CTA swaps it to the auth card. */
type View = 'landing' | 'auth';

function TokenGateWall({ onHold }: { onHold: () => void }) {
  const [view, setView] = useState<View>('landing');
  /**
   * (INTAKE-03) — the auth card ALWAYS opens on "Log in".
   *
   * It used to be `getSyncCode() ? 'login': 'create'`, i.e. a device with no stored User Token
   * got the signup form. That read "first-timer default" but measured as "everyone in a private
   * window", which is the whole of the reported problem: a RETURNING user whose device never has a
   * stored key. The key-derived guess only ever helped a device that had already synced — and
   * that device gets 'login' under this rule too, so nothing is lost.
   *
   * Signup is untouched and one click away: the mode toggle below is always rendered, and the
   * landing keeps two "Create an account" CTAs.
   *
   * No longer needs an initializer function (it is a constant), so there is nothing client-only
   * left in it — but `TokenGateWall` still only ever mounts client-side, via the parent's
   * `mounted` gate.
   */
  const [mode, setMode] = useState<Mode>('login');
  const [userToken, setUserToken] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  /** Non-null once path (b) has minted + persisted: the wall becomes the show-once screen. */
  const [minted, setMinted] = useState<string | null>(null);
  /** This device's stored User Token, offered as a one-tap convenience. */
  const [savedToken, setSavedToken] = useState<string | null>(null);
  /** A pending Trip Token from a `?trip=` invitation, joined after login/create. */
  const [pendingTrip, setPendingTrip] = useState<string | null>(null);

  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descId = `${baseId}-desc`;
  const tokenFieldId = `${baseId}-user-token`;
  const nameFieldId = `${baseId}-name`;

  const panelRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // Storage + URL are client-only facts; read once after mount (this island never SSRs its values).
  useEffect(() => {
    setSavedToken(getSyncCode());
    const raw = new URLSearchParams(window.location.search).get('trip');
    const t = raw?.trim();
    if (t) setPendingTrip(t);
  }, []);

  // Focus the first field on open and whenever the form swaps (login ⇄ create); re-assert shortly
  // after in case the open animation steals focus, but only if focus isn't
  // already in the panel. Skipped once the show-once screen is up — it autofocuses its own control.
  // the landing view has no field, but it still MUST take focus. The Tab-trap below is
  // an `onKeyDown` on the panel, so it only engages once focus is already inside — leaving focus on
  // <body> let the very first Tab walk straight out of the wall into the page mounted behind it
  // (caught by `e2e/login.spec.ts`, "Tab never escapes the wall"). Landing on the primary CTA is
  // also the standard aria-modal entry: the dialog's labelledby/describedby announce the H1 and the
  // lead paragraph on entry, so nothing is skipped.
  // 🔴: `querySelector('button:not([disabled])')` is DOM-ORDER-SENSITIVE, and that is now
  // load-bearing — it is the mechanism that puts entry focus on `landing-cta-login`, which is the
  // first button in `landing-page.tsx`'s hero. Inserting any button above it in the panel moves
  // the front door's focus. Pinned by `document.activeElement` assertions in
  // `lib/__tests__/s345-front-door.test.ts` and `e2e/login.spec.ts`.
  useEffect(() => {
    if (minted) return;
    const timer = setTimeout(() => {
      const panel = panelRef.current;
      if (panel && !panel.contains(document.activeElement)) {
        const target =
          view === 'landing'
            ? panel.querySelector<HTMLElement>('button:not([disabled])')
            : firstFieldRef.current;
        target?.focus();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [mode, minted, view]);

  // WALL DIVERGENCE: Esc is captured at the document level so it never falls through to
  // anything behind the wall, but it does NOT dismiss — the wall is the front door.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Lightweight Tab-trap inside the panel (no new deps), identical to name-prompt. Queried
  // at keydown time, so it follows the panel's current contents (login / create / show-once).
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.offsetParent !== null || el === document.activeElement);

    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement;

    if (e.shiftKey) {
      if (active === first || !panel.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  /**
   * The single exit for every identified path: adopt a pending invitation (the join IS the
   * selection, so that lands Home), otherwise land on `/trips/` — the requested landing, and where the
   * three trip actions live. FULL reload either way: the provider re-hydrates with the new
   * identity and its trip-list subscribe re-arms with the User Token present.
   */
  const finish = () => {
    if (pendingTrip) {
      joinTrip(pendingTrip);
      window.location.replace(withBasePath('/'));
      return;
    }
    window.location.replace(withBasePath('/trips/'));
  };

  /** Path (a) — log in with the USER token ONLY (decision 2026-07-30). */
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const token = userToken.trim();
    if (!token) return;
    setBusy(true);
    onHold();
    setSyncCode(token); // key 28 — the account credential (Trip Tokens never come here)
    // The door no longer collects a name: reuse this device's saved display name, else default
    // (renamable in Settings → Identity). `signIn` needs a non-empty name — it IS the identity slot.
    // the default is a TRANSIENT placeholder — the account-identity reconciler in
    // itinerary-provider replaces it with the account's real name after this reload. The door
    // itself stays firebase-free and issues no identity read or write.
    const stored = getUserName()?.trim();
    const who = stored || DEFAULT_TRAVELER_NAME;
    if (!signIn(who)) {
      setBusy(false);
      return;
    }
    // A5: when the name truly defaulted to "Traveler" (nothing stored), leave a one-shot
    // cross-reload flag. The provider consumes it after the reload and nudges the traveler to
    // rename themselves — otherwise they're never told their edits are attributed to "Traveler".
    // (`signIn` above has since written "Traveler" into the slot, so capture `stored` pre-sign-in.)
    if (!stored) sessionStorage.setItem('name-hint', '1');
    finish();
  };

  /** Path (b) — create an account: mint, persist, then SHOW ONCE before anything navigates. */
  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const who = name.trim();
    if (!who) return;
    setBusy(true);
    onHold();
    const token = crypto.randomUUID();
    setSyncCode(token);
    if (!signIn(who)) {
      setBusy(false);
      return;
    }
    setMinted(token); // the wall becomes the show-once screen; `finish` runs on its confirm
  };

  const canSubmit = mode === 'login' ? !!userToken.trim() : !!name.trim();

  return (
    <m.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      // Full-screen WALL. NO onClick-to-close (divergence): clicks on the backdrop do nothing.
      // z-[70] sits above name-prompt's z-[60].
      // merge seam: `bg-aurora animate-aurora` removed — deleted both
      // declarations from globals.css along with the rest of the ambient decoration, and
      // this file was fenced to the lane at the time, so its engineer could not follow.
      // Left in place they were class names resolving to no CSS. `hero-gradient` stays and
      // still paints the wall, so this flattens the backdrop rather than blanking it.
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-6 overflow-y-auto hero-gradient"
    >
      <m.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onKeyDown={handleKeyDown}
        initial={{ scale: 0.94, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0, y: -8 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className={`relative w-full glass-card-dark rounded-3xl p-6 sm:p-8 shadow-2xl my-auto ${
          view === 'landing' ? 'max-w-5xl' : 'max-w-md'
        }`}
      >
        {/* The `?trip=` invitation acknowledgement. hoists it ABOVE the view switch so an
            invitee sees it the moment they arrive, not only after they pick a path — the landing
            is where they actually land. Suppressed on the show-once screen, which owes them one
            thing at a time. */}
        {pendingTrip && !minted && (
          <p
            data-testid="token-gate-invite"
            className="mb-4 rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-xs leading-relaxed text-white/70"
          >
            Someone shared a trip with you. Log in or create an account and we&rsquo;ll add it to
            your trips.
          </p>
        )}

        {view === 'landing' ? (
          <LandingPage
            titleId={titleId}
            descId={descId}
            onCreate={() => {
              setMode('create');
              setView('auth');
            }}
            onLogin={() => {
              setMode('login');
              setView('auth');
            }}
            // "Someone shared a trip with me" names no path, so it DELIBERATELY inherits the mode
            // default above — which is now 'login' for every device.
            //
            // 🔴 DO NOT "make this explicit" with a `setMode('login')`. tried exactly that and
            // measured the consequence: the other two CTAs already set the mode, so this is the ONE
            // path that ever reads the initializer. Setting it here makes the initializer
            // unreachable dead code AND silently turns A1 in `lib/__tests__/s345-front-door.test.ts`
            // vacuous — sabotaging the initializer back to the old `getSyncCode() ? …: 'create'`
            // still ran 9/9 green. Leaving the inheritance is what keeps the default observable.
            onJoin={() => setView('auth')}
          />
        ) : (
          /* ── The boarding-pass AUTH card: the wall's second view. Unchanged from apart
                from the "your key" rename — this change moves it behind a CTA, it does not
                rewrite it. Kept inline (NOT extracted into an inner component) on purpose: an
                inner function component is a new type on every parent render, which would
                remount the inputs on every keystroke. ── */
          <>
        {/* Boarding-pass header: ticket-stub iconography + trip title. */}
        <div className="flex items-center gap-3 mb-1">
          <span
            className="shrink-0 inline-flex items-center justify-center w-11 h-11 rounded-2xl bg-muted/40 text-foreground"
            aria-hidden="true"
          >
            <Plane className="w-6 h-6 -rotate-12" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.22em] text-white/40 font-medium">
              Boarding Pass
            </p>
            <h2
              id={titleId}
              className="font-display text-xl sm:text-2xl font-bold text-white leading-tight truncate"
            >
              Nepal <span className="text-display-emphasis">×</span> Japan Journey
            </h2>
          </div>
        </div>

        {/* Compact live countdown to departure. */}
        <div className="mt-4 mb-5">
          <CompactCountdown />
        </div>

        {/* Perforation line — the boarding-pass tear. Decorative, no layout box of its own. */}
        <div className="relative my-5" aria-hidden="true">
          <div className="border-t border-dashed border-white/15" />
        </div>

        {minted ? (
          <>
            <p id={descId} className="text-sm text-white/55 mb-4 leading-relaxed">
              Your account is ready, {name.trim()}. One thing left.
            </p>
            <UserTokenShowOnce token={minted} onConfirm={finish} />
          </>
        ) : (
          <>
            <p id={descId} className="text-sm text-white/55 mb-4 leading-relaxed">
              Log in with your key to reach your trips, or create an account.
            </p>

            {/* Path switch. Two plain buttons with aria-pressed — no roving-tabindex tablist needed
                for a two-way toggle that swaps a form (each stays individually tabbable). */}
            <div className="mb-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode('login')}
                aria-pressed={mode === 'login'}
                disabled={busy}
                data-testid="token-gate-mode-login"
                className={`min-h-[44px] rounded-xl border px-3 py-2 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
                  mode === 'login'
                    ? 'border-ring/60 bg-primary/10 text-primary'
                    : 'border-white/15 text-white/70 hover:bg-white/5'
                }`}
              >
                Log in
              </button>
              <button
                type="button"
                onClick={() => setMode('create')}
                aria-pressed={mode === 'create'}
                disabled={busy}
                data-testid="token-gate-mode-create"
                className={`min-h-[44px] rounded-xl border px-3 py-2 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
                  mode === 'create'
                    ? 'border-ring/60 bg-primary/10 text-primary'
                    : 'border-white/15 text-white/70 hover:bg-white/5'
                }`}
              >
                Create an account
              </button>
            </div>

            <form onSubmit={mode === 'login' ? handleLogin : handleCreate}>
              {mode === 'login' && (
                <>
                  <label htmlFor={tokenFieldId} className="text-xs text-white/50 mb-1.5 block">
                    Your key
                  </label>
                  <div className="relative">
                    <KeyRound
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/35"
                      aria-hidden="true"
                    />
                    <input
                      id={tokenFieldId}
                      ref={firstFieldRef}
                      value={userToken}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUserToken(e.target.value)}
                      autoComplete="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      readOnly={busy}
                      placeholder="Paste your key"
                      data-testid="token-gate-user-token"
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white font-mono text-sm placeholder:text-white/30 placeholder:font-sans focus:outline-none focus:ring-2 focus:ring-ring focus-visible:ring-2"
                    />
                  </div>
                  {savedToken !== null && savedToken !== userToken && (
                    <button
                      type="button"
                      onClick={() => setUserToken(savedToken)}
                      disabled={busy}
                      data-testid="token-gate-use-saved"
                      className="mt-2 text-xs text-primary hover:text-primary/80 underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring rounded disabled:opacity-50"
                    >
                      Use this device&rsquo;s saved key
                    </button>
                  )}
                </>
              )}

              {/* Name is collected ONLY when creating an account (decision 2026-07-30 — login is token-
                  only). On login the display name is reused from the device / defaults, not asked. */}
              {mode === 'create' && (
                <>
                  <label htmlFor={nameFieldId} className="text-xs text-white/50 mb-1.5 block">
                    Your name
                  </label>
                  <div className="relative">
                    <User
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/35"
                      aria-hidden="true"
                    />
                    <input
                      id={nameFieldId}
                      ref={firstFieldRef}
                      value={name}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
                      maxLength={24}
                      autoComplete="off"
                      autoCapitalize="words"
                      spellCheck={false}
                      readOnly={busy}
                      placeholder="Enter your name"
                      data-testid="token-gate-name"
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-ring focus-visible:ring-2"
                    />
                  </div>
                </>
              )}

              <button
                type="submit"
                disabled={!canSubmit || busy}
                data-testid="token-gate-submit"
                className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none"
              >
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
                {mode === 'login' ? 'Log in' : 'Create account'}
              </button>

              {/* The never-mix guard, in copy: each form names the OTHER token and where it
                  goes. There is nothing to validate — both are UUIDs and the door is offline. */}
              <p className="mt-3 text-xs leading-relaxed text-white/45">
                {mode === 'login'
                  ? 'Your key is your account — it opens every trip you have. A Trip Token is not a login: add one from your Trips page after you log in.'
                  : 'We’ll make your key — the one way back into your account — and show it to you once. Trips (and their Trip Tokens) come next, on your Trips page.'}
              </p>
            </form>
          </>
        )}
          </>
        )}
      </m.div>
    </m.div>
  );
}

/**
 * Compact live countdown for the boarding pass. Ticks once a second so HH:MM:SS stays truthful; the
 * math is the shared pure helper vs TRIP_START. Mount-gated so SSR and first client paint
 * agree (no hydration mismatch — value starts null).
 */
function CompactCountdown() {
  const [cd, setCd] = useState<Countdown | null>(null);

  useEffect(() => {
    const tick = () => setCd(computeCountdown(TRIP_START, new Date()));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  // Reserve height before hydration so the card doesn't jump (no layout shift / overflow).
  if (!cd) return <div className="h-[58px]" aria-hidden="true" />;

  const units: { label: string; value: number }[] = cd.isPast
    ? [{ label: 'Status', value: 0 }]
    : [
        { label: 'Mo', value: cd.months },
        { label: 'Wk', value: cd.weeks },
        { label: 'Day', value: cd.days },
        { label: 'Hr', value: cd.hours },
        { label: 'Min', value: cd.minutes },
        { label: 'Sec', value: cd.seconds },
      ];

  if (cd.isPast) {
    return (
      <p className="text-sm font-medium text-foreground text-center" role="status">
        The journey has begun.
      </p>
    );
  }

  return (
    <div role="status" aria-label={`Departure in ${cd.totalDays} days`}>
      <div className="grid grid-cols-6 gap-1.5">
        {units.map((u) => (
          <div
            key={u.label}
            className="flex flex-col items-center rounded-lg bg-white/5 border border-white/10 py-1.5"
          >
            <span className="font-mono text-base sm:text-lg font-bold text-white tabular-nums leading-none">
              {String(u.value).padStart(2, '0')}
            </span>
            <span className="mt-0.5 text-[9px] uppercase tracking-wider text-white/40">
              {u.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
