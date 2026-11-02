import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import HomePage from '@/app/page';
import OptimizedImage from '@/components/optimized-image';
import { HERO_DEFAULT } from '@/lib/hero-image';

vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/components/lazy-visible', () => ({ default: () => null }));
vi.mock('@/components/default-trip-only', () => ({ default: () => null }));

describe('Home hero preload', () => {
  it('exports one AVIF preload matching the responsive hero picture', () => {
    const home = new DOMParser().parseFromString(renderToStaticMarkup(<HomePage />), 'text/html');
    const picture = new DOMParser().parseFromString(
      renderToStaticMarkup(<OptimizedImage src={HERO_DEFAULT} alt="" sizes="100vw" priority />),
      'text/html',
    );
    const preloads = home.querySelectorAll('link[rel="preload"][as="image"]');
    expect(preloads).toHaveLength(1);
    expect(preloads[0].getAttribute('type')).toBe('image/avif');
    expect(preloads[0].getAttribute('imagesrcset')).toBe(picture.querySelector('source')?.getAttribute('srcset'));
    expect(preloads[0].getAttribute('imagesizes')).toBe('100vw');
    expect(preloads[0].getAttribute('fetchpriority')).toBe('high');
    expect(preloads[0].hasAttribute('href')).toBe(false);
  });
});
