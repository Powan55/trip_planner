// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { crossedIntoComplete, celebrationVisible, claimCelebration } from '@/lib/celebration';
import { STORAGE_KEYS, celebrationLedger } from '@/core/storage/gateway';

/**
 * S218 micro-celebration — the two pure decisions behind `components/celebration-burst.tsx`:
 * fire-once-per-transition (never re-fire on a re-render while the state stays true) and the
 * D-056(b) reduced-motion hard guard (nothing renders/fires, no static substitute).
 *
 * Plus, since issue #24, the third one: the SESSION ledger (D-293 rule 5's second clause and
 * rule 6's caps), which is the half `crossedIntoComplete` structurally cannot answer — its
 * baseline is a ref, and a ref does not survive leaving the route and coming back. jsdom is
 * required from here down, for sessionStorage; the two blocks above are pure and were passing
 * under node.
 */

describe('crossedIntoComplete (S218 — fire once per OBSERVED transition)', () => {
  it('fires only on the observed false→true edge', () => {
    expect(crossedIntoComplete(false, true)).toBe(true);
  });

  it('does NOT fire on the first observation, even when already true (baseline seed — an already-complete list / a mid-trip page load must not celebrate on every visit)', () => {
    expect(crossedIntoComplete(null, true)).toBe(false);
  });

  it('first-observation-false then true fires exactly once (seed → live edge → stays true)', () => {
    // Simulates the ref lifecycle: null → observe false (seed) → observe true (fire) → stays true.
    expect(crossedIntoComplete(null, false)).toBe(false); // seed, no fire
    expect(crossedIntoComplete(false, true)).toBe(true); // live edge — fires
    expect(crossedIntoComplete(true, true)).toBe(false); // stays true — never again
  });

  it('does not re-fire on a re-render while already complete', () => {
    expect(crossedIntoComplete(true, true)).toBe(false);
  });

  it('does not fire going true→false or staying false→false', () => {
    expect(crossedIntoComplete(true, false)).toBe(false);
    expect(crossedIntoComplete(false, false)).toBe(false);
  });
});

describe('celebrationVisible (S218, D-056b reduced-motion guard)', () => {
  it('is suppressed under reduced motion even when active', () => {
    expect(celebrationVisible(true, true)).toBe(false);
  });

  it('is visible when active and motion is not reduced', () => {
    expect(celebrationVisible(true, false)).toBe(true);
  });

  it('is hidden when not active, regardless of motion preference', () => {
    expect(celebrationVisible(false, false)).toBe(false);
    expect(celebrationVisible(false, undefined)).toBe(false);
    expect(celebrationVisible(false, null)).toBe(false);
  });
});

describe('claimCelebration (issue #24 — D-293 rule 5, second clause)', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it('grants the first claim for an entity and refuses every later one this session', () => {
    // The defect this exists for: leave /packing, come back, and the caller's ref-based edge
    // detector sees a brand-new false→true edge. R5 says the id fires once per session.
    expect(claimCelebration('packing-complete')).toBe(true);
    expect(claimCelebration('packing-complete')).toBe(false);
    expect(claimCelebration('packing-complete')).toBe(false);
  });

  it('counts ENTITIES, not celebrations — a different id is a different claim', () => {
    expect(claimCelebration('stamp:Nepal', 'burst')).toBe(true);
    expect(claimCelebration('stamp:Japan', 'burst')).toBe(true);
    expect(claimCelebration('stamp:Nepal', 'burst')).toBe(false);
  });

  it('separates the weights — the same entity id under two weights is two claims', () => {
    expect(claimCelebration('day-complete', 'pop')).toBe(true);
    expect(claimCelebration('day-complete', 'completion')).toBe(true);
  });

  it('caps pop at 3 per session (rule 6) and does not cap tick', () => {
    expect(claimCelebration('day-1', 'pop')).toBe(true);
    expect(claimCelebration('day-2', 'pop')).toBe(true);
    expect(claimCelebration('day-3', 'pop')).toBe(true);
    expect(claimCelebration('day-4', 'pop')).toBe(false);
    expect(claimCelebration('day-5', 'pop')).toBe(false);
    // The cap is per weight, so the fourth pop being refused says nothing about a tick.
    for (let i = 0; i < 6; i += 1) expect(claimCelebration(`field-${i}`, 'tick')).toBe(true);
  });

  it('a refused claim does NOT spend a slot — the cap counts what actually fired', () => {
    for (const id of ['a', 'b', 'c']) expect(claimCelebration(id, 'pop')).toBe(true);
    expect(claimCelebration('a', 'pop')).toBe(false); // already fired, not a fourth pop
    expect(celebrationLedger.fired().filter((k) => k.startsWith('pop:'))).toHaveLength(3);
  });

  it('is sessionStorage and never localStorage — a new session is a new celebration', () => {
    claimCelebration('wrapped-post-trip', 'burst');
    expect(window.sessionStorage.getItem(STORAGE_KEYS.motionCelebrationsFired)).toBe(
      'burst:wrapped-post-trip',
    );
    expect(window.localStorage.getItem(STORAGE_KEYS.motionCelebrationsFired)).toBeNull();

    // What "a new session" means for the ledger, tested rather than asserted in a comment.
    window.sessionStorage.clear();
    expect(claimCelebration('wrapped-post-trip', 'burst')).toBe(true);
  });

  it('a comma in an entity id cannot corrupt the comma-joined set', () => {
    // A hand-entered country name is a real id here ('stamp:Cork, Ireland').
    expect(claimCelebration('stamp:Cork, Ireland', 'burst')).toBe(true);
    expect(celebrationLedger.fired()).toEqual(['burst:stamp:Cork; Ireland']);
    expect(claimCelebration('stamp:Cork, Ireland', 'burst')).toBe(false);
  });

  it('unreadable storage degrades to ALWAYS CELEBRATE, never to silence', () => {
    // Same direction as the entrance ledger's degrade (lib/__tests__/motion-budget.test.ts):
    // a repeated flourish is a cosmetic miss, a flourish that can never fire looks broken.
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
      expect(claimCelebration('packing-complete')).toBe(true);
      expect(claimCelebration('packing-complete')).toBe(true);
    } finally {
      Object.defineProperty(window, 'sessionStorage', { configurable: true, value: real });
    }
  });
});
