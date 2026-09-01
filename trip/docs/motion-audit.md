# S211: route-by-route motion audit (reduced-motion completeness + idiom conformity)

**Date:** 2026-07-19 · **Method:** every route driven under emulated `prefers-reduced-motion: reduce`
against the served production `out/` build, with the running animation set read directly off the
live timeline via `document.getAnimations()` (filtered to `playState === 'running'` with computed
active duration > 50ms, so the 0.01ms CSS collapses drop out). This is a measured check, not a
selector inventory: any unguarded framer spring, stray CSS loop, or scroll-timeline animation on
any route shows up regardless of whether we knew its selector. Permanent regression net:
`e2e/motion-reduced-audit.spec.ts` (15 tests, run twice, green both).

## The motion system (what "the established idiom" means)

| Layer | Idiom | Reduced-motion mechanism |
|---|---|---|
| Declarative framer | `m.*` via `LazyMotion strict` (D-056c); raw `motion.*` throws in dev | `MotionConfig reducedMotion="user"` (transforms disabled; opacity may fade — framer's own semantics) |
| CSS keyframes/transitions | token durations in `globals.css` | global `@media (prefers-reduced-motion)` collapse to 0.01ms + explicit `animation: none` for every infinite/forwards keyframe |
| Scroll-linked (framer `useScroll`) | ranges collapsed to constants under reduce (D-056b) | explicit `useReducedMotion()` at each hook site |
| Scroll-driven CSS (`animation-timeline`) | `@supports` + retained-JS fallback (D-179) | reduced motion never renders the timeline path (component-level guard) |
| View Transitions | manual `useViewTransition()` (D-171) | rung 1 = plain push, no VT, plus `::view-transition-*` CSS kill |
| rAF count-ups | `useCountUp` (D-056b) | final value instantly |
| Card tilt (D-206) | `hooks/use-card-tilt.ts` | hook attaches no listeners, returns no style |
| Celebrations/haptics (D-207) | `celebration-burst.tsx`, `lib/haptics.ts` | explicit `useReducedMotion()` / `matchMedia` gate; nothing renders or vibrates |
| Travel hero flip (D-185) | React-level spring-free branch | `data-flip-animated="false"` |

**Idiom conformity check:** `grep` over `components/ app/ hooks/ lib/` found **zero raw `motion.*`
imports** (all framer goes through `m.*`; the only textual hits are explanatory comments). The only
`useScroll`/`useSpring` consumers are `hero-section.tsx`, `scroll-progress.tsx` and
`use-card-tilt.ts`, each of which carries its explicit reduced-motion guard. No CSS animation
outside the `globals.css` token set was found.

## Route × surface × verdict

Everything measured at S212 **PASS** (zero persistently-running animations under reduce; poll to 6s
so compliant one-shot opacity fades finish, see the tolerance section below). "Shared chrome" =
navbar, tab bar, scroll-progress bar, route fade, VT, ambient `body::before` drift, sync badge,
toasts. All of it is proven neutralized by `motion.spec.ts` (surface-level) and re-proven here
(route-level). The permanent net is 15 measurements: the 14 routes in the table below (13 in
`e2e/motion-reduced-audit.spec.ts`'s `ROUTES` array plus `/travel/`, which is a separate test
because it needs an in-trip clock and a seeded day), and the `/`-scrolled case.

> **Coverage gap closed (2026-08-31, issue #351).** `/guides/`, `/more/`, `/trips/` and `/profile/`
> joined `e2e/motion-reduced-audit.spec.ts`'s `ROUTES`, which now covers all 18 static routes plus
> `/travel/`. The last three go through a new `READY` map: their surface is a mount-gated list or an
> `ssr:false` island, and an empty shell has nothing running, so the poll would have passed for free.
> The table below still lists the S212 set and does not carry rows for the later additions.

| Route | Motion surfaces beyond shared chrome | Verdict |
|---|---|---|
| `/` | Hero 5-layer scroll parallax (collapsed ranges), **hero glow layer: defect found and fixed (below)**, count-up countdown, `pulse-glow`/`float` loops, scroll-cue (fade + chevron y-loop), countdown ring (D-216: transition suppressed, snaps per tick), bento reveals, in-trip Today panel | PASS (after fix) |
| `/plan/` | Calendar micro-interactions (`today-pulse`, `undo-ring`, `drag-lift`, all CSS `animation:none`), add/edit dialogs (AnimatePresence declarative), budget/burn-rate reveals | PASS |
| `/nepal/` | Recommendation card 3D tilt (D-206: hook fully absent under reduce), card hover lift/zoom (CSS collapse + MotionConfig), reveals, photography guide | PASS |
| `/japan/` | Same as `/nepal/` | PASS |
| `/map/` | Marker/filter transitions; MapLibre WebGL canvas (not DOM animation; pan/zoom is user-driven, out of scope for `getAnimations`) | PASS |
| `/journal/` | List/editor reveals | PASS |
| `/flights/` | Reveals only | PASS |
| `/safety/` | Reveals only | PASS |
| `/recap/` | Day story (post-trip gated), Wrapped story (D-215: celebration burst reduced-motion gated) | PASS |
| `/settings/` | Panel reveals, trip group | PASS |
| `/packing/` | Progress + celebration burst (D-207 explicit guard) | PASS |
| `/share/` | Inbox list reveals | PASS |
| `/checklist/` | Row reveals | PASS |
| `/travel/` (in-trip, seeded) | Hero flip (D-185 `data-flip-animated="false"` asserted), agenda rows, day-strip auto-centre (`behavior:'auto'` under reduce), legibility toggle | PASS |
| `/` scrolled to bottom | Scroll-progress (D-179 JS path), scroll-accent engine (`applySettled` instant, D-062), reveal-on-scroll | PASS |

## Defect found and fixed

**Hero glow layer ran a permanent WAAPI `ViewTimeline` animation under reduced motion.**
`components/hero-section.tsx` bound the scroll-linked `glowOpacity`/`glowY` MotionValues to the
radial-glow layer. framer hardware-accelerates scroll-linked `opacity` into a WAAPI animation on a
`ViewTimeline`; with the D-056b collapsed ranges (`[1,1]`) it was visually inert but permanently
`running`. That is exactly the class D-179 forbids ("reduced motion NEVER uses the scroll-timeline
path"), and the 0.01ms idiom cannot neutralize a progress timeline. The fix: under
`useReducedMotion()` the scroll-linked style props are not bound at all, leaving a static layer
whose rendered pixels are identical (y=0/opacity=1 are the collapsed ranges' resting values).
Regression proof: the `/` and `/`-scrolled audit tests failed before the fix (`ViewTimeline`
animation in the running set) and pass after; visual pack 0-drift; `motion.spec.ts` unchanged-green.

The transform-driven parallax layers (photo/silhouette/orbs) do not get WAAPI-accelerated (framer
drives them per-frame) and produce no timeline entries with collapsed ranges, so they are left on
the established D-056b idiom. If framer ever accelerates them, this net catches it.

## Documented tolerance (not a defect)

Short **one-shot opacity-only fades** still play under reduced motion (e.g. the hero scroll-cue's
`delay: 2` opacity fade; entrance reveals' opacity-only reduced branches). This is framer's own
`MotionConfig reducedMotion="user"` contract (transforms disabled, opacity/color may animate) and
the codebase's recorded idiom (D-100 full-opacity reveals; `hero-section.tsx` `showReduced`). The
audit therefore polls the running set to empty (6s) instead of demanding an instantaneous empty
set: one-shots finish and pass; infinite loops, scroll timelines, and stuck springs never empty
the set and fail. The chevron's infinite `y` bounce inside the scroll cue is transform-driven and
is disabled by MotionConfig (verified absent from the running set).

## Coverage relationship

- `e2e/motion.spec.ts` (S84/S134/S179/S180): surface-level computed-style proofs (kept, untouched).
- `e2e/motion-reduced-audit.spec.ts` (S211, this audit): route-complete `getAnimations()` net; the permanent gate.
- `tm-acceptance.spec.ts` TM-12: `/travel` reduced-motion branch on both iPhone projects.
