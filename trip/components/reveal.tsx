'use client';

import { useEffect, useState } from 'react';
import { m, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

/**
 * Reveal — the ONE canonical section-masthead entrance (; scroll-driven CSS
 * conversion extending dual-path idiom from the page-progress bar
 * (`components/scroll-progress.tsx`) — read that file's doc comment first, this
 * mirrors it exactly).
 *
 * Slide-only: translates up from y:20 with opacity PINNED at 1 (never an
 * opacity:0 state), on BOTH paths. This encodes / the convention —
 * a fade drops a muted subtitle's computed opacity mid-animation, and the axe
 * scan (which does NOT run under reduced-motion) races that transition and flags
 * the partially-faded text as a transient contrast failure. Sliding at full
 * opacity keeps the reveal feel while guaranteeing content is always scannable
 * at AA. The CSS path only ever animates `transform`, never `opacity`, so this
 * guarantee holds structurally there too.
 *
 * — two rendering paths, feature-detected at runtime:
 * - **CSS path** (Chromium): a plain `<div class="reveal-view-css">` whose
 * `translateY` is driven entirely by a scroll-driven CSS animation keyed to
 * an ELEMENT VIEW timeline (`animation-timeline: view()` + `animation-range:
 * entry 0% cover 30%` — see globals.css), gated under `@supports
 * (animation-timeline: view())`. Zero JS per scroll frame — the compositor
 * plays the slide-up as the section crosses into the viewport.
 * - **JS fallback** (Firefox/Safari, and always under reduced motion): the
 * original framer `whileInView` implementation, retained VERBATIM — same
 * props, same `viewport:{once:true}` semantics.
 *
 * Detection runs in an effect (`CSS.supports('animation-timeline: view()')`)
 * because the server can't know the browser: SSR + first client render both
 * emit the framer path (hydration-consistent), and supporting browsers swap to
 * the CSS element right after mount — mirrors scroll-progress.tsx exactly.
 *
 * ponytail: unlike the framer path's `viewport:{once:true}` (plays once, then
 * stays revealed forever), a native view-timeline has no "play once" primitive
 * — it is a pure function of current scroll position, so scrolling an
 * already-revealed section back OUT of its `entry` range and back in will
 * re-play the slide on the CSS path. This is an inherent platform limitation of
 * CSS scroll-driven animations (no ergonomic fix without reintroducing JS,
 * which would defeat the point of the compositor-only path) — not a bug.
 * Flagged to as a known, accepted behavior difference of the CSS path
 * only; the framer fallback keeps its exact "once" semantics untouched.
 *
 * Reduced motion — same reasoning as scroll-progress.tsx: the
 * global reduced-motion CSS block's `animation-duration: 0.01ms` idiom does not
 * cleanly neutralize a view-timeline-driven keyframe (a time duration on a
 * scroll-position timeline re-maps across the range rather than disabling it),
 * so rather than exempt the reveal from that block, under `prefers-reduced-
 * motion` we simply never render the CSS element — the framer path is used
 * instead, and that path's y-transform is what the app-wide `<MotionConfig
 * reducedMotion="user">` (theme-provider.tsx) already neutralizes to a static
 * render, so no per-caller guard is needed there. `useReducedMotion` is
 * called here ONLY to gate which path renders (mirrors scroll-progress.tsx);
 * it does not touch the framer path's own props, which stay byte-identical to
 * pre-.
 *
 * Stays byte-identical (framer path) to the inline mastheads replaced
 * (same m.div props + viewport) so this introduces ~0 visual drift there.
 */
export function Reveal({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();

  const [cssTimeline, setCssTimeline] = useState(false);
  useEffect(() => {
    setCssTimeline(
      typeof CSS !== 'undefined' &&
        typeof CSS.supports === 'function' &&
        CSS.supports('animation-timeline: view()'),
    );
  }, []);

  if (cssTimeline && !reduceMotion) {
    return (
      <div
        data-scroll-driven="css"
        className={className ? `reveal-view-css ${className}` : 'reveal-view-css'}
      >
        {children}
      </div>
    );
  }

  return (
    <m.div
      data-scroll-driven="js"
      initial={{ opacity: 1, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className={className}
    >
      {children}
    </m.div>
  );
}
