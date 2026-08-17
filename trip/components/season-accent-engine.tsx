'use client';

import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'framer-motion';
import { getNow } from '@/lib/trip-now';
import { seasonThemeFor } from '@/lib/season-theme';

/**
 * SeasonAccentEngine — the app-shell background's month/season accent (issue #83).
 *
 * Renders nothing. Writes the CSS custom property `--bg-season` (an "h s% l%" triplet,
 * consumed as `hsl(var(--bg-season) / a)` by the low-alpha body::before wash in
 * app/globals.css) so the page field carries a subtle seasonal tint instead of the flat
 * neutral it seeds at. Mirrors the shape of the now-deleted `route-accent-engine.tsx` (the
 * warm/cool Nepal/Japan scroll accent, git history only) — same reduced-motion-aware HSL
 * tween, same "renders null, mounted once at the layout root" placement — but the RGB half of
 * that engine is dropped: this token has exactly one consumer (the CSS below, `hsl()` syntax
 * only), so there is no legacy `rgba(var(...))` site to keep in sync.
 *
 * ONE-SHOT, not a loop: `getNow()` (lib/trip-now.ts) resolves the `?today=` override ONCE per
 * page load and never changes again during that session, so this effect runs once (empty deps)
 * and tweens from the CSS-authored seed to the resolved month's colour. There is no
 * setInterval polling for a month rollover — a session spanning one is rare, low-stakes for a
 * background wash, and re-syncs on the next load, matching `getTodayInTrip()`'s own "every
 * load re-derives it" precedent. This deliberately stays a single settle, never a running
 * animation — see the D-322 / "infinite decoration" note this file's sibling
 * (`app/globals.css`, the body::before comment) points back to.
 */

const TWEEN_MS = 700;

function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Shortest-path hue interpolation around the 360° wheel.
function lerpHue(a: number, b: number, t: number): number {
  const delta = ((b - a + 540) % 360) - 180;
  return (a + delta * t + 360) % 360;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function writeHsl(root: HTMLElement, [h, s, l]: readonly [number, number, number]): void {
  root.style.setProperty('--bg-season', `${Math.round(h * 10) / 10} ${Math.round(s * 10) / 10}% ${Math.round(l * 10) / 10}%`);
}

export default function SeasonAccentEngine() {
  const reduceMotion = useReducedMotion();
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const target = seasonThemeFor(getNow()).hsl;
    const seedRaw = getComputedStyle(root).getPropertyValue('--bg-season').trim();
    const seedMatch = seedRaw.match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
    const from: readonly [number, number, number] = seedMatch
      ? [Number(seedMatch[1]), Number(seedMatch[2]), Number(seedMatch[3])]
      : target;

    if (reduceMotion) {
      writeHsl(root, target);
      return;
    }

    let start: number | null = null;
    const step = (ts: number) => {
      if (start === null) start = ts;
      const t = Math.min(1, (ts - start) / TWEEN_MS);
      const e = ease(t);
      writeHsl(root, [lerpHue(from[0], target[0], e), lerp(from[1], target[1], e), lerp(from[2], target[2], e)]);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
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
  }, [reduceMotion]);

  return null;
}
