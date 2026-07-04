'use client';

import { m, useScroll, useSpring, useReducedMotion } from 'framer-motion';

/**
 * Scroll progress bar. A thin (2px) fixed bar at the very top of the page
 * whose width tracks how far the document is scrolled (0% -> 100%).
 *
 * Motion:
 *  - Uses the lightweight `m.div` — `motion.*` is forbidden under the `strict`
 *    LazyMotion in theme-provider.tsx and would throw.
 *  - `useScroll().scrollYProgress` is a 0..1 MotionValue driven by scroll.
 *  - Normally we smooth it with `useSpring` for a premium, slightly-eased fill.
 *  - Under `prefers-reduced-motion` we bind `scaleX` DIRECTLY to the raw
 *    `scrollYProgress` (no spring), so the bar tracks instantly with no
 *    animated lag. `useSpring` is still called unconditionally to keep
 *    hook order stable; its output is simply not used in the reduced case.
 *
 * Layout: `fixed h-[2px]`, so it never participates in layout flow and
 * cannot introduce horizontal overflow at any breakpoint. `transformOrigin:left`
 * makes scaleX grow from the left edge.
 *
 * Colour: reads `--accent-scroll` so the warm/cool accent engine drives
 * it for free. Dark-only.
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

  const scaleX = reduceMotion ? scrollYProgress : smoothed;

  return (
    <m.div
      aria-hidden="true"
      data-testid="scroll-progress"
      className="fixed top-0 left-0 right-0 z-[60] h-[2px] origin-left"
      style={{
        scaleX,
        transformOrigin: 'left',
        backgroundColor: 'hsl(var(--accent-scroll))',
      }}
    />
  );
}
