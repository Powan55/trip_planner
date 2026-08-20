'use client';

import { useEffect, useState } from 'react';
import { m } from 'framer-motion';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { FADE_FLOOR, entranceFor } from '@/lib/motion';

/**
 * Reveal — the ONE canonical section-masthead entrance (; scroll-driven CSS
 * conversion extending dual-path idiom from the page-progress bar
 * (`components/scroll-progress.tsx`) — read that file's doc comment first, this
 * mirrors it exactly).
 *
 * — the reveal now FLOORS its fade instead of pinning it. / the
 * convention pinned opacity at 1 on both paths (a slide that never faded)
 * because the axe scan does NOT run under reduced motion, so it races the
 * transition and flags a mid-fade muted subtitle as a transient contrast failure.
 * A floor keeps that guarantee without killing the motion: the framer path animates
 * `FADE_FLOOR → 1`, and FADE_FLOOR is shallow enough that even the most muted body
 * copy in a revealed subtree stays ≥AA at the animation's darkest frame.
 *
 * The CSS path is DELIBERATELY not floored — it still animates `transform` only.
 * A view-timeline animation is a pure function of scroll position and re-plays
 * every time the element re-enters its range (see the debt note below), so an
 * opacity fade there would flicker on every scroll-by instead of revealing once.
 * Net effect: on Chromium the floored fade is only seen on the reduced-motion /
 * no-support framer path; Firefox/Safari get it on every reveal.
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
 * unlike the framer path's `viewport:{once:true}` (plays once, then
 * stays revealed forever), a native view-timeline has no "play once" primitive
 * — it is a pure function of current scroll position, so scrolling an
 * already-revealed section back OUT of its `entry` range and back in will
 * re-play the slide on the CSS path. This is an inherent platform limitation of
 * CSS scroll-driven animations (no ergonomic fix without reintroducing JS,
 * which would defeat the point of the compositor-only path) — not a bug.
 * Recorded as a known, accepted behavior difference of the CSS path
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
 * render.
 *
 * CORRECTION to the sentence that used to sit here — `useReducedMotion` is NO
 * LONGER only a path gate. MotionConfig neutralizes the `y` TRANSFORM; it does not
 * hold OPACITY at 1. Once floored the fade, an un-forked reveal that had not
 * yet intersected rested at FADE_FLOOR under reduce — measured, not theorised: the
 * negative-control run read 0.7 off the off-screen photography masthead on
 * /nepal/. So `reduceMotion` now also forks the framer path's `initial`, landing
 * reduced-motion users at full opacity. e2e/reveal.spec.ts asserts it.
 *
 * ISSUE #24 — the fork is no longer this component's own judgement. It asks
 * `entranceFor()` (lib/motion.ts), which is the ONE place D-292's tier gate,
 * D-293's once-per-session entrance ledger and `prefers-reduced-motion` are
 * decided. Three things follow, and they are the point of the change:
 *
 * - **Reduced motion is no longer a claim made here.** The framer
 * `useReducedMotion()` call is gone; there is no branch in this file that can
 * forget the preference, because the only branch reads a decision that already
 * accounts for it. Behaviour under reduce is unchanged — `'present'` renders the
 * exact `initial={{opacity:1}}` fork D-246 landed.
 * - **A Tier-3 route no longer reveals at all.** D-292 forbids scroll-reveal on
 * the working screens. Exactly one Tier-3 route reaches a `<Reveal>` today —
 * /plan/, through `calendar-planner.tsx`'s `<SectionHeading>` — so its masthead
 * is now simply present. That is the gate biting, not a regression, and it is
 * the whole behavioural delta of this change.
 * - **The tenth visit in a session is quiet.** A surface already greeted this
 * session renders present, no transition.
 *
 * `'present'` is the SAME branch as the reduced-motion fork, deliberately: it is
 * already shipped and already reviewed, so this adds no new rendering shape and
 * no new hydration characteristic. The server always prerenders `'animate'` for a
 * Tier-1/2 route (no window, empty ledger), exactly as it did before; only a
 * returning client's first render differs, in the same way and to the same degree
 * a reduced-motion client's already did.
 *
 * `data-entrance` is on both paths so the rule is observable from outside — an
 * e2e spec can assert that every reveal on /plan/ is `"present"` without knowing
 * anything about the ledger.
 */
export function Reveal({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  // `usePathname()` is null with no app router mounted (a unit-test harness);
  // `entranceFor` reads that as an unscoped surface and returns 'present'.
  const entrance = entranceFor(usePathname());
  const animating = entrance === 'animate';

  const [cssTimeline, setCssTimeline] = useState(false);
  useEffect(() => {
    setCssTimeline(
      typeof CSS !== 'undefined' &&
        typeof CSS.supports === 'function' &&
        CSS.supports('animation-timeline: view()'),
    );
  }, []);

  if (cssTimeline && animating) {
    return (
      <div
        data-scroll-driven="css"
        data-entrance={entrance}
        className={className ? `reveal-view-css ${className}` : 'reveal-view-css'}
      >
        {children}
      </div>
    );
  }

  return (
    <m.div
      data-scroll-driven="js"
      data-entrance={entrance}
      // the floor is for the ANIMATED path only. Under reduce we keep the old
      // pin (settle at full opacity, no fade, no slide) — `MotionConfig
      // reducedMotion="user"` neutralises the `y` transform but NOT opacity, so an
      // un-forked floor would leave any not-yet-intersected reveal resting at 0.7 for
      // exactly the users least able to tolerate it. Measured, not assumed: the
      // negative-control run read 0.7 off the off-screen photography masthead before this
      // fork existed. Asserted in e2e/reveal.spec.ts.
      initial={animating ? { opacity: FADE_FLOOR, y: 20 } : { opacity: 1 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className={className}
    >
      {children}
    </m.div>
  );
}
