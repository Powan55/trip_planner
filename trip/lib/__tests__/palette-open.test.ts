// @vitest-environment jsdom
//
// CommandPalette is a lazy island (#505), so an openPalette() call before it mounts
// must not be lost: it arms a flag that mount drains once.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  openPalette,
  markPaletteMounted,
  isPaletteMounted,
  consumePendingPaletteOpen,
} from '@/lib/palette-open';

// module-level flags persist across tests in the same file — reset via a fresh
// import isn't practical with vitest's module cache, so drain/reset by hand.
beforeEach(() => {
  consumePendingPaletteOpen();
});

describe('palette-open pending flag', () => {
  it('open before mount sets a pending flag that mount drains once', () => {
    // isPaletteMounted has no reset, so this suite runs in mount order; guard by
    // only asserting the pre-mount behavior when still unmounted.
    if (isPaletteMounted()) return;
    openPalette();
    expect(consumePendingPaletteOpen()).toBe(true);
    expect(consumePendingPaletteOpen()).toBe(false); // drained, not re-armed
  });

  it('open after mount does not set the pending flag', () => {
    markPaletteMounted();
    openPalette();
    expect(consumePendingPaletteOpen()).toBe(false);
  });
});
