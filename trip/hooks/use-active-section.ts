'use client';

import { useEffect, useState } from 'react';
import { observe } from 'react-intersection-observer';

/**
 * Scroll-spy. Given a list of in-page section anchor ids (the same ids the
 * navbar links to), returns the id of the section currently "in view" so the
 * navbar can highlight the active link. This is also the active-section signal
 * 's warm/cool accent engine consumes.
 *
 * Selection strategy — robust to very uneven section heights (this page has
 * sections from ~700px to ~5500px tall, several taller than the viewport, so a
 * naive "first section intersecting a thin band" heuristic mis-fires and the
 * active link lags by one). Instead, on every IntersectionObserver callback we
 * measure all sections' live positions and pick the LAST section (in document
 * order) whose top has scrolled above a trigger line a little below the navbar.
 * That is exactly the section a reader perceives as current, regardless of how
 * tall it is.
 *
 * Why IO at all (vs a scroll listener): the brief mandates an IO-based spy with
 * no new dependency. We use `react-intersection-observer`'s imperative
 * `observe` (an existing dep) purely as the change trigger — each boundary
 * crossing wakes the cheap O(n=7) recompute. This keeps work off the main
 * thread between crossings and avoids a scroll handler.
 *
 * Observers are torn down on unmount via the cleanup fns `observe` returns.
 * IO-based, so it is unaffected by `prefers-reduced-motion`.
 */

// Trigger line, in px from the top of the viewport. ~ navbar height (64px) plus
// a small margin so a section becomes active as its heading clears the navbar.
const TRIGGER_OFFSET = 96;

export function useActiveSection(sectionIds: string[]): string | null {
  // Default to the first section so the first nav link reads active at the top
  // of the page (before any IO callback fires).
  const [activeId, setActiveId] = useState<string | null>(sectionIds[0] ?? null);

  // Stable dependency key so the effect re-runs only when the id list changes
  // not on every render (the array literal is recreated upstream each render).
  const idsKey = sectionIds.join('|');

  useEffect(() => {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
      return;
    }

    const ids = idsKey ? idsKey.split('|') : [];

    const recompute = () => {
      let current: string | null = ids[0] ?? null;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        // Last section whose top has passed (is at/above) the trigger line wins.
        if (top - TRIGGER_OFFSET <= 0) {
          current = id;
        } else {
          // ids are in document order, so once one is still below the line, all
          // later ones are too — stop early.
          break;
        }
      }
      setActiveId((prev) => (prev === current ? prev : current));
    };

    const cleanups: Array<() => void> = [];

    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      // A 0px-height band at the trigger line: each callback fires when a
      // section edge crosses it, which is exactly when the active id can change.
      const unobserve = observe(el, recompute, {
        rootMargin: `-${TRIGGER_OFFSET}px 0px -${Math.max(0, window.innerHeight - TRIGGER_OFFSET - 1)}px 0px`,
        threshold: 0,
      });
      cleanups.push(unobserve);
    });

    // Initial sync (covers a page loaded already scrolled, e.g. via hash/back).
    recompute();

    return () => {
      cleanups.forEach((fn) => fn());
    };
  }, [idsKey]);

  return activeId;
}
