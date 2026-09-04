import { describe, it, expect, afterEach, vi } from 'vitest';

import { generateItemId } from '../item-id';

// `crypto.randomUUID` is missing on older Safari and on any non-secure origin, so the
// fallback is real production code — and it is the only half of this module that other
// suites never reach, because the test environment always has `randomUUID`.
const FALLBACK = /^item_[0-9a-z]+_[0-9a-z]{0,5}$/;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('generateItemId', () => {
  it('prefers crypto.randomUUID where the platform has it', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' });
    expect(generateItemId()).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  it('falls back when there is no crypto global at all', () => {
    vi.stubGlobal('crypto', undefined);
    expect(generateItemId()).toMatch(FALLBACK);
  });

  it('falls back when crypto exists but carries no randomUUID', () => {
    vi.stubGlobal('crypto', {});
    expect(generateItemId()).toMatch(FALLBACK);
  });

  // The clock is frozen so the timestamp half contributes nothing: what is under test is
  // whether the random suffix alone keeps ids distinct, which is the case a row merge hits
  // when it mints several placements in one tick.
  it('mints distinct fallback ids inside a single millisecond', () => {
    vi.stubGlobal('crypto', {});
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-12-09T00:00:00Z'));

    const ids = Array.from({ length: 50 }, () => generateItemId());

    expect(new Set(ids).size).toBe(50);
  });
});
