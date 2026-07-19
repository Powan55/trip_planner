'use client';

import { useState, useEffect, useRef, useId } from 'react';
import { usePathname } from 'next/navigation';
import { m, AnimatePresence } from 'framer-motion';
import { X, ArrowRight, ArrowLeft, Home, Calendar, Wallet, BookOpen, Map, Sparkles } from 'lucide-react';
import { useActiveTraveler } from '@/hooks/use-active-traveler';
import { tourStore } from '@/core/storage/gateway';
import { NAV_ITEMS, isRouteActive, type NavItem } from '@/lib/nav-items';

/**
 * First-run guided tour — a one-time, ≤5-step coach-mark stepper introducing the
 * app's five key destinations (Today · Plan · Budget · Journal · Map), shown exactly once
 * per browser right after the TokenGate resolves.
 *
 * MOUNT SEAM: a sibling of `<TokenGate />` in `itinerary-provider.tsx` (present on every
 * route behind the gate). Gate-passed signal MIRRORS TOKENGATE'S OWN RESOLVED "wall is
 * down" condition exactly (not just `traveler || isGuest` in isolation): a traveler passes
 * on every route, but a GUEST only passes on Home — everywhere else the
 * guest-route wall is still up. Using the looser `traveler || isGuest` check would render
 * this dialog UNDERNEATH TokenGate's still-active wall on a guest's gated route (two
 * `role="dialog"` nodes at once — caught by `e2e/guest-route-gate.spec.ts`'s generic wall
 * locator during this slice's own full-pack run). `isRouteActive(pathname, '/')` is the
 * exact same helper `token-gate.tsx` uses for its own mode derivation. Post-mount gated
 * (the `mounted` flag, exactly like TokenGate) so the tour never flashes during SSR/first
 * paint.
 *
 * DESIGN CHOICE: a CENTERED STEPPER dialog ("1 of 5",
 * Back/Next, always-visible Skip) — not a pixel-anchored spotlight overlay on live nav
 * elements. A spotlight would need per-breakpoint element geometry (desktop top row vs.
 * mobile tab bar/hamburger have DIFFERENT DOM for the same destination, and Budget has NO
 * nav element at all — it's a section on `/plan`, see below) — brittle for a one-time,
 * low-stakes intro. A centered card is simpler, robust across breakpoints, and still
 * teaches the five destinations. Ponytail: no tour framework, no spotlight engine.
 *
 * GUEST-COPY CALL: a guest is Home-confined —
 * they cannot actually click into Plan/Journal/Map yet, so the tour only ever fires for a
 * guest ON Home (the `gatePassed` derivation above — everywhere else the real wall is still
 * up and this dialog correctly stays dark). Where it DOES fire for a guest, it still shows
 * all 5 stops ("what's inside") rather than hiding 4 of them, because (a) it is honest — the
 * copy describes what each section DOES, not "go there now", and (b) a guest who later
 * signs in shouldn't get a different, truncated tour. This mirrors the guest-route wall's
 * own philosophy: guests see everything is here, signing in unlocks reaching it.
 *
 * BUDGET HAS NO NAV ROUTE: `lib/nav-items.ts` has no "Budget" entry — the budget panel
 * lives INSIDE `/plan` (`components/budget-panel.tsx`, mounted below the calendar). The
 * Budget stop's href therefore points at the same `/plan/` route as the Plan stop (verbatim
 * from NAV_ITEMS, so it can never drift), with copy that says so ("on the Plan page") rather
 * than implying a separate destination.
 *
 * A11Y: `role="dialog"` `aria-modal` `aria-labelledby`/`aria-describedby`, a
 * lightweight Tab-trap (verbatim idiom from `token-gate.tsx`), focus the first control on
 * open, all controls >=44px, `aria-live="polite"` step-count announcement. Keyboard: Tab
 * loops within the panel, Enter/Space activate (native button semantics), Esc = SKIP (unlike
 * the TokenGate wall, this dialog IS dismissible at every step).
 *
 * REDUCED MOTION: `m.*` only, governed by the app-wide `<MotionConfig
 * reducedMotion="user">` (`theme-provider.tsx`) already wrapping this tree — no new
 * MotionConfig needed. The ONE motion instance is the panel mount/unmount fade+scale;
 * step-to-step content swaps are a plain (non-animated) state update, so there is nothing
 * else in this component for reduced motion to have to neutralize.
 */

type TourStop = {
  key: string;
  label: string;
  href: string;
  Icon: typeof Home;
  blurb: string;
};

function hrefFor(label: string): string {
  return (NAV_ITEMS as NavItem[]).find((i) => i.label === label)?.href ?? '/';
}

const STOPS: TourStop[] = [
  {
    key: 'today',
    label: 'Today',
    href: hrefFor('Home'),
    Icon: Home,
    blurb:
      'Your trip at a glance — a live countdown, the in-trip daily agenda, weather and golden hour, and your day’s journal prompt once you’re on the road.',
  },
  {
    key: 'plan',
    label: 'Plan',
    href: hrefFor('Plan'),
    Icon: Calendar,
    blurb:
      'Build the day-by-day itinerary across all 32 days in Nepal and Japan — add, edit, and drag to reorder, then back up your plan any time.',
  },
  {
    key: 'budget',
    label: 'Budget',
    href: hrefFor('Plan'),
    Icon: Wallet,
    blurb:
      'Set a budget per leg and category, log expenses on the go, and track your pace against plan — right on the Plan page, below the calendar.',
  },
  {
    key: 'journal',
    label: 'Journal',
    href: hrefFor('Journal'),
    Icon: BookOpen,
    blurb: 'A private day-by-day journal for the trip — mood, highlights, and notes, saved on this device.',
  },
  {
    key: 'map',
    label: 'Map',
    href: hrefFor('Map'),
    Icon: Map,
    blurb: 'See every saved stop on an interactive map, filter by category, and follow your itinerary visually.',
  },
];

export default function FirstRunTour() {
  const { traveler, isGuest } = useActiveTraveler();
  const pathname = usePathname();

  // SSR-safe first paint: same post-mount gate as TokenGate — otherwise the inert
  // {traveler:null,isGuest:false} server snapshot would never satisfy the show condition,
  // but a stray flash could still occur on the very first client frame before storage is
  // read. Gating on `mounted` matches the existing, proven idiom exactly.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  // "Gate passed" = TokenGate itself would render NOTHING right now (see the file-header
  // note): a traveler passes everywhere; a guest passes ONLY on Home.
  const gatePassed = !!traveler || (isGuest && isRouteActive(pathname, '/'));

  // Decide ONCE per mount, after the gate has resolved: gate passed AND not yet seen.
  useEffect(() => {
    if (!mounted) return;
    if (!gatePassed) return;
    if (tourStore.hasSeenTour()) return;
    setOpen(true);
  }, [mounted, gatePassed]);

  function finish() {
    tourStore.markTourSeen();
    setOpen(false);
  }

  function handleNext() {
    if (step >= STOPS.length - 1) {
      finish();
      return;
    }
    setStep((s) => s + 1);
  }

  function handleBack() {
    setStep((s) => Math.max(0, s - 1));
  }

  return (
    <AnimatePresence>
      {open && (
        <TourPanel
          step={step}
          total={STOPS.length}
          stop={STOPS[step]}
          onNext={handleNext}
          onBack={handleBack}
          onSkip={finish}
        />
      )}
    </AnimatePresence>
  );
}

function TourPanel({
  step,
  total,
  stop,
  onNext,
  onBack,
  onSkip,
}: {
  step: number;
  total: number;
  stop: TourStop;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descId = `${baseId}-desc`;

  const panelRef = useRef<HTMLDivElement>(null);
  const skipRef = useRef<HTMLButtonElement>(null);

  // Focus the Skip control on open (the dialog's first real focusable control, mirroring
  // TokenGate's autofocus-on-open contract).
  useEffect(() => {
    const timer = setTimeout(() => {
      const panel = panelRef.current;
      if (panel && !panel.contains(document.activeElement)) {
        skipRef.current?.focus();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  // Esc = skip (dismissible at every step, unlike the TokenGate wall).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onSkip();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onSkip]);

  // Lightweight Tab-trap inside the panel — identical idiom to token-gate.tsx / name-prompt.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
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

  const isLast = step === total - 1;
  const Icon = stop.Icon;

  return (
    <m.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="fixed inset-0 z-[65] flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm"
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
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        data-testid="tour-dialog"
        className="relative w-full max-w-md glass-card-dark rounded-3xl p-6 sm:p-8 shadow-2xl"
      >
        <button
          type="button"
          ref={skipRef}
          onClick={onSkip}
          aria-label="Skip tour"
          data-testid="tour-skip"
          className="absolute right-3 top-3 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-white/50 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>

        <div className="flex items-center gap-3 pr-10">
          <span
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gold-500/15 text-gold-400"
            aria-hidden="true"
          >
            <Icon className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <p
              className="text-[11px] uppercase tracking-[0.22em] text-white/40 font-medium"
              aria-live="polite"
              data-testid="tour-progress"
            >
              Step {step + 1} of {total}
            </p>
            <h2 id={titleId} className="font-display text-xl font-bold leading-tight text-white">
              {stop.label}
            </h2>
          </div>
        </div>

        <p id={descId} className="mt-4 text-sm leading-relaxed text-white/70" data-testid="tour-desc">
          {stop.blurb}
        </p>

        {}/* Progress dots — decorative only, the "Step N of M" text above is the accessible source. */
        <div className="mt-5 flex items-center gap-1.5" aria-hidden="true">
          {Array.from({ length: total }).map((_, i) => (
            <span
              key={i}
              className={
                i === step
                  ? 'h-1.5 w-5 rounded-full bg-gold-400'
                  : 'h-1.5 w-1.5 rounded-full bg-white/20'
              }
            />
          ))}
        </div>

        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBack}
            disabled={step === 0}
            data-testid="tour-back"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-white/60 outline-none transition-colors hover:text-white disabled:opacity-30 disabled:pointer-events-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </button>

          <button
            type="button"
            onClick={onNext}
            data-testid="tour-next"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-gold-500 px-5 py-2.5 font-semibold text-surface outline-none transition-colors hover:bg-gold-400 focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none"
          >
            {isLast ? (
              <>
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                Let&rsquo;s go
              </>
            ) : (
              <>
                Next
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      </m.div>
    </m.div>
  );
}
