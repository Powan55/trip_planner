'use client';

import { useState, useEffect, useRef, useId } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { m, AnimatePresence } from 'framer-motion';
import { Plane, Lock, ArrowRight, ArrowLeft, Check } from 'lucide-react';
import { signIn, IDENTITY_CHANGED_EVENT, type Traveler } from '@/lib/token-auth';
import { sessionGate } from '@/core/storage/gateway';
import { useActiveTraveler } from '@/hooks/use-active-traveler';
import { isRouteActive } from '@/lib/nav-items';
import { TRIP_START } from '@/lib/trip-data';
import { computeCountdown, type Countdown } from '@/lib/countdown';

/**
 * Trip Token landing gate — the app's cinematic
 * "front door." A full-screen WALL that gates the whole app: a traveler enters any
 * nickname to sign in, OR clicks
 * "Explore as guest" to browse local-only. Once a non-empty nickname resolves, `signIn`
 * persists the display name via the existing identity pipeline (lib/token-auth →
 * lib/identity), so attribution (createdBy / updatedBy, "last edited by X") needs ZERO
 * changes downstream.
 *
 * TWO MODES — ONE component, ONE mount, mode derived here from
 * `useActiveTraveler()` + `usePathname()`:
 * - 'front-door' (`!traveler && !isGuest`): today's behavior — copy + "Explore as guest".
 * - 'guest-route' (`traveler === null && isGuest && !isRouteActive(pathname,'/')`): a
 * guest is confined to Home; on ANY other route the same wall appears with guest-route
 * copy and a "Back to Home" escape. Default-deny by pathname — zero per-route work,
 * no new persisted key (the decision is derived, never stored). The panel/form/a11y
 * below are shared VERBATIM; only the desc copy + the secondary control differ.
 * Two invariants: a guest-route sign-in ALSO clears the guest flag (token + guest must
 * never coexist, else a later sign-out lands in guest mode not the front door); and a
 * front-door "Explore as guest" on a non-Home path also navigates Home (else it would
 * instantly re-trigger guest-route — a dead end).
 *
 * ALWAYS-ON: unlike name-prompt, this shows in EVERY build (dormant or synced)
 * — it is a client-only product feature, not a sync prompt. The guest bypass keeps the
 * public/portfolio demo viewable. It is DORMANT-SAFE: it imports ONLY pure modules
 * (token-auth + identity + trip-data + countdown) and NEVER firebase, so the dormant
 * bundle loads no Firebase chunk.
 *
 * A11y reuses the modal contract from name-prompt VERBATIM:
 * - role="dialog" aria-modal aria-labelledby aria-describedby
 * - document-level Esc via an onCloseRef (latest-closure, bound once)
 * - a lightweight Tab-trap inside the panel
 * - autofocus the nickname input on open
 * Intentional DIVERGENCES — it is a WALL, not a dismissible modal (flagged at review):
 * - signed-out: NON-dismissible — NO overlay-click-close, NO X button, Esc does NOT
 * dismiss. The ONLY ways past are a non-empty nickname or "Explore as guest".
 * - no error state: any non-empty nickname succeeds, so the old
 * "doesn't match a traveler" branch is unreachable and removed; the submit button is
 * simply disabled while the input is empty (the pre-existing empty-guard).
 * - no focus-return-to-trigger (it's the front door, not triggered) — on unlock we let
 * focus fall to the body so keyboard users land in the revealed app naturally.
 *
 * Motion uses the lightweight `m.*` only (LazyMotion `strict` — `motion.*` throws,
 *); reduced-motion is honored via <MotionConfig reducedMotion="user"> (declarative
 * framer auto-gates) plus the global reduced-motion CSS for the backdrop shimmer
 * Tailwind
 * classes are static literals; the card is sized to never overflow @360/390/414
 * Countdown reuses the shared pure helper vs TRIP_START.
 */

// the `tripPlannerGuest` key + raw localStorage access live in the
// typed storage gateway (`core/storage/gateway.ts`). `setGuest`/`clearGuest` here delegate
// to `sessionGate` (SSR-safe, never-throw, `'1'` presence-flag unchanged); the guest read
// now flows through `useActiveTraveler()`. The guest OPT-IN still fires
// identity:changed so the navbar affordance updates live — that reactive dispatch is app
// logic, NOT storage, so it stays here.

/** Persist the guest choice so a reload does NOT re-show the wall (documented design). */
function setGuest(): void {
  sessionGate.setGuest();
  // Reactive signal: opting into guest IS an identity-state change. Dispatching
  // identity:changed lets the navbar surface the "Guest · Sign in" affordance LIVE (no
  // reload) — same event the gate / chip / remote-subscribe already listen on.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(IDENTITY_CHANGED_EVENT));
  }
}

type GateMode = 'front-door' | 'guest-route';

export default function TokenGate() {
  // Reactive identity + pathname drive the mode. `useActiveTraveler`
  // re-reads on `identity:changed` / `storage`; `usePathname` re-reads on navigation —
  // so sign-in, guest opt-in, sign-out, and every route change re-evaluate LIVE without
  // a manual listener or a reload. Both are firebase-free.
  const { traveler, isGuest } = useActiveTraveler();
  const pathname = usePathname();

  // SSR-safe first paint: `useActiveTraveler` yields the inert `{null,false}` snapshot on
  // the server and the first client render, which would spuriously satisfy 'front-door'
  // for EVERYONE for one frame. Gate on a post-mount flag so the wall never flashes for a
  // signed-in/guest user before storage is read.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  let mode: GateMode | null = null;
  if (mounted) {
    if (!traveler && !isGuest) mode = 'front-door';
    else if (traveler === null && isGuest && !isRouteActive(pathname, '/')) mode = 'guest-route';
  }

  // The wall dissolves purely by mode → null: a valid token sets `traveler` (both modes),
  // "Explore as guest" sets `isGuest` (+ navigates Home so guest-route never re-triggers),
  // "Back to Home" changes the pathname. Each drops `mode` to null and AnimatePresence
  // plays the exit — the accent-flash `unlocked` state rides through that exit frame.
  return (
    <AnimatePresence>
      {mode && <TokenGateWall key={mode} mode={mode} />}
    </AnimatePresence>
  );
}

function TokenGateWall({ mode }: { mode: GateMode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState('');
  // The resolved traveler drives a brief accent-flash micro-animation before dissolve.
  const [unlocked, setUnlocked] = useState<Traveler | null>(null);

  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descId = `${baseId}-desc`;
  const fieldId = `${baseId}-nickname`;

  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the token input on open; re-assert shortly after in case the open animation
  // steals focus, but only if focus isn't already in the panel.
  useEffect(() => {
    const timer = setTimeout(() => {
      const panel = panelRef.current;
      if (panel && !panel.contains(document.activeElement)) {
        inputRef.current?.focus();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  // WALL DIVERGENCE: Esc is captured at the document level so it never falls
  // through to anything behind the wall, but it does NOT dismiss — the wall is the front
  // door and only a valid token or the guest link gets past. (Mirrors name-prompt's
  // once-bound document listener, minus the close.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Lightweight Tab-trap inside the panel (no new deps), identical to name-prompt.
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (unlocked) return; // already unlocking
    const traveler = signIn(value);
    if (!traveler) {
      // Only an empty/whitespace input fails now (the submit is already disabled while
      // empty; this guards an Enter-key submit). Keep the wall + re-focus, no error copy.
      inputRef.current?.focus();
      return;
    }
    // INVARIANT (a): a guest-route sign-in must ALSO clear the guest flag so a token
    // and the guest flag never coexist — otherwise a later signOut() would drop the
    // traveler into guest mode instead of the front door. `signIn` already persisted the
    // token + emitted identity:changed above; clearing here (after a confirmed valid token,
    // never on an invalid one) leaves storage consistent before the parent re-derives mode.
    if (mode === 'guest-route') sessionGate.clearGuest();
    // Accent-flash, then the wall dissolves: `signIn` set `traveler` (and cleared guest),
    // so the parent's derived mode drops to null and AnimatePresence plays the exit with
    // this `unlocked` state still committed (the "Welcome, {name}" glow rides the fade out).
    setUnlocked(traveler);
  };

  // Secondary actions differ by mode (copy/behavior below); both keep the wall otherwise
  // non-dismissible (no overlay-click, no X, Esc captured-but-inert).
  const handleGuest = () => {
    setGuest(); // sessionGate.setGuest() + identity:changed (navbar affordance updates live)
    // INVARIANT (b): opting into guest from a NON-Home path must also navigate Home,
    // else the wall would instantly re-trigger in guest-route mode (a dead end).
    if (!isRouteActive(pathname, '/')) router.push('/');
  };
  const handleBackHome = () => router.push('/'); // guest flag untouched; pathname → '/' dissolves the wall

  return (
    <m.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      // Full-screen WALL. NO onClick-to-close (divergence): clicks on the backdrop do
      // nothing. z-[70] sits above name-prompt's z-[60].
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-6 overflow-y-auto hero-gradient bg-aurora animate-aurora"
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
        className="relative w-full max-w-md glass-card-dark rounded-3xl p-6 sm:p-8 shadow-2xl my-auto"
        style={
          unlocked
            ? ({ boxShadow: `0 0 0 1px ${unlocked.accent}55, 0 0 48px ${unlocked.accent}40` } as React.CSSProperties)
            : undefined
        }
      >
        {}/* Boarding-pass header: ticket-stub iconography + trip title. */
        <div className="flex items-center gap-3 mb-1">
          <span
            className="shrink-0 inline-flex items-center justify-center w-11 h-11 rounded-2xl bg-gold-500/15 text-gold-400"
            style={unlocked ? { color: unlocked.accent } : undefined}
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
              Nepal <span className="text-gradient-gold">×</span> Japan Journey
            </h2>
          </div>
        </div>

        {}/* Compact live countdown to departure. */
        <div className="mt-4 mb-5">
          <CompactCountdown />
        </div>

        {}/* Perforation line — the boarding-pass tear. Decorative, no layout box of its own. */
        <div className="relative my-5" aria-hidden="true">
          <div className="border-t border-dashed border-white/15" />
        </div>

        <p id={descId} className="text-sm text-white/55 mb-4 leading-relaxed">
          {mode === 'guest-route' ? (
            <>
              This page is for the travelers. Enter your name to unlock the full
              itinerary, or head back to the home screen.
            </>
          ) : (
            <>
              Enter your name to sign in and have your edits attributed to you — or
              explore as a guest for local-only browsing.
            </>
          )}
        </p>

        <form onSubmit={handleSubmit}>
          <label htmlFor={fieldId} className="text-xs text-white/50 mb-1.5 block">
            Your name
          </label>
          <div className="relative">
            <Lock
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/35"
              aria-hidden="true"
            />
            <input
              id={fieldId}
              ref={inputRef}
              value={value}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setValue(e.target.value);
              }}
              maxLength={24}
              autoComplete="off"
              autoCapitalize="words"
              spellCheck={false}
              disabled={!!unlocked}
              placeholder="Enter your name"
              className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-gold-400 focus-visible:ring-2 disabled:opacity-60"
            />
          </div>

          <button
            type="submit"
            disabled={!value.trim() || !!unlocked}
            className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gold-500 text-surface font-semibold hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none"
          >
            {unlocked ? (
              <>
                <Check className="w-4 h-4" aria-hidden="true" />
                Welcome, {unlocked.name}
              </>
            ) : (
              <>
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
                Unlock
              </>
            )}
          </button>
        </form>

        {}/* Secondary control — differs by mode. */
        {mode === 'guest-route' ? (
          // "Back to Home": the guest's escape hatch. A REAL focusable control ≥44px
          // — full-width ghost button, not a quiet text link.
          <div className="mt-4">
            <button
              type="button"
              onClick={handleBackHome}
              disabled={!!unlocked}
              className="w-full flex items-center justify-center gap-2 min-h-[44px] px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm text-white/70 font-medium hover:bg-white/10 hover:text-white transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none disabled:opacity-50"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              Back to Home
            </button>
          </div>
        ) : (
          // Quiet secondary: explore as guest (local-only). Reachable by keyboard.
          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={handleGuest}
              disabled={!!unlocked}
              className="text-xs text-white/45 hover:text-white/70 underline underline-offset-4 decoration-white/20 hover:decoration-white/40 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none rounded disabled:opacity-50"
            >
              Explore as guest
            </button>
          </div>
        )}
      </m.div>
    </m.div>
  );
}

/**
 * Compact live countdown for the boarding pass. Ticks once a second so HH:MM:SS stays
 * truthful; the math is the shared pure helper vs TRIP_START. Mount-gated so SSR
 * and first client paint agree (no hydration mismatch — value starts null).
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
      <p className="text-sm font-medium text-gold-300 text-center" role="status">
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
            <span className="font-display text-base sm:text-lg font-bold text-white tabular-nums leading-none">
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
