import { describe, it, expect } from 'vitest';
import { buildSrcSet } from '../image-srcset';

const resolve = (p: string) => `/trip_planner${p}`;

describe('buildSrcSet', () => {
  it('returns null when there are no variants (backward-compat single-URL fallback)', () => {
    expect(buildSrcSet(undefined, 'webp', resolve)).toBeNull();
    expect(buildSrcSet([], 'avif', resolve)).toBeNull();
  });

  it('builds an ascending-width srcset string for webp', () => {
    const variants = [
      { width: 1200, webp: '/images/a.webp', avif: '/images/a.avif' },
      { width: 640, webp: '/images/a-640w.webp', avif: '/images/a-640w.avif' },
      { width: 1024, webp: '/images/a-1024w.webp', avif: '/images/a-1024w.avif' },
    ];
    expect(buildSrcSet(variants, 'webp', resolve)).toBe(
      '/trip_planner/images/a-640w.webp 640w, /trip_planner/images/a-1024w.webp 1024w, /trip_planner/images/a.webp 1200w',
    );
  });

  it('builds the matching avif srcset from the same variants', () => {
    const variants = [
      { width: 800, webp: '/images/b.webp', avif: '/images/b.avif' },
      { width: 640, webp: '/images/b-640w.webp', avif: '/images/b-640w.avif' },
    ];
    expect(buildSrcSet(variants, 'avif', resolve)).toBe(
      '/trip_planner/images/b-640w.avif 640w, /trip_planner/images/b.avif 800w',
    );
  });

  it('sorts out-of-order input by ascending width', () => {
    const variants = [
      { width: 1024, webp: '/x-1024w.webp', avif: '/x-1024w.avif' },
      { width: 640, webp: '/x-640w.webp', avif: '/x-640w.avif' },
    ];
    const result = buildSrcSet(variants, 'webp', resolve);
    expect(result?.indexOf('640w')).toBeLessThan(result?.indexOf('1024w') ?? -1);
  });

  it('handles a single variant (image narrower than the smallest breakpoint)', () => {
    const variants = [{ width: 800, webp: '/y.webp', avif: '/y.avif' }];
    expect(buildSrcSet(variants, 'webp', resolve)).toBe('/trip_planner/y.webp 800w');
  });
});
