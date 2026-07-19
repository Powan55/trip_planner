'use client';

import { m, AnimatePresence, useReducedMotion } from 'framer-motion';
import { celebrationVisible } from '@/lib/celebration';

/**
 * CelebrationBurst — a tasteful ~600ms `m.*` pop (LazyMotion strict, no new dependency)
 * for a completion moment (countdown hits zero, last packing item checked). Purely decorative
 * (aria-hidden, pointer-events-none) — the real state change already has its own accessible
 * feedback (the panel swap / the progress text), this is only the flourish on top.
 *
 *(b) HARD GUARD: under `prefers-reduced-motion` nothing renders — no static substitute,
 * per the brief. The caller owns the fire-once transition detection (`crossedIntoComplete`,
 * `lib/celebration.ts`) and passes `active` for the ~600ms window; this component only decides
 * whether to actually show it (`celebrationVisible`).
 */
export default function CelebrationBurst({ active, testId }: { active: boolean; testId?: string }) {
  const reducedMotion = useReducedMotion();
  const show = celebrationVisible(active, reducedMotion);

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
