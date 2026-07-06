'use client';

import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'framer-motion';
import { usePathname } from 'next/navigation';

/**
 * Route-driven warm/cool accent engine (formerly `scroll-accent-engine.tsx`).
 *
 * Renders nothing. Reads the CURRENT ROUTE (`usePathname()`) and animates the
 * SINGLE scroll accent — the CSS custom property `--accent-scroll` — so
 * the app warms to **himalaya** on /nepal/*, cools to **sakura** on /japan/*,
 * and rests at neutral **gold** on every other route. With the v1 sections split
 * across five pages, section-scroll can no longer drive a cross-page
 * accent — the route IS the honest signal. The token names (`--accent-scroll`,
 * `--accent-scroll-rgb`, `--shadow-glow`) are unchanged, so every
 * existing consumer (section-heading underline, glow, :focus-visible fallback)
 * is untouched: this is a drop-in INPUT swap, not a consumer migration.
 *
 * The old outer rAF poll for
 * `document.getElementById('nepal')` existed only because the engine consumed
 * the DOM-anchored `useActiveSection` from the layout root before the page
 * subtree mounted. `usePathname()` has no DOM dependency and is valid
 * immediately, so the outer/inner split and the readiness poll are deleted.
 * (The general rule — a layout-root island consuming a DOM-anchored hook
 * must defer binding — remains true as a pattern; it just has no live consumer.)
 *
 * Motion (CRITICAL): a route-linked colour shift is NOT
 * auto-neutralised by the app's `MotionConfig`/`LazyMotion`. So we keep the
 * explicit `useReducedMotion()` guard: under `prefers-reduced-motion: reduce`
 * the accent is set to the route's target INSTANTLY (no tween — a single
 * settled write of both vars). With motion allowed, a short self-contained
 * `requestAnimationFrame` HSL tween (~320ms, eased) blends from the current
 * colour to the target.
 *
 * Scope: drives `--accent-scroll` ONLY. shadcn's `--accent`
 * (interactive chrome) stays sakura and is never touched here. Dark-only.
 * SSR-safe: every `document` access is guarded and lives in an effect;
 * the pending rAF is cancelled on every change and on unmount.
 */

// ---- Target palette (matches the brand / token-auth accents) ---------------
// Each accent carries BOTH its `hsl` triplet (`[h, s, l]` — degrees, %, %, for
// the `hsl()` var) AND its **authored** `rgb` triplet (`[r, g, b]` 0..255, for
// the `rgba(var(--accent-scroll-rgb) / a)` var). The RGB is the
// **pinned literal**, NOT a value derived from the HSL: standard HSL->RGB does
// not reproduce the brand values (gold rounds to 235,193,76 but the pin is
// 240,199,96 — a visible 20-pt blue gap), so every SETTLED accent must write the
// authored literal verbatim to equal the pinned values byte-for-byte. (Derivation is
// only allowed for intermediate, unpinned tween frames — see the tween below.)
type Hsl = readonly [number, number, number];
type Rgb = readonly [number, number, number];
type Accent = { readonly hsl: Hsl; readonly rgb: Rgb };

const GOLD: Accent = { hsl: [44, 80, 61], rgb: [240, 199, 96] }; // neutral / default
const HIMALAYA: Accent = { hsl: [24, 100, 63], rgb: [255, 140, 66] }; // Nepal (warm)
const SAKURA: Accent = { hsl: [347, 85, 80], rgb: [247, 160, 179] }; // Japan (cool/pink)

/**
 * ROUTE -> accent: only the two destination pages drive the warm/cool
 * shift; every other route rests at neutral gold. Trailing-slash agnostic
 * (`trailingSlash:true` makes `/nepal/` canonical, but compare normalized) and
 * basePath-agnostic (`usePathname()` excludes basePath).
 */
function accentForPathname(pathname: string | null): Accent {
  const p = (pathname ?? '/').replace(/\/+$/, '') || '/';
  if (p === '/nepal' || p.startsWith('/nepal/')) return HIMALAYA;
  if (p === '/japan' || p.startsWith('/japan/')) return SAKURA;
  return GOLD;
}

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
// for a stable, readable computed value. (RGB is written separately — see below —
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
 * globals.css byte-for-byte — including the gold default.
 */
function applySettled(root: HTMLElement, accent: Accent): void {
  writeHsl(root, accent.hsl);
  writeRgb(root, accent.rgb);
}

export default function RouteAccentEngine() {
  const pathname = usePathname();
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
    const target: Accent = accentForPathname(pathname);
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
  }, [pathname, reduceMotion]);

  return null;
}
