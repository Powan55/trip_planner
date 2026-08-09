// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';

/**
 * S218 haptics — the Vibration API feature-detect no-op and the reduced-motion gate. Mirrors
 * the `lib/fly-chip.ts` (S134) test shape: jsdom has no `matchMedia`/`navigator.vibrate` by
 * default, so both branches are exercised deterministically with stubs.
 */

import { haptic } from '@/lib/haptics';

function stubReducedMotion(matches: boolean) {
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

describe('haptic (S218)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // @ts-expect-error test cleanup of a possibly-stubbed property
    delete navigator.vibrate;
  });

  it('no-ops when the Vibration API is unsupported (e.g. iOS Safari / jsdom default)', () => {
    stubReducedMotion(false);
    expect('vibrate' in navigator).toBe(false);
    expect(() => haptic()).not.toThrow();
  });

  it('calls navigator.vibrate with the given pattern when supported and motion is not reduced', () => {
    stubReducedMotion(false);
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    haptic(20);
    expect(vibrate).toHaveBeenCalledWith(20);
  });

  it('defaults to a subtle ~15ms pulse when no pattern is given', () => {
    stubReducedMotion(false);
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    haptic();
    expect(vibrate).toHaveBeenCalledWith(15);
  });

  it('is a no-op under prefers-reduced-motion even when vibrate is supported (D-007/D-056b)', () => {
    stubReducedMotion(true);
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    haptic();
    expect(vibrate).not.toHaveBeenCalled();
  });
});
