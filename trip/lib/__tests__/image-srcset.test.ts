import { describe, it, expect } from 'vitest';
import { buildSrcSet } from '../image-srcset';

const resolve = (p: string) => `/trip_planner${p}`;

describe('buildSrcSet', () => {
  it('returns null when there are no variants (backward-compat single-URL fallback)', () => {
    expect(buildSrcSet(undefined, resolve)).toBeNull();
    expect(buildSrcSet([], resolve)).toBeNull();
  });

  it('builds an ascending-width avif srcset string', () => {
    const variants = [
      { width: 1200, avif: '/images/a.avif' },
      { width: 640, avif: '/images/a-640w.avif' },
      { width: 1024, avif: '/images/a-1024w.avif' },
    ];
    expect(buildSrcSet(variants, resolve)).toBe(
      '/trip_planner/images/a-640w.avif 640w, /trip_planner/images/a-1024w.avif 1024w, /trip_planner/images/a.avif 1200w',
    );
  });

  it('emits no .webp URL — the WebP tier is deleted (V6-13)', () => {
    const variants = [
      { width: 800, avif: '/images/b.avif' },
      { width: 640, avif: '/images/b-640w.avif' },
    ];
    const result = buildSrcSet(variants, resolve);
    expect(result).toBe('/trip_planner/images/b-640w.avif 640w, /trip_planner/images/b.avif 800w');
    expect(result).not.toMatch(/\.webp/);
  });

  it('sorts out-of-order input by ascending width', () => {
    const variants = [
      { width: 1024, avif: '/x-1024w.avif' },
      { width: 640, avif: '/x-640w.avif' },
    ];
    const result = buildSrcSet(variants, resolve);
    expect(result?.indexOf('640w')).toBeLessThan(result?.indexOf('1024w') ?? -1);
  });

  it('handles a single variant (image narrower than the smallest breakpoint)', () => {
    const variants = [{ width: 800, avif: '/y.avif' }];
    expect(buildSrcSet(variants, resolve)).toBe('/trip_planner/y.avif 800w');
  });
});
