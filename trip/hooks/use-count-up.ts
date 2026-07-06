'use client';

import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';

/**
 * Eased, one-time count-up "reveal" for a numeric value.
 *
 * PRESENTATIONAL ONLY. This hook is veneer over a value the caller already
 * computed (a countdown unit, a stat). It NEVER computes or recomputes anything
 * — `target` is passed in, and the returned `value` is just an eased fraction of
 * it during a single reveal, then the exact `target` forever after.
 *
 * Reduced-motion (HARD FENCE):
 *   A hand-rolled requestAnimationFrame count-up is NOT auto-neutralized by
 *   `<MotionConfig reducedMotion="user">` (that only gates declarative framer
 *   props). So we read `useReducedMotion()` explicitly: when the user prefers
 *   reduced motion we SKIP the rAF loop entirely and report the final value
 *   immediately, with `done: true`. No animation, no count-up.
 *
 * The live tick (used by the hero countdown):
 *   The eased fraction is multiplied by the *current* `target` each frame, so a
 *   caller whose `target` ticks every second (the live seconds) stays tracked:
 *   at the final frame `progress === 1` ⇒ `eased === 1` ⇒ `value === target`
 *   EXACTLY. The caller flips to rendering its live value directly once `done`
 *   is true, so after the reveal the displayed number equals the live value with
 *   no desync and no jump.
 *
 * @param target   the number to reveal up to (may change live; final frame lands on it exactly)
 * @param active   when true, the one-time reveal runs (e.g. gate on mount or useInView)
 * @param duration reveal length in ms (default 2000, matching the dashboard's feel)
 * @returns `{ value, done }` — `value` is the eased number to display while
 *          revealing; `done` is true once the reveal has completed (or instantly
 *          under reduced motion). Callers should display their live/exact value
 *          when `done` is true.
 */
export function useCountUp(
  target: number,
  active: boolean,
  duration = 2000,
): { value: number; done: boolean } {
  const reduceMotion = useReducedMotion();
  const [value, setValue] = useState(0);
  const [done, setDone] = useState(false);
  // True only while a rAF reveal is actually in flight. When false, the hook
  // reports the LIVE target (see below) — so a torn-down or never-started reveal
  // can never leave the display stuck at the initial 0.
  const [animating, setAnimating] = useState(false);

  // Keep the latest live target in a ref so the rAF loop reads the current value
  // each frame without re-subscribing the effect (which would restart the reveal).
  const targetRef = useRef(target);
  targetRef.current = target;

  // Guard so the reveal completes ONCE per mount. We key off "has the reveal
  // FINISHED", not "has it ever started" — so if React tears the effect down
  // mid-reveal and re-runs it (StrictMode's mount→cleanup→remount in dev, or any
  // remount), the unfinished reveal RESUMES instead of being blocked forever by a
  // started-but-never-completed guard. That dev double-invoke was the cause of the
  // stuck "00" countdown: the first run scheduled a rAF, the cleanup cancelled it,
  // and the re-run early-returned — leaving value at 0, done false, forever.
  const doneRef = useRef(false);

  useEffect(() => {
    if (!active || doneRef.current) return;

    // Reduced motion: no count-up. Land on the final value instantly.
    if (reduceMotion) {
      doneRef.current = true;
      setValue(targetRef.current);
      setDone(true);
      setAnimating(false);
      return;
    }

    let raf = 0;
    setAnimating(true);
    const startTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    const tick = () => {
      const nowT = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const progress = Math.min((nowT - startTime) / duration, 1);
      // Cubic ease-out — identical curve to the dashboard's original counter so
      // the two surfaces feel the same.
      const eased = 1 - Math.pow(1 - progress, 3);
      // Multiply by the CURRENT (possibly-ticking) target so the final frame
      // lands exactly on the live value.
      setValue(Math.floor(eased * targetRef.current));
      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        doneRef.current = true;
        setValue(targetRef.current);
        setDone(true);
        setAnimating(false);
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      // Torn down before completion (e.g. StrictMode cleanup). Stop animating so
      // the display falls back to the LIVE value; the effect re-run resumes the
      // reveal because doneRef is still false.
      if (raf) cancelAnimationFrame(raf);
      setAnimating(false);
    };
    // `target` intentionally excluded: a live-ticking target must NOT restart the
    // reveal — the loop reads it via targetRef. `reduceMotion` is effectively
    // stable for a session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, duration, reduceMotion]);

  // Robustness: only show the eased reveal value WHILE actively animating.
  // Whenever the reveal isn't running — before it starts, once it's done, or if it
  // was torn down by a remount — report the live target so a mounted page can never
  // display a stuck 0. The caller already renders `live` directly once `done`, so
  // post-reveal behaviour (live seconds tick) is unchanged.
  return { value: animating ? value : targetRef.current, done };
}
