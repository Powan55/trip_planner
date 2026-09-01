import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// BASE_PATH is read once at module scope, so each case re-imports under its own env.
const load = async (base?: string) => {
  vi.resetModules();
  if (base !== undefined) vi.stubEnv('NEXT_PUBLIC_BASE_PATH', base);
  return (await import('../base-path')).withBasePath;
};

describe('withBasePath', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('joins a base path to a root-relative path without doubling the separator', async () => {
    const withBasePath = await load('/trip_planner');
    expect(withBasePath('/manifest.webmanifest')).toBe('/trip_planner/manifest.webmanifest');
  });

  it('inserts the missing separator for a path with no leading slash', async () => {
    const withBasePath = await load('/trip_planner');
    expect(withBasePath('images/hero.avif')).toBe('/trip_planner/images/hero.avif');
  });

  it('is a no-op when no base path is configured', async () => {
    const withBasePath = await load('');
    expect(withBasePath('/manifest.webmanifest')).toBe('/manifest.webmanifest');
    expect(withBasePath('')).toBe('');
  });
});
