'use client';

import { useCallback, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useReducedMotion } from 'framer-motion';

/**
 * useViewTransition — manual
 * `document.startViewTransition()` progressive enhancement for App-Router route
 * navigation. Returns a `navigate(href)` the nav trigger sites call instead of a
 * bare `<Link>` click.
 *
 * The ladder (each rung short-circuits the next):
 * 1. Reduced motion → plain `router.push(href)`. No `startViewTransition`, no
 * attribute. template.tsx's own reduced-motion branch then renders the plain
 * `<div>` → total motion is NONE of either kind.
 * 2. No VT support (`document.startViewTransition` not a function) → plain
 * `router.push(href)`; the existing route fade plays (exact current behavior,
 * the Firefox/Safari path today).
 * 3. Supported → set `html[data-vt-active]` (suppresses the route fade for the
 * bracketed window via the one globals.css rule), drive the push inside the
 * transition, and resolve the transition's promise when the new pathname
 * COMMITS (the standard manual App-Router pattern — a usePathname effect
 * settles a module-level resolver). Cleanup: remove the attribute on
 * `finished` PLUS a ~1500ms safety timeout so a missed/same-path commit can
 * never leave the attribute stuck (which would permanently kill route fades).
 *
 * template.tsx itself is untouched: the remount happens
 * inside the VT window where `.animate-route-fade` is inert, so no double-animation.
 */

const VT_ATTR = 'data-vt-active';
const SAFETY_MS = 1500;

/**
 * Module-level resolver for the pathname-commit promise. `startViewTransition`'s
 * updateDOM callback returns a promise that resolves when the NEXT pathname commit
 * lands; the usePathname effect below settles it. Module scope so the effect (which
 * re-runs on every pathname change in whichever component uses the hook) can settle
 * the in-flight navigation. Only one nav is ever in flight at a time (a user can't
 * click two links in one frame), so a single slot suffices.
 */
let commitResolve: (() => void) | null = null;

function settleCommit(): void {
  if (commitResolve) {
    const resolve = commitResolve;
    commitResolve = null;
    resolve();
  }
}

type VTDocument = Document & {
  startViewTransition?: (updateDOM: () => void | Promise<void>) => { finished: Promise<unknown> };
};

export function useViewTransition(): (href: string) => void {
  const router = useRouter();
  const pathname = usePathname();
  const prefersReducedMotion = useReducedMotion();

  // Settle the in-flight transition's promise once the new pathname commits.
  useEffect(() => {
    settleCommit();
  }, [pathname]);

  return useCallback(
    (href: string) => {
      // Rung 1 — reduced motion: plain push, NO transition of either kind.
      if (prefersReducedMotion) {
        router.push(href);
        return;
      }

      // Rung 2 — no VT support: plain push, the existing route fade plays.
      const doc = document as VTDocument;
      if (typeof doc.startViewTransition !== 'function') {
        router.push(href);
        return;
      }

      // Rung 3 — supported: bracket the transition with html[data-vt-active].
      const root = document.documentElement;
      root.setAttribute(VT_ATTR, '');
      let cleared = false;
      const clearAttr = () => {
        if (cleared) return;
        cleared = true;
        root.removeAttribute(VT_ATTR);
      };

      const transition = doc.startViewTransition(
        () =>
          new Promise<void>((resolve) => {
            commitResolve = resolve;
            router.push(href);
            // Bound the promise itself: a same-path push (no pathname change) or a
            // missed commit must never hang the transition in its captured state.
            window.setTimeout(() => {
              if (commitResolve === resolve) {
                commitResolve = null;
                resolve();
              }
            }, SAFETY_MS);
          }),
      );

      transition.finished.finally(clearAttr);
      // Belt-and-braces: a stuck attribute must never permanently kill route fades.
      window.setTimeout(clearAttr, SAFETY_MS + 100);
    },
    [router, prefersReducedMotion],
  );
}
