'use client';

import { useEffect, useRef, useState } from 'react';
import { m, AnimatePresence, useReducedMotion } from 'framer-motion';
import { celebrationVisible, claimCelebration, type CelebrationWeight } from '@/lib/celebration';

/**
 * CelebrationBurst — a tasteful ~600ms `m.*` pop (LazyMotion strict, no new dependency)
 * for a completion moment (countdown hits zero, last packing item checked). Purely decorative
 * (aria-hidden, pointer-events-none) — the real state change already has its own accessible
 * feedback (the panel swap / the progress text), this is only the flourish on top.
 *
 *(b) HARD GUARD: under `prefers-reduced-motion` nothing renders — no static substitute,
 * by design. The caller owns the fire-once transition detection (`crossedIntoComplete`,
 * `lib/celebration.ts`) and passes `active` for the ~600ms window; this component only decides
 * whether to actually show it (`celebrationVisible`).
 *
 * ── THE SESSION LEDGER (issue #24 · D-293 rule 5's second clause, rule 6's caps) ────────────
 * The caller's edge detector is a ref, and a ref dies with the route. Leave `/packing` and come
 * back and the same completion is a fresh false→true edge — R5 says it must not fire again. So
 * every burst also CLAIMS (`claimCelebration`, sessionStorage via the gateway) and renders only
 * if the claim is granted. Wiring it here rather than at the six call sites is deliberate: this
 * is the single component all of them already route through, `celebrationId` is required so a
 * seventh cannot forget it, and the claim sits BEHIND the reduced-motion guard, so a user who is
 * shown nothing is never charged for it.
 *
 * The ref is what makes the claim safe to make in an effect: it decides once per `active`
 * window, so React StrictMode's double-invoke in development cannot spend the claim twice and
 * leave the burst it just granted invisible.
 */
export default function CelebrationBurst({
  active,
  testId,
  celebrationId,
  weight = 'completion',
}: {
  active: boolean;
  testId?: string;
  /** The ENTITY R5 counts (`packing-complete`, `stamp:Japan`) — not the route, not the render. */
  celebrationId: string;
  /** R6's weight, which picks the cap. Defaults to D-323's one-shot `completion`. */
  weight?: CelebrationWeight;
}) {
  const reducedMotion = useReducedMotion();
  const visible = celebrationVisible(active, reducedMotion);

  const windowOpenRef = useRef(false);
  const [claimed, setClaimed] = useState(false);
  useEffect(() => {
    if (!visible) {
      windowOpenRef.current = false;
      return;
    }
    if (windowOpenRef.current) return;
    windowOpenRef.current = true;
    setClaimed(claimCelebration(celebrationId, weight));
  }, [visible, celebrationId, weight]);

  const show = visible && claimed;

  return (
    <AnimatePresence>
      {show && (
        <m.span
          data-testid={testId}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-4xl sm:text-5xl"
          initial={{ opacity: 0, scale: 0.4 }}
          animate={{ opacity: 1, scale: 1.25 }}
          exit={{ opacity: 0, scale: 1.5 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        >
          🎉
        </m.span>
      )}
    </AnimatePresence>
  );
}
