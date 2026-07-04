'use client';

import { useReducedMotion } from 'framer-motion';

/**
 * Route-transition wrapper.
 *
 * Next.js App Router remounts `template.tsx` on EVERY navigation (unlike
 * `layout.tsx`, which persists). That remount is exactly the hook we use to
 * drive a global route-change transition: a fresh mount replays the CSS
 * `.animate-route-fade` entrance (opacity 0 -> 1, `--duration-fast` ≈ 150ms,
 * `--ease-out-soft`) on the whole routed subtree.
 *
 * This is deliberately DUMB: no providers, no state, no effects. All app
 * providers (Theme / Itinerary / accent engine / navbar / footer) live in
 * `layout.tsx` and must stay there so they are NOT torn down and rebuilt on
 * navigation — putting them here would remount the whole app on every route
 * change (lost itinerary state, re-run token gate, flashing chrome). Template
 * holds only the transition shell.
 *
 * Reduced-motion: NO transition under `prefers-reduced-motion`. The CSS class is
 * one-shot and already collapses to ~0ms under reduced motion (it rests at
 * opacity:1, never stuck at 0), but to be unambiguous we ALSO branch at the React
 * level: under reduced motion we render a plain `<div>` with NO animation class at
 * all — no keyframe is ever attached, so there is nothing to neutralize.
 * `useReducedMotion()` returns `null` during SSR/first paint (treated as "no
 * preference"), which is correct: the very first paint is not a route transition,
 * and the class resting at opacity:1 means even that first mount lands visible.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  const prefersReducedMotion = useReducedMotion();

  if (prefersReducedMotion) {
    return <div>{children}</div>;
  }

  return <div className="animate-route-fade">{children}</div>;
}
