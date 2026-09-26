import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';

// Bundled rasters are inert bytes: nothing imports them, so a raster that loses its last
// reference stays in the repo and in the checkout with every check green. `13e340e` left 34
// such files at 11.88 MiB. This asserts the identity in both directions — no orphan on disk,
// no reference to a file that is gone — off the real tree, so it needs no maintained list.

const APP_ROOT = resolve(__dirname, '../..');
const IMAGES_DIR = resolve(APP_ROOT, 'public/images');

// The Vitest roots plus `app/` — every surface that can name an asset. Scripts and specs are
// excluded on purpose: they carry synthetic paths (`/images/a.avif`) that are not references.
const SOURCE_ROOTS = ['app', 'components', 'core', 'hooks', 'lib'];
const SOURCE_EXT = /\.(?:tsx?|jsx?|mjs|json|css)$/;
const ASSET_REF = /\/images\/[a-z0-9-]+\/[A-Za-z0-9._-]+\.(?:jpe?g|png|webp|avif)/g;

type Manifest = Record<string, { avif?: string; variants?: { avif?: string }[] }>;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      walk(full, out);
    } else out.push(full);
  }
  return out;
}

const manifest: Manifest = JSON.parse(
  readFileSync(resolve(APP_ROOT, 'lib/image-manifest.json'), 'utf8'),
);

const referenced = new Map<string, string[]>();
for (const root of SOURCE_ROOTS) {
  for (const file of walk(resolve(APP_ROOT, root))) {
    if (!SOURCE_EXT.test(file)) continue;
    const rel = relative(APP_ROOT, file).split(sep).join('/');
    if (rel === 'lib/image-manifest.json') continue; // the expansion table, not a call site
    for (const match of readFileSync(file, 'utf8').match(ASSET_REF) ?? []) {
      referenced.set(match, [...(referenced.get(match) ?? []), rel]);
    }
  }
}

// A reference to a source raster also reaches the derivatives gen-images.mjs recorded for it.
const reachable = new Set<string>();
for (const path of referenced.keys()) {
  reachable.add(path);
  const entry = manifest[path];
  if (!entry) continue;
  if (entry.avif) reachable.add(entry.avif);
  for (const variant of entry.variants ?? []) if (variant.avif) reachable.add(variant.avif);
}

const onDisk = new Set(
  walk(IMAGES_DIR)
    .map((file) => '/images/' + relative(IMAGES_DIR, file).split(sep).join('/'))
    .filter((path) => path !== '/images/CREDITS.md'),
);

describe('public/images reachability', () => {
  it('references something', () => {
    expect(referenced.size).toBeGreaterThan(100);
    expect(onDisk.size).toBeGreaterThan(100);
  });

  it('every bundled image is reachable from the app source', () => {
    const orphans = [...onDisk].filter((path) => !reachable.has(path)).sort();
    expect(orphans, `${orphans.length} unreferenced image file(s) under public/images`).toEqual([]);
  });

  it('every referenced image exists on disk', () => {
    const missing = [...reachable].filter((path) => !onDisk.has(path)).sort();
    expect(
      missing.map((path) => `${path} <- ${(referenced.get(path) ?? ['(via manifest)']).join(', ')}`),
      'referenced image file(s) that are not bundled',
    ).toEqual([]);
  });
});
