import { describe, it, expect } from 'vitest';
import { seasonThemeFor } from '@/lib/season-theme';

describe('seasonThemeFor — month lookup + New Year override boundary', () => {
  it('every month resolves to its own theme id', () => {
    const ids = Array.from({ length: 12 }, (_, m) => seasonThemeFor(new Date(2026, m, 15)).id);
    expect(ids).toEqual(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']);
  });

  it('Dec 31 -> new-year (overrides December)', () => {
    expect(seasonThemeFor(new Date(2026, 11, 31)).id).toBe('new-year');
  });

  it('Jan 1 -> new-year (overrides January)', () => {
    expect(seasonThemeFor(new Date(2027, 0, 1)).id).toBe('new-year');
  });

  it('Dec 30 stays December (lower boundary)', () => {
    expect(seasonThemeFor(new Date(2026, 11, 30)).id).toBe('dec');
  });

  it('Jan 2 stays January (upper boundary)', () => {
    expect(seasonThemeFor(new Date(2027, 0, 2)).id).toBe('jan');
  });

  it('is pure: same input always yields an equal-shaped result', () => {
    const a = seasonThemeFor(new Date(2026, 5, 1));
    const b = seasonThemeFor(new Date(2026, 5, 30));
    expect(a).toEqual(b);
  });
});
