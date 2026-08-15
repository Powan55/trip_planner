// @vitest-environment jsdom
//
// Issue #24 — the motion system. D-292's tier gate and D-293 rule 7's entrance ledger are
// mechanisms, so this is the file that fails when one of them stops being one.
//
// The three things worth knowing before editing:
//
// 1. The ROUTE-COVERAGE test reads `app/` off disk. It is the ratchet: add a route without
//    tiering it and this goes red, which is the whole reason the tier lists are data and not
//    a paragraph in a comment. Same shape as lib/__tests__/text-tier-sweep.test.ts.
// 2. The ledger tests must reset TWO things — `resetEntranceMemoForTests()` (the in-visit
//    memo) and `sessionStorage` (the ledger). They are deliberately separate, because a test
//    that clears only one of them can pass for the wrong reason.
// 3. jsdom has no `window.matchMedia`, so "motion not reduced" is the default and needs no
//    stub. The reduced case installs one, in the same shape lib/__tests__/fly-chip.test.ts
//    already uses.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  TIER_1_SURFACES,
  TIER_2_SURFACES,
  TIER_3_SURFACES,
  entranceFor,
  isMotionAllowed,
  prefersReducedMotion,
  resetEntranceMemoForTests,
  surfaceKey,
  tierForPath,
  tierForSurface,
  type MotionKind,
  type MotionTier,
} from '@/lib/motion';
import { STORAGE_KEYS, entranceLedger } from '@/core/storage/gateway';

const APP_DIR = resolve(__dirname, '../../app');

/** Every top-level route that actually has a page, read off disk rather than restated. */
function routesOnDisk(): string[] {
  const found: string[] = [];
  if (existsSync(resolve(APP_DIR, 'page.tsx'))) found.push('/');
  for (const entry of readdirSync(APP_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (existsSync(resolve(APP_DIR, entry.name, 'page.tsx'))) found.push(`/${entry.name}`);
  }
  return found.sort();
}

function setReducedMotion(matches: boolean): void {
  window.matchMedia = ((q: string) => ({
    matches,
    media: q,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false;
    },
  })) as unknown as typeof window.matchMedia;
}

function clearMatchMedia(): void {
  delete (window as { matchMedia?: unknown }).matchMedia;
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  resetEntranceMemoForTests();
  clearMatchMedia();
});

afterEach(() => {
  clearMatchMedia();
});

describe('the tier gate — every route is tiered, and an untiered one fails here', () => {
  // Fails CLOSED: an empty disk read would make every assertion below vacuously true.
  it('finds the app routes on disk', () => {
    expect(routesOnDisk().length).toBeGreaterThan(10);
    expect(routesOnDisk()).toContain('/');
  });

  it('every route with a page.tsx is named by exactly one tier list', () => {
    const listed = [...TIER_1_SURFACES, ...TIER_2_SURFACES, ...TIER_3_SURFACES];
    for (const route of routesOnDisk()) {
      const hits = listed.filter((s) => s === route);
      expect(
        hits.length,
        `${route} exists but no tier list names it (or two do) — tier it in lib/motion.ts`,
      ).toBe(1);
    }
  });

  it('every listed surface is a route that exists — the lists cannot rot', () => {
    const onDisk = routesOnDisk();
    for (const surface of [...TIER_1_SURFACES, ...TIER_2_SURFACES, ...TIER_3_SURFACES]) {
      expect(onDisk, `${surface} is tiered but has no page.tsx`).toContain(surface);
    }
  });

  it('an unknown route is Tier 3, not Tier 1', () => {
    // The direction of the default is the point: a screen nobody designed gets silence, not
    // the loudest permissions in the product.
    expect(tierForPath('/passport')).toBe(3);
    expect(tierForPath('/some-route-added-next-year')).toBe(3);
  });

  it('an unrouted render (usePathname() === null) is Tier 3', () => {
    expect(tierForPath(null)).toBe(3);
    expect(tierForPath(undefined)).toBe(3);
    expect(tierForPath('')).toBe(3);
  });

  it('the tiers are the ones D-292 ruled', () => {
    expect(tierForPath('/')).toBe(1);
    expect(tierForPath('/recap/')).toBe(1);
    expect(tierForPath('/trips/')).toBe(1);
    expect(tierForPath('/nepal/')).toBe(2);
    expect(tierForPath('/map/')).toBe(2);
    expect(tierForPath('/plan/')).toBe(3);
    expect(tierForPath('/travel/')).toBe(3);
    expect(tierForPath('/checklist/')).toBe(3);
  });
});

describe('surfaceKey — the unit rule 7 governs is the surface, not the component', () => {
  it('collapses trailing slashes and sub-paths onto one surface', () => {
    expect(surfaceKey('/nepal')).toBe('/nepal');
    expect(surfaceKey('/nepal/')).toBe('/nepal');
    expect(surfaceKey('/nepal/kathmandu/')).toBe('/nepal');
    expect(surfaceKey('/')).toBe('/');
  });

  it('an absent or malformed pathname is NOT the front door', () => {
    // '' rather than '/' deliberately: an unrouted render must not inherit Tier 1.
    expect(surfaceKey(null)).toBe('');
    expect(surfaceKey(undefined)).toBe('');
    expect(surfaceKey('')).toBe('');
    expect(surfaceKey('nepal')).toBe('');
    expect(tierForSurface(surfaceKey(null))).toBe(3);
  });
});

describe('the tier gate — the permission table (D-292 sections 3.1-3.3, D-293 rule 6)', () => {
  const kinds: MotionKind[] = ['entrance', 'loop', 'tick', 'pop', 'burst'];
  const tiers: MotionTier[] = [1, 2, 3];

  it('Tier 1 permits everything', () => {
    for (const kind of kinds) expect(isMotionAllowed(kind, 1), kind).toBe(true);
  });

  it('Tier 3 permits the tick and nothing else', () => {
    expect(isMotionAllowed('tick', 3)).toBe(true);
    for (const kind of ['entrance', 'loop', 'pop', 'burst'] as MotionKind[]) {
      expect(isMotionAllowed(kind, 3), `${kind} must be forbidden on the working screens`).toBe(
        false,
      );
    }
  });

  it('a loop is Tier 1 only, and a burst is Tier 1 only (rules 1 and 6)', () => {
    expect(isMotionAllowed('loop', 2)).toBe(false);
    expect(isMotionAllowed('loop', 3)).toBe(false);
    expect(isMotionAllowed('burst', 2)).toBe(false);
    expect(isMotionAllowed('burst', 3)).toBe(false);
  });

  it('answers for every kind on every tier — no undefined hole in the table', () => {
    for (const kind of kinds) {
      for (const tier of tiers) expect(typeof isMotionAllowed(kind, tier)).toBe('boolean');
    }
  });
});

describe('prefers-reduced-motion — one read, and it never throws', () => {
  it('reports the preference when matchMedia is present', () => {
    setReducedMotion(true);
    expect(prefersReducedMotion()).toBe(true);
    setReducedMotion(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it('reports false, rather than throwing, when matchMedia is absent or broken', () => {
    clearMatchMedia();
    expect(prefersReducedMotion()).toBe(false);
    window.matchMedia = (() => {
      throw new Error('nope');
    }) as unknown as typeof window.matchMedia;
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe('the entrance ledger (D-293 rule 7)', () => {
  it('the first view of a Tier-1 surface animates and is recorded', () => {
    expect(entranceFor('/')).toBe('animate');
    expect(entranceLedger.hasGreeted('/')).toBe(true);
  });

  it('every entrance on the SAME surface gets the same answer in one visit', () => {
    // Without this, the first component to ask would spend the ledger entry and every other
    // reveal on the page would be told the surface had already been greeted.
    expect(entranceFor('/nepal/')).toBe('animate');
    expect(entranceFor('/nepal/')).toBe('animate');
    expect(entranceFor('/nepal/kathmandu/')).toBe('animate');
    expect(window.sessionStorage.getItem(STORAGE_KEYS.motionEntranceSeen)).toBe('/nepal');
  });

  it('a LATER visit to the same surface in the same session is present, not animated', () => {
    expect(entranceFor('/nepal/')).toBe('animate');
    expect(entranceFor('/japan/')).toBe('animate'); // navigate away
    expect(entranceFor('/nepal/')).toBe('present'); // and back
  });

  it('is sessionStorage and never localStorage — a new session is a new greeting', () => {
    entranceFor('/recap/');
    expect(window.sessionStorage.getItem(STORAGE_KEYS.motionEntranceSeen)).toBe('/recap');
    expect(window.localStorage.getItem(STORAGE_KEYS.motionEntranceSeen)).toBeNull();
  });

  it('a Tier-3 surface never animates, and never spends its ledger entry', () => {
    for (const surface of TIER_3_SURFACES) {
      resetEntranceMemoForTests();
      expect(entranceFor(`${surface}/`), surface).toBe('present');
      expect(entranceLedger.hasGreeted(surface), `${surface} spent its greeting`).toBe(false);
    }
  });

  it('an unrouted render is present', () => {
    expect(entranceFor(null)).toBe('present');
  });

  it('reduced motion is present, and does NOT spend the greeting', () => {
    setReducedMotion(true);
    expect(entranceFor('/')).toBe('present');
    expect(entranceLedger.hasGreeted('/')).toBe(false);

    // Turn the preference off in a later visit: the surface is still owed its first greeting.
    setReducedMotion(false);
    resetEntranceMemoForTests();
    expect(entranceFor('/')).toBe('animate');
  });

  it('unreadable storage degrades to ALWAYS ANIMATE, never to hidden', () => {
    // Private-browsing / disabled storage. Rule 8's direction: no path may leave content at
    // its start state, so the safe failure is a re-greeted surface, not a blank one.
    const real = window.sessionStorage;
    const throwing = {
      getItem() {
        throw new Error('storage disabled');
      },
      setItem() {
        throw new Error('storage disabled');
      },
      removeItem() {
        throw new Error('storage disabled');
      },
      clear() {},
      key() {
        return null;
      },
      length: 0,
    } as unknown as Storage;
    Object.defineProperty(window, 'sessionStorage', { configurable: true, value: throwing });
    try {
      expect(entranceFor('/')).toBe('animate');
      resetEntranceMemoForTests();
      expect(entranceFor('/')).toBe('animate');
    } finally {
      Object.defineProperty(window, 'sessionStorage', { configurable: true, value: real });
    }
  });
});

/**
 * Issue #25 — the front door's ambient loop, checked in the CSS rather than in a comment.
 *
 * D-293 R1 gives a Tier-1 surface AT MOST ONE ambient loop and R2 puts the floor for any loop at
 * 6s. The front door spends both on `.door-kb`, the cover's Ken Burns. Two things about it are
 * only true in `app/globals.css`, so they are read from there:
 *
 * 1. It is NEUTRALISED under `prefers-reduced-motion`, BY NAME. The universal `animation-duration:
 *    0.01ms` rule in that block does not stop an infinite animation — it leaves it running one
 *    ultra-fast iteration forever, which is the exact failure the design system's acceptance
 *    checklist probes for with `document.getAnimations()` under reduce. Only the named
 *    `animation: none !important` list stops it, and this is what fails if `.door-kb` is dropped
 *    from that list while the keyframe stays.
 * 2. It runs at `--duration-loop-kb`, not a literal. A hardcoded duration is how a loop drifts
 *    under R2's floor without anyone re-reading the rule.
 *
 * This is a text check on one file, which is a weak instrument on its own — it cannot see a
 * SECOND loop added elsewhere on the surface. It is here because the reduced-motion half is an
 * accessibility acceptance criterion in this repo and its failure is completely silent.
 */
describe('issue #25 — the front door has exactly one ambient loop, and reduce stops it', () => {
  // COMMENTS ARE STRIPPED FIRST, and that is not tidiness. Both rules below are prose-heavy in
  // globals.css and the comment that explains `.door-kb`'s reduced-motion stop sits INSIDE the
  // reduced-motion block, so a naive text match is satisfied by the explanation of the rule
  // rather than by the rule. Measured while writing this: the raw match reported `.door-kb`
  // twice, once from the selector and once from the paragraph above it, and it also picked up
  // three retired class names that only exist in a comment saying they were deleted.
  const css = readFileSync(resolve(__dirname, '../../app/globals.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );

  it('the cover Ken Burns is declared, infinite, and timed by the loop token', () => {
    const rule = css.match(/\.door-kb\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule, '.door-kb is no longer declared in globals.css').toContain('animation:');
    expect(rule).toContain('door-kenburns');
    expect(rule, 'the loop duration must stay --duration-loop-kb, not a literal').toContain(
      'var(--duration-loop-kb)',
    );
    expect(rule).toContain('infinite');
    // Its resting transform: reduced motion stops the animation, and what is left has to be an
    // overscanned frame or the crop shows an edge.
    expect(rule).toMatch(/transform:\s*scale\(1\.0[0-9]\)/);
  });

  it('reduced motion stops it BY NAME, not via the universal duration collapse', () => {
    const block = css.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(block, 'the reduced-motion block is missing').not.toEqual('');
    const stopped = block.match(/([^{}]*)\{\s*animation:\s*none\s*!important;\s*\}/g) ?? [];
    expect(
      stopped.some((r) => /\.door-kb\b/.test(r)),
      '.door-kb is not in the reduced-motion `animation: none` list — an INFINITE animation ' +
        'survives the universal 0.01ms collapse as one endlessly repeating fast iteration',
    ).toBe(true);
  });
});
