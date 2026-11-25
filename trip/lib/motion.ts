import type { TargetAndTransition } from 'framer-motion';

import { entranceLedger } from '@/core/storage/gateway';

/**
 * Motion rules in code rather than in comments (D-292 tiers, D-293 budget):
 * - Tier gate: `tierForPath()` maps a route to a tier and `isMotionAllowed()` says what that
 *   tier may do. Unknown routes are Tier 3, the strictest. motion-budget.test.ts fails when a
 *   page.tsx isn't tiered.
 * - Entrance ledger: `entranceFor()` animates a surface once per browser session.
 * - Reduced motion: `prefersReducedMotion()` is checked first, so nothing here animates under
 *   reduce. Components that must re-render on change use framer's `useReducedMotion()`.
 * Durations live as `--duration-*` in globals.css, not here.
 */

/**
 * Opacity every section reveal starts from. 0.95, not lower: a wrapper's opacity multiplies
 * its text, and below-fold content rests at the floor because `whileInView` never fires, so
 * axe scans it there. 0.7 failed five color-contrast specs; 0.95 is the first value that
 * keeps muted text on cards above 4.5:1 (D-100, D-246). The visible reveal is the y slide.
 * A TS constant because framer can't read a CSS variable. Reduced motion lands at opacity 1.
 */
export const FADE_FLOOR = 0.95;

// The tier gate (D-292)

/** Tier 3 is the same design with its motion permissions revoked. */
export type MotionTier = 1 | 2 | 3;

/**
 * - `state`: a loop that reports a condition (skeleton shimmer, today ring). Allowed on every
 *   tier and exempt from the 6s loop floor (D-322); scripts/motion-loops.mjs enforces the CSS side.
 * - `completion`: a one-shot burst on something the user finished. Allowed everywhere (D-323),
 *   and kept separate from `burst` so it can't become a pop on a working screen.
 */
export type MotionKind = 'entrance' | 'loop' | 'state' | 'tick' | 'pop' | 'burst' | 'completion';

/** Tier 1: the front door and keepsake surfaces. */
export const TIER_1_SURFACES: readonly string[] = ['/', '/recap', '/trips', '/passport'];

/** Tier 2: content routes. */
export const TIER_2_SURFACES: readonly string[] = [
  '/guides',
  '/nepal',
  '/japan',
  '/map',
  '/journal',
  '/flights',
];

/**
 * Tier 3: working screens. Listed for the route-coverage test; unlisted routes are Tier 3
 * anyway. Overlays are pinned to Tier 3 separately via `OVERLAY_TIER`.
 */
export const TIER_3_SURFACES: readonly string[] = [
  '/plan',
  '/packing',
  '/checklist',
  '/settings',
  '/more',
  '/safety',
  '/share',
  '/travel',
  '/privacy',
  '/terms',
  '/contact',
  // A data-entry form, so Tier 3 even though D-292 mentions "passport/profile" for Tier 1.
  '/profile',
];

/**
 * First path segment: `/nepal/`, `/nepal` and `/nepal/x` are one surface. Returns `''` (not
 * `'/'`) for a missing or malformed path, so an unrouted render never gets Tier 1.
 */
export function surfaceKey(pathname: string | null | undefined): string {
  // Without the leading-slash check, 'nepal' would fall through to '/'.
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) return '';
  const first = pathname.split('/')[1] ?? '';
  return first === '' ? '/' : `/${first}`;
}

/** The tier of an already-normalised surface key. Unknown ⇒ 3, the strictest. */
export function tierForSurface(surface: string): MotionTier {
  if (TIER_1_SURFACES.includes(surface)) return 1;
  if (TIER_2_SURFACES.includes(surface)) return 2;
  return 3;
}

/** Unknown or unroutable paths are Tier 3. */
export function tierForPath(pathname: string | null | undefined): MotionTier {
  return tierForSurface(surfaceKey(pathname));
}

const PERMITTED_TIERS: Readonly<Record<MotionKind, readonly MotionTier[]>> = {
  entrance: [1, 2],
  loop: [1],
  state: [1, 2, 3],
  // A tick is colour and a mark, no movement.
  tick: [1, 2, 3],
  pop: [1, 2],
  burst: [1],
  completion: [1, 2, 3],
};

/** Whether a kind of motion is permitted at all on a tier. */
export function isMotionAllowed(kind: MotionKind, tier: MotionTier): boolean {
  return PERMITTED_TIERS[kind].includes(tier);
}

// Overlays

/** Dialogs, sheets, popovers and forms are Tier 3 whatever route opened them (D-292). */
export const OVERLAY_TIER: MotionTier = 3;

/**
 * Picks `loud` or `calm` for an overlay primitive. Generic so class strings (dialog, sheet)
 * and framer variants (sheet-dark) go through the same table. Reduced motion is handled
 * underneath by globals.css and framer's MotionConfig.
 */
export function overlayMotion<T>(kind: MotionKind, loud: T, calm: T): T {
  return isMotionAllowed(kind, OVERLAY_TIER) ? loud : calm;
}

/**
 * Framer variants shared by the hand-rolled modals. Lives here rather than in sheet-dark.tsx
 * so two older dialogs don't pull the whole primitive into their chunks. Every variant sets
 * an explicit transition; without one framer falls back to a spring.
 */
type PanelMotion = Record<
  'center' | 'right',
  { initial: TargetAndTransition; animate: TargetAndTransition; exit: TargetAndTransition }
>;

// Keep in step with --ease-ink / --duration-ink / --duration-exit in globals.css.
const EASE_INK = [0.2, 0.7, 0.3, 1] as const; // --ease-ink
const DUR_INK = 0.42; // --duration-ink  420ms
const DUR_EXIT = 0.16; // --duration-exit 160ms

// Rise, never scale.
const PANEL_MOTION_LOUD: PanelMotion = {
  center: {
    initial: { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0, transition: { duration: DUR_INK, ease: EASE_INK } },
    exit: { opacity: 0, y: 14, transition: { duration: DUR_EXIT, ease: 'easeIn' } },
  },
  right: {
    initial: { opacity: 0, y: 40 },
    animate: { opacity: 1, y: 0, x: 0, transition: { duration: DUR_INK, ease: EASE_INK } },
    exit: { opacity: 0, y: 40, transition: { duration: DUR_EXIT, ease: 'easeIn' } },
  },
};

const PANEL_MOTION_CALM: PanelMotion = {
  center: {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0, transition: { duration: 0.2, ease: EASE_INK } },
    exit: { opacity: 0, transition: { duration: DUR_EXIT, ease: 'easeIn' } },
  },
  right: {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0, transition: { duration: 0.2, ease: EASE_INK } },
    exit: { opacity: 0, transition: { duration: DUR_EXIT, ease: 'easeIn' } },
  },
};

/** The gated entrance for a modal panel. `center` is a dialog, `right` a drawer/bottom sheet. */
export function overlayPanelMotion(side: 'center' | 'right' = 'center') {
  return overlayMotion('entrance', PANEL_MOTION_LOUD, PANEL_MOTION_CALM)[side];
}

// Reduced motion

/**
 * The app's one non-React read of the preference, read live on each call. Returns false when
 * it can't tell; the CSS media block and MotionConfig still apply underneath.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)')?.matches === true;
  } catch {
    return false;
  }
}

// Entrance ledger (D-293 rule 7)

/** `'present'` renders the end state. There is no hidden state (D-293 rule 8). */
export type EntranceDecision = 'animate' | 'present';

/**
 * Memo for the current surface. Without it the first component to ask would mark the surface
 * greeted and every other reveal on the page would skip. Also keeps the answer stable across
 * re-renders and dev double mounts.
 * KNOWN CEILING: one slot. Two surfaces mounted at once would thrash it; key by surface then.
 */
let currentSurfaceDecision: { surface: string; decision: EntranceDecision } | null = null;

/**
 * Order matters: reduced motion, then tier, then the ledger. The first two return 'present'
 * without marking the ledger, so a greeting is never spent on a visit that didn't show it.
 * Broken storage degrades to always animating, never to hidden.
 */
export function entranceFor(pathname: string | null | undefined): EntranceDecision {
  const surface = surfaceKey(pathname);
  if (currentSurfaceDecision !== null && currentSurfaceDecision.surface === surface) {
    return currentSurfaceDecision.decision;
  }
  const decision = decideEntrance(surface);
  currentSurfaceDecision = { surface, decision };
  return decision;
}

/**
 * What a static prerender would decide. Only used by motion-budget.test.ts, which checks it
 * matches `entranceFor` under prerender conditions in case reveals ever land in exported HTML.
 */
export function prerenderEntranceFor(pathname: string | null | undefined): EntranceDecision {
  return isMotionAllowed('entrance', tierForPath(pathname)) ? 'animate' : 'present';
}

function decideEntrance(surface: string): EntranceDecision {
  if (prefersReducedMotion()) return 'present';
  if (!isMotionAllowed('entrance', tierForSurface(surface))) return 'present';
  if (entranceLedger.hasGreeted(surface)) return 'present';
  entranceLedger.markGreeted(surface);
  return 'animate';
}

/** Tests only. Leaves sessionStorage alone; the ledger has its own lifetime. */
export function resetEntranceMemoForTests(): void {
  currentSurfaceDecision = null;
}
