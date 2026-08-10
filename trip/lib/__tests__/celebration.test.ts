import { describe, it, expect } from 'vitest';
import { crossedIntoComplete, celebrationVisible } from '@/lib/celebration';

/**
 * S218 micro-celebration — the two pure decisions behind `components/celebration-burst.tsx`:
 * fire-once-per-transition (never re-fire on a re-render while the state stays true) and the
 * D-056(b) reduced-motion hard guard (nothing renders/fires, no static substitute).
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
