import { describe, it, expect } from 'vitest';

// S245 — the Travel Mode last-train chip PURE lookup (a small static table, no API).

import { lastTrainNotice, NYE_DATE } from '@/lib/travel-last-train';

describe('lastTrainNotice (S245)', () => {
  it('is null during the Nepal phase (Thamel is walk/taxi, not rail)', () => {
    expect(lastTrainNotice('2026-12-15', 'nepal')).toBeNull();
  });

  it('is the standard last-trains text on an ordinary Japan-phase day', () => {
    expect(lastTrainNotice('2026-12-20', 'japan')).toBe('Last trains ~00:00 · first ~05:00');
  });

  it('is the NYE all-night exception on Dec 31', () => {
    expect(NYE_DATE).toBe('2026-12-31');
    expect(lastTrainNotice(NYE_DATE, 'japan')).toMatch(/trains run all night/i);
  });

  it('the NYE exception only applies when the day is ALSO Japan-phase', () => {
    expect(lastTrainNotice(NYE_DATE, 'nepal')).toBeNull();
  });
});
