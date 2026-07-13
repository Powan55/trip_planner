'use client';

import { m } from 'framer-motion';
import type { ReactNode } from 'react';

/**
 * Reveal — the ONE canonical section-masthead entrance.
 *
 * Slide-only: translates up from y:20 with opacity PINNED at 1 (never an
 * opacity:0 state). This is deliberate — a fade drops
 * a muted subtitle's computed opacity mid-animation, and the axe scan (which
 * does NOT run under reduced-motion) races that transition and flags the
 * partially-faded text as a transient contrast failure. Sliding at full opacity
 * keeps the reveal feel while guaranteeing content is always scannable at AA.
 *
 * Reduced motion is handled by the app-wide <MotionConfig
 * reducedMotion="user"> (theme-provider.tsx): it neutralizes the y transform to
 * a static render, so no per-caller `useReducedMotion` guard is needed.
 *
 * Stays byte-identical to the inline mastheads it replaced (same m.div props +
 * viewport) so introducing this shared component causes ~0 visual drift.
 */
export function Reveal({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <m.div
      initial={{ opacity: 1, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className={className}
    >
      {children}
    </m.div>
  );
}
