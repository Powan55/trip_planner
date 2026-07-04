'use client';

import { useState, useEffect, useRef, useId } from 'react';
import { m, AnimatePresence } from 'framer-motion';
import { Plane, Lock, ArrowRight, AlertCircle, Check } from 'lucide-react';
import { signIn, getActiveTraveler, IDENTITY_CHANGED_EVENT, type Traveler } from '@/lib/token-auth';
import { TRIP_START } from '@/lib/trip-data';
import { computeCountdown, type Countdown } from '@/lib/countdown';

/**
 * Trip Token landing gate — the app's cinematic
 * "front door." A full-screen WALL that gates the whole app: a traveler enters their
 * Trip Token (Powan / Sushil / Uttam) to sign in, OR clicks "Explore as guest" to
 * browse local-only. Once a token resolves, `signIn` persists the display name via the
 * existing identity pipeline (lib/token-auth → lib/identity), so attribution
 * (createdBy / updatedBy, "last edited by X") needs ZERO changes downstream.
 *
 * ALWAYS-ON: unlike name-prompt, this shows in EVERY build (dormant or synced)
 * — it is a client-only product feature, not a sync prompt. The guest bypass keeps the
 * public/portfolio demo viewable. It is DORMANT-SAFE: it imports ONLY pure modules
 * (token-auth + identity + trip-data + countdown) and NEVER firebase, so the dormant
 * bundle loads no Firebase chunk.
 *
 * A11y reuses the shared modal contract from name-prompt VERBATIM:
 *  - role="dialog" aria-modal aria-labelledby aria-describedby
 *  - document-level Esc via an onCloseRef (latest-closure, bound once)
 *  - a lightweight Tab-trap inside the panel
 *  - autofocus the token input on open
 * Intentional DIVERGENCES — it is a WALL, not a dismissible modal:
 *  - signed-out: NON-dismissible — NO overlay-click-close, NO X button, Esc does NOT
 *    dismiss. The ONLY ways past are a valid token or "Explore as guest".
 *  - invalid token → inline aria-live="polite" error; the input stays, no app access.
 *  - no focus-return-to-trigger (it's the front door, not triggered) — on unlock we let
 *    focus fall to the body so keyboard users land in the revealed app naturally.
 *
 * Motion uses the lightweight `m.*` only (LazyMotion `strict` — `motion.*` throws);
 * reduced-motion is honored via <MotionConfig reducedMotion="user"> (declarative
 * framer auto-gates) plus the global reduced-motion CSS for the backdrop shimmer
 * (.bg-aurora/.animate-aurora are already neutralized there). Tailwind
 * classes are static literals; the card is sized to never overflow @360/390/414.
 * Countdown reuses the shared pure helper vs TRIP_START (Dec 9 2026).
 */

const GUEST_KEY = 'tripPlannerGuest';

/** Has the user opted into guest (local-only) browsing this/previous session? */
function isGuest(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(GUEST_KEY) === '1';
  } catch {
    return false;
  }
}

/** Persist the guest choice so a reload does NOT re-show the wall (documented design). */
function setGuest(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(GUEST_KEY, '1');
  } catch {
    /* ignore (quota / disabled storage) */
  }
  // Reactive signal: opting into guest IS an identity-state change. Dispatching
  // identity:changed lets the navbar surface the "Guest · Sign in" affordance LIVE (no
  // reload) — same event the gate / chip / remote-subscribe already listen on.
  window.dispatchEvent(new CustomEvent(IDENTITY_CHANGED_EVENT));
}

export default function TokenGate() {
  // `false` until we've decided on the client whether to show the wall (SSR-safe:
  // getActiveTraveler / isGuest both read window). Decide once on mount.
  const [open, setOpen] = useState(false);
  const [decided, setDecided] = useState(false);

  useEffect(() => {
    // Show the wall when there is NO active traveler AND the user is not a guest.
    // A returning signed-in traveler (token persisted) or a returning guest skips it.
    if (!getActiveTraveler() && !isGuest()) {
      setOpen(true);
    }
    setDecided(true);
  }, []);

  // Reactive re-show: when identity changes — sign-out clears the
  // token, or the navbar's "Guest · Sign in" clears the guest flag — re-evaluate and
  // re-OPEN the wall without a reload. We only ever re-open here; closing on a successful
  // sign-in stays owned by the wall's own accent-flash dissolve (handleSubmit → onClose),
  // so that cinematic exit is never cut short. (Signing in is the only path that closes.)
  useEffect(() => {
    const onIdentityChanged = () => {
      if (!getActiveTraveler() && !isGuest()) setOpen(true);
    };
    window.addEventListener(IDENTITY_CHANGED_EVENT, onIdentityChanged);
    return () => window.removeEventListener(IDENTITY_CHANGED_EVENT, onIdentityChanged);
  }, []);

  const close = () => setOpen(false);

  // Nothing to render before we've decided, or once signed-in / guest (wall dismissed).
  if (!decided) return null;

  return (
    <AnimatePresence>
      {open && <TokenGateWall onClose={close} onGuest={() => { setGuest(); close(); }} />}
    </AnimatePresence>
  );
}

function TokenGateWall({
  onClose,
  onGuest,
}: {
  onClose: () => void;
  onGuest: () => void;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);
  // The resolved traveler drives a brief accent-flash micro-animation before dissolve.
  const [unlocked, setUnlocked] = useState<Traveler | null>(null);

  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descId = `${baseId}-desc`;
  const fieldId = `${baseId}-token`;
  const errId = `${baseId}-err`;

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
      setError(true);
      // keep the wall and the field; re-focus so the user can correct
      inputRef.current?.focus();
      return;
    }
    setError(false);
    // Brief accent-flash, then dissolve the wall (AnimatePresence exit on parent).
    setUnlocked(traveler);
    window.setTimeout(onClose, 850);
  };

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
        {/* Boarding-pass header: ticket-stub iconography + trip title. */}
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

        {/* Compact live countdown to departure (Dec 9 2026). */}
        <div className="mt-4 mb-5">
          <CompactCountdown />
        </div>

        {/* Perforation line — the boarding-pass tear. Decorative, no layout box of its own. */}
        <div className="relative my-5" aria-hidden="true">
          <div className="border-t border-dashed border-white/15" />
        </div>

        <p id={descId} className="text-sm text-white/55 mb-4 leading-relaxed">
          Enter your trip token to sign in and have your edits attributed to you — or
          explore as a guest for local-only browsing.
        </p>

        <form onSubmit={handleSubmit}>
          <label htmlFor={fieldId} className="text-xs text-white/50 mb-1.5 block">
            Trip token
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
                if (error) setError(false);
              }}
              maxLength={24}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              disabled={!!unlocked}
              placeholder="e.g., Powan"
              aria-invalid={error}
              aria-describedby={error ? errId : undefined}
              className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-gold-400 focus-visible:ring-2 disabled:opacity-60"
            />
          </div>

          {/* Inline error — aria-live so SR users hear it; input stays, no app access. */}
          <div className="min-h-[1.25rem] mt-1.5" aria-live="polite">
            {error && (
              <p id={errId} className="flex items-center gap-1.5 text-xs text-red-300">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                That token doesn&rsquo;t match a traveler. Try Powan, Sushil, or Uttam.
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={!value.trim() || !!unlocked}
            className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gold-500 text-navy-900 font-semibold hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900 focus-visible:outline-none"
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

        {/* Quiet secondary: explore as guest (local-only). Reachable by keyboard. */}
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={onGuest}
            disabled={!!unlocked}
            className="text-xs text-white/45 hover:text-white/70 underline underline-offset-4 decoration-white/20 hover:decoration-white/40 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none rounded disabled:opacity-50"
          >
            Explore as guest
          </button>
        </div>
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
