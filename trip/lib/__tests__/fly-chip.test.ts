// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * S134 flying chip — the reduced-motion gate + self-cleaning guarantee.
 * The animation itself needs WAAPI (absent in jsdom), so we assert the two branches
 * that MUST hold regardless of a real browser:
 *   1. Reduced motion → no-op: nothing is ever appended to the DOM.
 *   2. No WAAPI (jsdom) → the chip never lingers: append is attempted, then removed
 *      immediately, so no orphan node is left behind.
 */

import { flyChip } from '@/lib/fly-chip';

function stubReducedMotion(matches: boolean) {
  // jsdom has no matchMedia; provide one so the gate is exercised deterministically.
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

describe('flyChip (S134)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is a no-op under prefers-reduced-motion (nothing added to the DOM)', () => {
    stubReducedMotion(true);
    const spy = vi.spyOn(document.body, 'appendChild');
    flyChip({ x: 100, y: 100 }, { label: 'Test' });
    expect(spy).not.toHaveBeenCalled();
    expect(document.body.children.length).toBe(0);
  });

  it('never leaves an orphan node when WAAPI is unavailable (jsdom)', () => {
    stubReducedMotion(false);
    // jsdom does not implement Element.animate → the helper cleans up synchronously.
    flyChip({ x: 100, y: 100 }, { label: 'Test' });
    expect(document.body.querySelectorAll('div').length).toBe(0);
  });

  it('ignores non-finite origin coordinates', () => {
    stubReducedMotion(false);
    const spy = vi.spyOn(document.body, 'appendChild');
    flyChip({ x: NaN, y: 0 });
    expect(spy).not.toHaveBeenCalled();
  });
});
