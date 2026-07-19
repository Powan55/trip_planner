'use client';

import { useEffect, useState } from 'react';
import { m, useScroll, useSpring, useReducedMotion } from 'framer-motion';

/**
 * Scroll progress bar. A thin (2px)
 * fixed bar at the very top of the page whose width tracks how far the
 * document is scrolled (0% -> 100%).
 *
 * — two rendering paths, feature-detected at runtime:
 *
 * - **CSS path** (Chromium): a plain `<div class="scroll-progress-css">`
 * whose `scaleX` is driven entirely by a scroll-driven CSS animation
 * (`animation-timeline: scroll(root)` — see globals.css), gated there under
 * `@supports (animation-timeline: scroll())`. Zero JS per scroll frame; the
 * compositor tracks the scroll offset directly. No spring — scroll-timeline
 * progress IS the bar's progress (visually this matches the old sprung bar
 * to within the spring's ~100ms settle lag).
 * - **JS fallback** (Firefox/Safari): the original framer implementation,
 * retained verbatim — `useScroll().scrollYProgress` smoothed by `useSpring`.
 *
 * Detection runs in an effect (`CSS.supports('animation-timeline: scroll()')`)
 * because the server can't know the browser: SSR + first client render both
 * emit the framer path (hydration-consistent), and supporting browsers swap to
 * the CSS element right after mount. Both elements show the same progress at
 * the swap instant, so the handoff is invisible.
 *
 * Motion — reduced motion keeps the JS path DELIBERATELY:
 * - The global reduced-motion CSS block neutralizes animations with the
 * `animation-duration: 0.01ms` idiom, which does NOT cleanly neutralize a
 * progress-based (scroll) timeline — a time duration on a scroll timeline
 * re-maps the keyframes across the scroll range rather than disabling them,
 * so the CSS bar's behavior under that block is engine-dependent. Rather
 * than exempt the bar from the global block, under `prefers-reduced-motion`
 * we simply never render the CSS element: the framer path binds `scaleX`
 * DIRECTLY to the raw `scrollYProgress` (no spring), the proven
 * behavior — the bar tracks instantly with no animated lag. As
 * belt-and-braces the CSS class also carries a base `transform: scaleX(0)`
 * (globals.css), so even if it ever rendered with its animation killed it
 * rests invisible, never a stuck full-width bar.
 * - `useScroll`/`useSpring` are called unconditionally to keep hook order
 * stable; on the CSS path their output is simply unused.
 *
 * Layout: `fixed h-[2px]`, so it never participates in layout flow and
 * cannot introduce horizontal overflow at any breakpoint. `transformOrigin:left`
 * makes scaleX grow from the left edge.
 *
 * Colour: reads `--accent-scroll` so the route accent engine drives it
 * for free. Dark-only.
 *
 * Decorative: the native scrollbar already conveys scroll position to assistive
 * tech, so this purely-visual flourish is `aria-hidden`.
 */
export default function ScrollProgress() {
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const smoothed = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 30,
    restDelta: 0.001,
  });

  const [cssTimeline, setCssTimeline] = useState(false);
  useEffect(() => {
    setCssTimeline(
      typeof CSS !== 'undefined' &&
        typeof CSS.supports === 'function' &&
        CSS.supports('animation-timeline: scroll()'),
    );
  }, []);

  if (cssTimeline && !reduceMotion) {
    return (
      <div
        aria-hidden="true"
        data-testid="scroll-progress"
        data-scroll-driven="css"
        className="scroll-progress-css fixed top-0 left-0 right-0 z-[60] h-[2px] origin-left"
        style={{ backgroundColor: 'hsl(var(--accent-scroll))' }}
      />
    );
  }

  const scaleX = reduceMotion ? scrollYProgress : smoothed;

  return (
    <m.div
      aria-hidden="true"
      data-testid="scroll-progress"
      data-scroll-driven="js"
      className="fixed top-0 left-0 right-0 z-[60] h-[2px] origin-left"
      style={{
        scaleX,
        transformOrigin: 'left',
        backgroundColor: 'hsl(var(--accent-scroll))',
      }}
    />
  );
}
