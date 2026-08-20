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
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  TIER_1_SURFACES,
  TIER_2_SURFACES,
  TIER_3_SURFACES,
  entranceFor,
  isMotionAllowed,
  OVERLAY_TIER,
  overlayMotion,
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
    //
    // This used to name `/passport` as its example of an untiered route. Issue #5 built that
    // route and tiered it, so the example moved rather than the rule — and the route-coverage
    // test above is what caught the stale example, exactly as designed.
    expect(tierForPath('/atlas')).toBe(3);
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
    // Issue #5 — the passport is a keepsake surface, tiered with /recap and /trips. What it
    // spends the tier on is the entrance; the stamp unlock is a one-shot completion and does
    // not depend on it.
    expect(tierForPath('/passport/')).toBe(1);
    expect(isMotionAllowed('entrance', tierForPath('/passport/'))).toBe(true);
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
  const kinds: MotionKind[] = ['entrance', 'loop', 'state', 'tick', 'pop', 'burst', 'completion'];
  const tiers: MotionTier[] = [1, 2, 3];

  it('Tier 1 permits everything', () => {
    for (const kind of kinds) expect(isMotionAllowed(kind, 1), kind).toBe(true);
  });

  it('Tier 3 permits the tick, a state indicator and a completion burst — nothing else', () => {
    // The two additions are owner rulings, each narrow and each its own kind: D-322 (a busy /
    // state indicator is not ambience) and D-323 (a one-shot, user-earned completion burst is
    // not a pop). The four below are the permissions Tier 3 still revokes.
    expect(isMotionAllowed('tick', 3)).toBe(true);
    expect(isMotionAllowed('state', 3)).toBe(true);
    expect(isMotionAllowed('completion', 3)).toBe(true);
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

  it('D-322 and D-323 did NOT widen the gate — the shortcut each ruling ruled out', () => {
    // These two assertions are deliberately a restatement of the ones above, under a name that
    // says WHY they are load-bearing (the same trick scripts/contrast-tokens.mjs plays with its
    // `guards`). Both rulings landed as their own MotionKind precisely so that neither could be
    // implemented by relaxing an existing row: a state indicator is not `loop: [1, 2, 3]`, and a
    // completion burst is not `burst: [1, 2, 3]`. If either of these starts passing, somebody
    // took the shortcut and Tier 3 quietly acquired ambient loops or free pops.
    expect(isMotionAllowed('loop', 3), 'D-322 must not have relaxed AMBIENT loops').toBe(false);
    expect(isMotionAllowed('burst', 3), 'D-323 must not have relaxed the burst weight').toBe(false);
    // And the two new kinds really are the ones carrying the rulings, on every tier.
    for (const tier of [1, 2, 3] as MotionTier[]) {
      expect(isMotionAllowed('state', tier), `state on tier ${tier}`).toBe(true);
      expect(isMotionAllowed('completion', tier), `completion on tier ${tier}`).toBe(true);
    }
  });

  it('answers for every kind on every tier — no undefined hole in the table', () => {
    for (const kind of kinds) {
      for (const tier of tiers) expect(typeof isMotionAllowed(kind, tier)).toBe('boolean');
    }
  });
});

describe('the overlay pin (D-292, "regardless of which route opens it. No exceptions.")', () => {
  it('an overlay is Tier 3, and the loudest route in the product does not change that', () => {
    expect(OVERLAY_TIER).toBe(3);
    expect(tierForPath('/')).toBe(1);
    expect(isMotionAllowed('entrance', OVERLAY_TIER)).toBe(false);
  });

  it('overlayMotion hands back the CALM value — the primitives never get the spring', () => {
    // The generic is the point: components/ui/dialog.tsx passes class strings, sheet-dark.tsx
    // passes framer variants, and both are this one decision.
    expect(overlayMotion('entrance', 'zoom-in-95', 'fade-in-0')).toBe('fade-in-0');
    expect(overlayMotion('entrance', { scale: 0.9 }, { y: 8 })).toEqual({ y: 8 });
  });

  it('a tick is still legal inside a dialog — calm is not silent (R8)', () => {
    // Checking a box in a dialog still marks itself. Tier 3 revokes the entrance weights, not
    // the feedback that something happened.
    expect(overlayMotion('tick', 'loud', 'calm')).toBe('loud');
    expect(overlayMotion('completion', 'loud', 'calm')).toBe('loud');
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

// Issue #25's front-door loop (`.door-kb`) is NOT checked here, deliberately. A block that read
// globals.css for it was written and then deleted when #24's own `scripts/motion-loops.mjs`
// landed on dev: that audit already parses every `animation` shorthand in the file, resolves a
// `var()` duration against the declared custom properties, holds it to D-293 R2's 6s floor, and
// fails any loop whose selector is not named in the reduced-motion `animation: none` list. It
// covers `.door-kb` generically and it covers the NEXT loop too, which a hand-written text match
// on one selector never would. Run it with `npm run loop-check`.
