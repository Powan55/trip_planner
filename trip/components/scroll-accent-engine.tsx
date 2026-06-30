'use client';

import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useActiveSection } from '@/hooks/use-active-section';

/**
 * Scroll-driven warm/cool accent engine (, M11 centerpiece).
 *
 * Renders nothing. Reads the active in-page section ('s `useActiveSection`)
 * and animates the SINGLE scroll accent — the CSS custom property
 * `--accent-scroll` (added in ) — so the page warms to **himalaya** over
 * Nepal, cools to **sakura** over Japan, and rests at neutral **gold**
 * everywhere else. The consumers were already wired in (the section-heading
 * gradient underline, the `:focus-visible` ring, `--shadow-glow`, and the
 * `pulse-glow` keyframe all read `hsl(var(--accent-scroll))`), and the
 * scroll-progress bar reads it too — so this component is purely the DRIVER of
 * the var, not new styling. It writes BOTH `--accent-scroll` (an `H S% L%`
 * triplet for `hsl`) and `--accent-scroll-rgb` (an `r, g, b` list for
 * `rgba(var(--accent-scroll-rgb) / a)` consumers), keeping the two in lockstep.
 *
 * Motion (/ CRITICAL): a scroll-LINKED colour shift is NOT
 * auto-neutralised by the app's `MotionConfig`/`LazyMotion`. So we add an
 * explicit `useReducedMotion` guard: under `prefers-reduced-motion: reduce`
 * the accent is set to the active section's target INSTANTLY (no tween, single
 * write). With motion allowed, a short self-contained `requestAnimationFrame`
 * HSL tween (~320ms, eased) blends from the current colour to the target — no
 * framer `MotionValue`, no globals.css edit, no scroll-handler thrash (the work
 * is gated by section CHANGES, which the IO-based spy already throttles).
 *
 * Mount timing (important): this island is mounted at the app root in
 * `layout.tsx`, as a SIBLING of `{children}`. On first commit its effects run
 * BEFORE the deep page tree (the sections) has mounted, so at that instant
 * `document.getElementById('nepal')` etc. are still null. `useActiveSection`
 * attaches its IntersectionObservers once (keyed on the id list) and would
 * otherwise register against zero elements and never re-run. To avoid that we
 * split the component: the outer `ScrollAccentEngine` waits until the section
 * anchors actually exist in the DOM, then mounts the inner `AccentDriver`
 * which only THEN calls `useActiveSection`, so the spy binds to real elements.
 * (The navbar's own spy doesn't need this because it renders inside the page
 * subtree, after the sections.)
 *
 * Scope: drives `--accent-scroll` ONLY. shadcn's `--accent`
 * (interactive chrome) stays sakura and is never touched here. Dark-only
 *. SSR-safe: every `document`/`window` access is guarded and lives in an
 * effect; the pending rAF is cancelled on every change and on unmount.
 */

// Target palette (matches the brand / token-auth accents) --------------
// Each accent carries BOTH its `hsl` triplet (`[h, s, l]` — degrees, %, %, for
// the `hsl` var) AND its **authored** `rgb` triplet (`[r, g, b]` 0..255, for
// the `rgba(var(--accent-scroll-rgb) / a)` var). The RGB is the / globals
// .css **pinned literal**, NOT a value derived from the HSL: standard HSL->RGB
// does not reproduce the brand values (gold rounds to 235,193,76 but pins
// 240,199,96 — a visible 20-pt blue gap), so every SETTLED accent must write the
// authored literal verbatim to equal byte-for-byte. (Derivation is only
// allowed for intermediate, unpinned tween frames — see the tween below.)
type Hsl = readonly [number, number, number];
type Rgb = readonly [number, number, number];
type Accent = { readonly hsl: Hsl; readonly rgb: Rgb };

const GOLD: Accent = { hsl: [44, 80, 61], rgb: [240, 199, 96] }; // neutral / default
const HIMALAYA: Accent = { hsl: [24, 100, 63], rgb: [255, 140, 66] }; // Nepal (warm)
const SAKURA: Accent = { hsl: [347, 85, 80], rgb: [247, 160, 179] }; // Japan (cool/pink)

/**
 * SECTION -> accent map. Only the two destination sections drive the warm/cool
 * shift; every other section rests at neutral gold. Keeping photography / map /
 * inspiration neutral (rather than tinting them) makes the page's single signal
 * legible: "the accent warms over Nepal and cools over Japan", with gold as the
 * calm baseline between and around them.
 */
const SECTION_ACCENTS: Record<string, Accent> = {
  hero: GOLD,
  dashboard: GOLD,
  timeline: GOLD,
  itinerary: GOLD,
  flights: GOLD,
  nepal: HIMALAYA,
  japan: SAKURA,
  photography: GOLD,
  nightlife: GOLD,
  map: GOLD,
  inspiration: GOLD,
};

/**
 * The full set of in-page anchors in DOCUMENT ORDER — the order
 * `useActiveSection` relies on for its "last section past the trigger line"
 * pick. It is a superset of the navbar's anchors (which omit hero/dashboard/
 * timeline/nightlife), so the engine tracks the active section across the whole
 * page, not just the linked ones.
 */
const SECTION_IDS = [
  'hero',
  'dashboard',
  'timeline',
  'itinerary',
  'flights',
  'nepal',
  'japan',
  'photography',
  'nightlife',
  'map',
  'inspiration',
];

const TWEEN_MS = 320;

// easeInOutCubic — symmetric, premium ease for the colour blend.
function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Shortest-path hue interpolation around the 360° wheel (e.g. gold 44° -> sakura
// 347° goes the short way through 0°, not the long way down through 200°).
function lerpHue(a: number, b: number, t: number): number {
  const delta = ((b - a + 540) % 360) - 180;
  return (a + delta * t + 360) % 360;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Write the `--accent-scroll` HSL var from an HSL triplet. Rounds to 0.1° / 0.1%
// for a stable, readable computed value. (RGB is written separately — see below
// because at settled endpoints it must be the AUTHORED literal, not derived.)
function writeHsl(root: HTMLElement, [h, s, l]: readonly [number, number, number]): void {
  const hr = Math.round(h * 10) / 10;
  const sr = Math.round(s * 10) / 10;
  const lr = Math.round(l * 10) / 10;
  root.style.setProperty('--accent-scroll', `${hr} ${sr}% ${lr}%`);
}

function writeRgb(root: HTMLElement, [r, g, b]: readonly [number, number, number]): void {
  root.style.setProperty('--accent-scroll-rgb', `${r}, ${g}, ${b}`);
}

/**
 * Write a SETTLED accent — a pinned endpoint (reduced-motion target, the
 * "already there" no-op, or the final frame of a tween). The HSL var is written
 * from `accent.hsl`; the RGB var is the **authored literal** `accent.rgb` written
 * verbatim (NEVER recomputed from the HSL), so every resting accent equals
 * / globals.css byte-for-byte — including the gold default.
 */
function applySettled(root: HTMLElement, accent: Accent): void {
  writeHsl(root, accent.hsl);
  writeRgb(root, accent.rgb);
}

/**
 * Inner driver — mounted by `ScrollAccentEngine` only AFTER the section anchors
 * exist, so `useActiveSection` binds its observers to real elements. Renders
 * null; its sole job is to translate the active section into the accent var.
 */
function AccentDriver() {
  const activeId = useActiveSection(SECTION_IDS);
  const reduceMotion = useReducedMotion();

  // The LIVE on-screen accent (HSL + RGB), so a tween can blend FROM the exact
  // current colour even if a new target arrives mid-flight — at a settled rest
  // this equals the authored literal; mid-tween it is the current intermediate
  // (which is itself in-flight, so blending on from it is fine — it still ends
  // on an authored literal). Seeded to gold (the default).
  const liveRef = useRef<{ hsl: Hsl; rgb: Rgb }>({ hsl: GOLD.hsl, rgb: GOLD.rgb });
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const root = document.documentElement;
    const target: Accent = (activeId && SECTION_ACCENTS[activeId]) || GOLD;
    const from = liveRef.current;

    // Cancel any in-flight tween before starting a new one / setting instantly.
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    // Reduced motion: jump straight to the target — a single SETTLED
    // write of the authored literal, no rAF.
    if (reduceMotion) {
      liveRef.current = { hsl: target.hsl, rgb: target.rgb };
      applySettled(root, target);
      return;
    }

    // Already there — nothing to animate; re-assert the SETTLED authored literal.
    if (
      from.hsl[0] === target.hsl[0] &&
      from.hsl[1] === target.hsl[1] &&
      from.hsl[2] === target.hsl[2]
    ) {
      liveRef.current = { hsl: target.hsl, rgb: target.rgb };
      applySettled(root, target);
      return;
    }

    const fromHsl = from.hsl;
    const fromRgb = from.rgb;
    let start: number | null = null;
    const step = (ts: number) => {
      if (start === null) start = ts;
      const t = Math.min(1, (ts - start) / TWEEN_MS);
      if (t < 1) {
        // In-flight frame (0 < t < 1): intermediate colours aren't pinned, so we
        // interpolate the HSL var AND interpolate the authored RGB channels
        // directly between the two endpoints. The tween still ENDS on the
        // authored literal (the t === 1 branch), never on a derived value.
        const e = ease(t);
        const hsl: Hsl = [
          lerpHue(fromHsl[0], target.hsl[0], e),
          lerp(fromHsl[1], target.hsl[1], e),
          lerp(fromHsl[2], target.hsl[2], e),
        ];
        const rgb: Rgb = [
          Math.round(lerp(fromRgb[0], target.rgb[0], e)),
          Math.round(lerp(fromRgb[1], target.rgb[1], e)),
          Math.round(lerp(fromRgb[2], target.rgb[2], e)),
        ];
        liveRef.current = { hsl, rgb };
        writeHsl(root, hsl);
        writeRgb(root, rgb);
        rafRef.current = requestAnimationFrame(step);
      } else {
        // Final frame: land EXACTLY on the authored endpoint (HSL + literal RGB).
        liveRef.current = { hsl: target.hsl, rgb: target.rgb };
        applySettled(root, target);
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [activeId, reduceMotion]);

  return null;
}

export default function ScrollAccentEngine() {
  // Gate the spy-consuming driver until the section anchors actually exist in the
  // DOM (see the mount-timing note above). We poll with rAF — cheap, runs only
  // until the first frame where a representative anchor is present (typically the
  // very next frame after the page subtree hydrates), then stops.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (document.getElementById('nepal')) {
      setReady(true);
      return;
    }
    let raf = 0;
    const poll = () => {
      if (document.getElementById('nepal')) {
        setReady(true);
        return;
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return ready ? <AccentDriver /> : null;
}
