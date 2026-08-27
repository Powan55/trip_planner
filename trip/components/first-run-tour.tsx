'use client';

import { useState, useEffect, useRef, useId } from 'react';
import { m, AnimatePresence } from 'framer-motion';
import { differenceInCalendarDays } from 'date-fns';
import { X, ArrowRight, ArrowLeft, Home, Calendar, Wallet, BookOpen, Map, Sparkles } from 'lucide-react';
import { useActiveTraveler } from '@/hooks/use-active-traveler';
import { tourStore } from '@/core/storage/gateway';
import { NAV_ITEMS, type NavItem } from '@/lib/nav-items';
import { getActiveTrip } from '@/core/trips';
import { overlayPanelMotion } from '@/lib/motion';

/**
 * First-run guided tour — a one-time, ≤5-step coach-mark stepper introducing the
 * app's five key destinations (Today · Plan · Budget · Journal · Map), shown exactly once
 * per browser right after the TokenGate resolves.
 *
 * MOUNT SEAM: a sibling of `<TokenGate />` in `itinerary-provider.tsx` (present on every
 * route behind the gate). Gate-passed signal MIRRORS TOKENGATE'S OWN RESOLVED "wall is
 * down" condition exactly: `!!traveler`. Since deleted guest mode, the tour
 * fires only for a signed-in traveler, on whatever route they land on first. Post-mount
 * gated (the `mounted` flag, exactly like TokenGate) so the tour never flashes during
 * SSR/first paint.
 *
 * DESIGN CHOICE, stated deliberately: a CENTERED STEPPER dialog ("1 of 5",
 * Back/Next, always-visible Skip) — not a pixel-anchored spotlight overlay on live nav
 * elements. A spotlight would need per-breakpoint element geometry (desktop top row vs.
 * mobile tab bar/hamburger have DIFFERENT DOM for the same destination, and Budget has NO
 * nav element at all — it's a section on `/plan`, see below) — brittle for a one-time,
 * low-stakes intro. A centered card is simpler, robust across breakpoints, and still
 * teaches the five destinations. Deliberately minimal: no tour framework, no spotlight engine.
 *
 * BUDGET HAS NO NAV ROUTE: `lib/nav-items.ts` has no "Budget" entry — the budget panel
 * lives INSIDE `/plan` (`components/budget-panel.tsx`, mounted below the calendar). The
 * Budget stop's href therefore points at the same `/plan/` route as the Plan stop (taken from
 * NAV_ITEMS rather than written out here), with copy that says so ("on the Plan page") rather
 * than implying a separate destination.
 *
 * THE NAV LOOKUP'S FALLBACK IS TOTAL BUT NO LONGER PLAUSIBLE (#244). `hrefFor` must not throw
 * — this module is in the app-wide chunk, so a module-load throw takes every route to the error
 * boundary (the D-307 crash class) — but its old `?? '/'` was worse than useless: this file asked
 * for 'Home' while NAV_ITEMS relabelled that entry 'Today', and '/' happened to be the right
 * answer, so a lookup that had been broken since the relabel looked correct. The fallback is now
 * '' — still total, and impossible to be right by luck. The guard the old comment here claimed to
 * have is a real one now: `lib/__tests__/first-run-tour-trip-scope.test.ts` fails on an empty href.
 *
 * TRIP-AWARE COPY (#244): every stop here exists on a CUSTOM trip too (none of the five is
 * `defaultTripOnly`), so the tour is not gated — the one N×J literal in it is. See `tripScope`.
 *
 * A11Y: `role="dialog"` `aria-modal` `aria-labelledby`/`aria-describedby`, a
 * lightweight Tab-trap (verbatim idiom from `token-gate.tsx`), focus the first control on
 * open, all controls >=44px, `aria-live="polite"` step-count announcement. Keyboard: Tab
 * loops within the panel, Enter/Space activate (native button semantics), Esc = SKIP (unlike
 * the TokenGate wall, this dialog IS dismissible at every step).
 *
 * REDUCED MOTION: `m.*` only, governed by the app-wide `<MotionConfig
 * reducedMotion="user">` (`theme-provider.tsx`) already wrapping this tree — no new
 * MotionConfig needed. The ONE motion instance is the panel mount/unmount fade+rise;
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
  return (NAV_ITEMS as NavItem[]).find((i) => i.label === label)?.href ?? '';
}

/**
 * The Plan stop's scope clause, read off the ACTIVE trip (#244). This sentence used to end
 * "all 32 days in Nepal and Japan" for everyone, and the tour fires ONCE per browser — so a
 * custom trip's very first screen named someone else's destination and day count, and no
 * repeat-visit sweep could ever see it. Same remedy as `plan-hero.tsx` gave the same sentence
 * on /plan (#102): trip-aware copy, read at CALL time, not a gate.
 *
 * Day count and destinations both come off the one `TripConfig`, so they cannot disagree —
 * deliberately NOT `TRIP_DATES.length`, which is captured at module load and would pair a
 * stale count with a fresh label. The default pack yields the previous sentence verbatim.
 *
 * Dropped whole on a one-day span: a trip joined by token carries no config until its owner
 * writes one, and until then it is a fixed 1-day placeholder whose only "destination" is the
 * trip's own name (`core/trips/custom.ts`) — "all 1 days in Shared trip" is worse than silence.
 */
function tripScope(): string {
  const trip = getActiveTrip();
  const where = trip.legs.map((l) => l.countryLabel).filter(Boolean).join(' and ');
  const days =
    differenceInCalendarDays(new Date(`${trip.end}T12:00:00`), new Date(`${trip.start}T12:00:00`)) + 1;
  return where && days > 1 ? ` across all ${days} days in ${where}` : '';
}

/** The five stops for the ACTIVE trip — named for `navItemsForActiveTrip()`, and a function for
 * the same reason: the copy depends on which trip is loaded. Exported for the unit guard. */
export function stopsForActiveTrip(): TourStop[] {
  return [
    {
      key: 'today',
      label: 'Today',
      href: hrefFor('Today'),
      Icon: Home,
      blurb:
        'Your trip at a glance — a live countdown, the in-trip daily agenda, weather and golden hour, and your day’s journal prompt once you’re on the road.',
    },
    {
      key: 'plan',
      label: 'Plan',
      href: hrefFor('Plan'),
      Icon: Calendar,
      blurb: `Build the day-by-day itinerary${tripScope()} — add, edit, and drag to reorder, then back up your plan any time.`,
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
}

export default function FirstRunTour() {
  const { traveler } = useActiveTraveler();

  // Read per render rather than at module load: the copy is trip-dependent (#244) and the panel
  // never renders before mount, so there is nothing for a client-only read to mismatch against.
  // Five object literals on a component that renders a handful of times a session — no memo.
  const stops = stopsForActiveTrip();

  // SSR-safe first paint: same post-mount gate as TokenGate — otherwise the inert
  // {traveler:null} server snapshot would never satisfy the show condition, but a stray
  // flash could still occur on the very first client frame before storage is read. Gating
  // on `mounted` matches the existing, proven idiom exactly.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  // "Gate passed" = TokenGate itself would render NOTHING right now (see the file-header
  // note): only a signed-in traveler ever gets past the wall.
  const gatePassed = !!traveler;

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
    if (step >= stops.length - 1) {
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
          total={stops.length}
          stop={stops[step]}
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
      className="fixed inset-0 z-[65] flex items-center justify-center p-4 sm:p-6 bg-black/70"
    >
      <m.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onKeyDown={handleKeyDown}
        // D-292: a dialog is Tier 3 whatever route opened it, and the scale-from-0.94 this used
        // to carry is exactly what that tier revokes — the gated calm entrance is in
        // `lib/motion.ts`, shared with every other modal in the app.
        {...overlayPanelMotion()}
        data-testid="tour-dialog"
        className="relative w-full max-w-md bg-[rgb(var(--surface-low))] border-hair border-[color:var(--border-ui)] rounded-r2 p-6 sm:p-8"
      >
        <button
          type="button"
          ref={skipRef}
          onClick={onSkip}
          aria-label="Skip tour"
          data-testid="tour-skip"
          className="absolute right-3 top-3 inline-flex min-h-tap min-w-tap items-center justify-center rounded-r1 text-ink-mid outline-none transition-colors hover:bg-white/5 hover:text-ink-hi focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>

        <div className="flex items-center gap-3 pr-10">
          <span
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-r1 border-hair border-[color:hsl(var(--border))] bg-[rgb(var(--surface-raised))] text-ink-hi"
            aria-hidden="true"
          >
            <Icon className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <p
              className="pr"
              aria-live="polite"
              data-testid="tour-progress"
            >
              Step {step + 1} of {total}
            </p>
            {/* text-display-md, NOT `font-display font-bold`: Instrument Serif ships weight 400
                only, so that pairing asked the browser to synthesise a bold. The sans display
                step carries a real 800. */}
            <h2 id={titleId} className="text-display-md leading-tight text-ink-hi">
              {stop.label}
            </h2>
          </div>
        </div>

        <p id={descId} className="mt-4 text-t-lead leading-relaxed text-ink-mid" data-testid="tour-desc">
          {stop.blurb}
        </p>

        {/* Progress marks — decorative only, the "Step N of M" text above is the accessible
            source. On the one mark the app draws everywhere: struck is a step you have passed,
            hollow is one you have not. */}
        <div className="mt-5 flex items-center gap-1.5" aria-hidden="true">
          {Array.from({ length: total }).map((_, i) => (
            <span
              key={i}
              className={
                i === step
                  ? 'mk mk--struck h-1.5 w-5 rounded-full'
                  : i < step
                    ? 'mk mk--struck h-2 w-2'
                    : 'mk mk--hollow h-2 w-2'
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
            className="btn btn--2 gap-1.5 px-3 focus-visible:outline-none"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </button>

          <button
            type="button"
            onClick={onNext}
            data-testid="tour-next"
            className="btn px-5 focus-visible:outline-none"
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
