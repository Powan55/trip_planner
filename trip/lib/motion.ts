import { entranceLedger } from '@/core/storage/gateway';

/**
 * The motion system — the one place D-292's loudness gradient and D-293's motion budget are
 * ENFORCED rather than remembered.
 *
 * Everything below exists because a comment saying "at most three entrances per screen" is not
 * a rule, it is a hope. Three mechanisms, each of which something can fail against:
 *
 * 1. THE TIER GATE. `tierForPath()` maps a route to its D-292 tier and `isMotionAllowed()`
 *    answers, for a kind of motion and a tier, whether it is permitted at all. An unknown
 *    route is Tier 3 — the strictest — so a route added without being tiered gets NO
 *    allowance rather than the loudest one. `lib/__tests__/motion-budget.test.ts` fails when
 *    a `page.tsx` exists that no tier list names, so "we forgot to tier it" is a red run and
 *    not a thing anyone has to notice in review.
 *
 * 2. THE ENTRANCE LEDGER (D-293 rule 7). `entranceFor()` returns `'animate'` on the first
 *    view of a surface per browser session and `'present'` on every later one. The record is
 *    sessionStorage, via `entranceLedger` in core/storage/gateway.ts, where the exact reset
 *    semantics are written down beside the key.
 *
 * 3. `prefers-reduced-motion`, IN ONE PLACE. `prefersReducedMotion()` is the only read in this
 *    module, and `entranceFor()` consults it BEFORE anything else, so a caller cannot forget
 *    it — there is no code path through this module that animates under reduce. This also
 *    replaces the five hand-rolled `matchMedia('(prefers-reduced-motion: reduce)')` copies
 *    that had grown across lib/ and components/ — fly-chip, haptics, scroll-to-hash,
 *    command-palette and trip-map — each a chance to get the query string, the SSR guard,
 *    or the sense of the test subtly wrong exactly once. Framer's `useReducedMotion()` is
 *    NOT one of these and stays where it is: inside a React component that needs to
 *    re-render when the preference changes, the reactive hook is the right tool.
 *
 * What is deliberately NOT here: durations. D-293's numbers (200ms tick, 500ms pop, 900ms
 * ceiling, 6s loop floor, 30s ambient) already exist as the `--duration-*` custom properties
 * in app/globals.css, and a second copy in TypeScript would be a hand-synced mirror with
 * nothing tying it to the first.
 *
 * FADE_FLOOR — the entrance opacity every section reveal starts from.
 *
 * / originally PINNED these reveals at `opacity: 1` (a slide with no fade
 * at all). replaces the pin with a FLOOR so the reveals actually reveal.
 *
 * ⚠ THE VALUE IS 0.95, NOT 0.7 — MEASURED, NOT CHOSEN. Recorded as a
 * amendment. 0.7 was implemented first and produced FIVE failing axe specs
 * (`/`, `/plan/`, `/nepal/`, `/japan/`, nepal-filters-open), all `color-contrast
 * [serious]`. The mechanism, confirmed against axe's own numbers:
 *
 * 1. A wrapper `opacity` MULTIPLIES every descendant's alpha. The AA-floor
 * block (globals.css) raises `text-white/25..60` to `rgba(255,255,255,0.62)`,
 * calibrated to clear 4.5:1 AT OPACITY 1 with a thin margin. A wrapper at 0.7
 * makes it an effective 0.434 → composited `#757577` on the page field, 4.25:1.
 * Axe reported exactly `#757577`; compositing 0.62×0.7 white over `#0b0c0e`
 * reproduces that byte-for-byte, so this is arithmetic, not a flake.
 * 2. It is NOT a transient. `whileInView` never fires for content below the fold, so
 * a floored masthead RESTS at the floor indefinitely — axe scans it there. The
 * floor therefore has to be AA-safe on its own, not merely "safe on average".
 *
 * The binding constraint is `text-muted-foreground` on `bg-card`, the app's worst
 * muted-on-light-surface pair. Sweeping the floor against the surfaces and tiers axe
 * actually flagged: 0.70 → 3.23:1, 0.85 → 4.14:1, 0.90 → 4.49:1 (still under), and
 * 0.95 → 4.85:1, the first value that passes. Hence 0.95.
 *
 * BE HONEST ABOUT WHAT THIS BUYS: at 0.95 the opacity change is close to
 * imperceptible. The reveal a user actually sees is the `y` slide. A wrapper-opacity
 * floor cannot deliver a VISIBLE fade in this app without re-breaking the AA floor —
 * if wants a real fade, it needs a different mechanism (e.g. fading a decorative
 * layer rather than the text container), not a different number here.
 *
 * WHY A TS CONSTANT AND NOT A CSS CUSTOM PROPERTY (recorded deviation from the
 * plan): all eight consumers are framer-motion JS values. A framer
 * `initial={{ opacity: … }}` takes a NUMBER — it cannot read `var(--fade-floor)`.
 * Declaring the floor in globals.css would therefore have produced a custom property
 * with zero CSS consumers plus a duplicated JS literal that can silently drift from
 * it — the dead-token defect this codebase already documents at `--radius-sm`. This
 * module is the one place the value exists.
 *
 * NOT applied to `.reveal-view-css` (globals.css `@supports (animation-timeline:
 * view())`), which stays transform-only. A view-timeline animation is a pure function
 * of scroll position and re-plays every time the element re-enters its range, so an
 * opacity fade there would flicker on every scroll-by rather than reveal once.
 *
 * REDUCED MOTION: the floor is for the ANIMATED path only. Every consumer forks on
 * `useReducedMotion()` and lands reduced-motion users at `opacity: 1`, so the floor
 * can never leave content resting at 70% for someone who asked for less motion.
 */
export const FADE_FLOOR = 0.95;

// ── The tier gate (D-292) ───────────────────────────────────────────────────────────────────

/**
 * The three permission tiers of the loudness gradient. Tier 3 is the SAME system with its
 * permissions revoked, not a second design — same canvas, same type, same tap targets.
 */
export type MotionTier = 1 | 2 | 3;

/**
 * The kinds of motion the gate rules on, and there is nothing outside them.
 * - `entrance` — a scroll-reveal or hero entrance (D-293 rule 7).
 * - `loop` — anything that repeats forever (rule 1).
 * - `tick` / `pop` / `burst` — the three celebration weights (rule 6), in escalation order.
 */
export type MotionKind = 'entrance' | 'loop' | 'tick' | 'pop' | 'burst';

/** Tier 1 · STAGE — the front door and the surfaces whose job is anticipation. */
export const TIER_1_SURFACES: readonly string[] = ['/', '/recap', '/trips'];

/** Tier 2 · GALLERY — content routes. The photographic header band is the whole allowance. */
export const TIER_2_SURFACES: readonly string[] = [
  '/guides',
  '/nepal',
  '/japan',
  '/map',
  '/journal',
  '/flights',
];

/**
 * Tier 3 · DESK — the working screens, used one-handed, outdoors, in the cold. Listed for
 * completeness and for the route-coverage test; it is NOT what `tierForPath` falls back to.
 * The fallback is the tier, not the list, so an unlisted route is still Tier 3.
 *
 * D-292 also places every dialog, sheet, popover and form in Tier 3 regardless of which route
 * opens it. That half is NOT enforced here: no overlay primitive asks this module for
 * permission yet, and a route path cannot tell you that a dialog is open. Wiring it belongs
 * with the slice that touches the dialog primitives.
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
  // `/profile` (issue #4). D-292's Tier 1 line names "passport/profile", and this is the
  // narrower reading on purpose: that clause describes the STAGE surface — the passport, its
  // stamps, the collection — while this route is a data-entry form and nothing else, which the
  // same decision places in Tier 3 "regardless of which route opens it". Tiering it 1 would hand
  // the loudest permissions in the product to a screen made of a select, a text field and a list.
  // If the passport page (issue #5) lands as `/passport`, THAT is the Tier 1 candidate.
  '/profile',
];

/**
 * The surface a pathname belongs to — the unit D-293 rule 7 governs, which is the route and
 * NOT the component. `/nepal/`, `/nepal` and `/nepal/anything` are one surface.
 *
 * Returns `''` for a pathname that is absent or malformed. That is a real case, not a
 * defensive flourish: `usePathname()` returns `null` when no app router is mounted (a unit
 * test harness), and `''` is deliberately NOT `'/'` so an unrouted render cannot be mistaken
 * for the front door and handed Tier 1's permissions.
 */
export function surfaceKey(pathname: string | null | undefined): string {
  // The leading slash is REQUIRED, and that is the whole guard. Without it, `'nepal'.split('/')`
  // is `['nepal']`, index 1 is undefined, and the `first === ''` branch below returned `'/'` —
  // handing a malformed pathname the front door's Tier 1, the loudest permissions in the product,
  // which is the exact case this function's caller is defending against. A real `usePathname()`
  // always starts with `/`, so anything that does not is unrouted, not a route.
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

/**
 * The tier of a route path. Unknown or unroutable ⇒ Tier 3.
 *
 * The default runs toward silence on purpose. A new route that nobody tiered gets no
 * allowance, which is a missing entrance somebody notices, rather than the loudest
 * permissions in the product on a screen that was never designed for them.
 */
export function tierForPath(pathname: string | null | undefined): MotionTier {
  return tierForSurface(surfaceKey(pathname));
}

/**
 * The permission table, straight from D-292 (the three tier sections) and D-293 rule 6 (the
 * escalation table). This is the whole tier gate; everything else is lookup.
 */
const PERMITTED_TIERS: Readonly<Record<MotionKind, readonly MotionTier[]>> = {
  // Tier 3 forbids scroll-reveal entrances outright — content is simply present.
  entrance: [1, 2],
  // Rule 1: at most one ambient loop, and only on a Tier-1 surface.
  loop: [1],
  // Rule 6: a tick is colour and a mark with no movement, so every tier keeps it.
  tick: [1, 2, 3],
  pop: [1, 2],
  burst: [1],
};

/** Whether a kind of motion is permitted at all on a tier. */
export function isMotionAllowed(kind: MotionKind, tier: MotionTier): boolean {
  return PERMITTED_TIERS[kind].includes(tier);
}

// ── prefers-reduced-motion, in one place ────────────────────────────────────────────────────

/**
 * The app's single non-React read of the reduced-motion preference. SSR-safe and total: with
 * no window, no `matchMedia`, or a `matchMedia` that throws, it reports `false` — because the
 * CSS `@media (prefers-reduced-motion: reduce)` block in app/globals.css and framer's
 * `<MotionConfig reducedMotion="user">` are still underneath, and this must never be the thing
 * that takes a render down.
 *
 * Read LIVE at each call rather than latched, unlike framer's `useReducedMotion()` (which
 * caches a module-level singleton on its first call). A caller that needs to react to the
 * preference changing mid-session should use the framer hook; this one answers "what is true
 * right now", which is what a one-shot decision such as an entrance wants.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)')?.matches === true;
  } catch {
    return false;
  }
}

// ── The entrance ledger (D-293 rule 7) ──────────────────────────────────────────────────────

/**
 * `'animate'` — play the entrance. `'present'` — render at the END state with no transition.
 *
 * There is no third value, and in particular there is no "hidden". D-293 rule 8: every path
 * forks to its end state, never to nothing.
 */
export type EntranceDecision = 'animate' | 'present';

/**
 * The decision for the surface currently being rendered.
 *
 * WHY THIS EXISTS AND NOT JUST THE sessionStorage READ: a surface has many entrance
 * components on it, and R7's unit is the SURFACE. Without this, the first component to ask
 * would claim the ledger entry and every other one on the same page would be told it had
 * already been greeted — the first visit would animate exactly one element. One slot is
 * enough because only one surface is ever mounted at a time; moving to another route replaces
 * it, and coming back re-reads the ledger and correctly finds the surface already greeted.
 *
 * It also makes the answer stable across a re-render or a development-mode double mount,
 * which is what stops the greeting being spent on a render nobody saw.
 *
 * KNOWN CEILING: one slot, replaced whenever the surface changes. Two surfaces rendered at
 * once — a route transition that cross-fades the outgoing page, say — would thrash it. Key it
 * by surface in a Map if that ever ships.
 */
let currentSurfaceDecision: { surface: string; decision: EntranceDecision } | null = null;

/**
 * Should this surface play its entrance?
 *
 * The whole decision, in the order it is made — and the order is the contract:
 *
 * 1. **Reduced motion wins first.** Returns `'present'` and does NOT consume the ledger, so a
 *    reduced-motion visit never spends a greeting the user was not shown. This is the check no
 *    caller has to remember, because there is no way into this function that skips it.
 * 2. **Then the tier gate.** A Tier-3 surface is `'present'`, and again does not consume the
 *    ledger — so if a route is ever re-tiered, its first visit in a later session is still a
 *    first visit.
 * 3. **Then the ledger.** Already greeted this session ⇒ `'present'`. Otherwise mark it and
 *    ⇒ `'animate'`.
 *
 * Total: unreadable or disabled storage makes step 3 report "not greeted" forever, so the
 * degraded behaviour is "always animate", never "always hidden".
 *
 * SSR: `prefersReducedMotion()` is `false` and the ledger reads empty, so a prerender of a
 * Tier-1/2 route always resolves `'animate'` — the exported HTML is identical for every
 * visitor, and the first client render is the only place a returning visitor differs.
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

function decideEntrance(surface: string): EntranceDecision {
  if (prefersReducedMotion()) return 'present';
  if (!isMotionAllowed('entrance', tierForSurface(surface))) return 'present';
  if (entranceLedger.hasGreeted(surface)) return 'present';
  entranceLedger.markGreeted(surface);
  return 'animate';
}

/**
 * Drop the in-memory surface decision. FOR TESTS ONLY.
 *
 * It deliberately does NOT touch sessionStorage: the memo and the ledger are two different
 * things with two different lifetimes, and a single "reset everything" helper is how you end
 * up with a test that passes because it cleared the wrong one.
 */
export function resetEntranceMemoForTests(): void {
  currentSurfaceDecision = null;
}
