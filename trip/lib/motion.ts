/**
 * Shared motion constants.
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
