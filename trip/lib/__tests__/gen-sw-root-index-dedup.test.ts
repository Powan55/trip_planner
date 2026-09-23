// #417: 19 byte-identical __next._index.txt copies (one per route) used to sit in the
// precache; only the root copy should be listed, and the SW rewrites the other 19 URLs
// onto it at request time.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDedupedSegmentPayload } from '../../scripts/gen-sw.mjs';

// Pure predicate, extracted from buildPrecacheList so this is hermetic — buildPrecacheList
// itself calls islandAssets(), which needs a real `.next`/`out` from `next build` and isn't
// available before CI's unit-test step.
describe('isDedupedSegmentPayload: root __next._index.txt dedup', () => {
  it('keeps the root __next._index.txt and drops every per-route copy', () => {
    expect(isDedupedSegmentPayload('__next._index.txt')).toBe(true);
    expect(isDedupedSegmentPayload('plan/__next._index.txt')).toBe(false);
    expect(isDedupedSegmentPayload('travel/__next._index.txt')).toBe(false);
  });

  it('leaves the sibling per-route segment shapes untouched', () => {
    expect(isDedupedSegmentPayload('plan/__next._tree.txt')).toBe(true);
    expect(isDedupedSegmentPayload('travel/__next.__PAGE__.txt')).toBe(true);
  });

  it('still excludes __next._full.txt (SEGMENT_PAYLOAD carve-out, unrelated to #417)', () => {
    expect(isDedupedSegmentPayload('plan/__next._full.txt')).toBe(false);
  });
});

// The rewrite half lives inside the emitted SW template (cacheKey()), so lift it the
// same way lib/__tests__/sw-handlers.test.ts does rather than re-implement the regex.
describe('cacheKey (emitted SW): non-root __next._index.txt URLs collapse onto the root one', () => {
  const genSwSrc = readFileSync(resolve(__dirname, '../../scripts/gen-sw.mjs'), 'utf8');

  function extractCacheKey(): (request: { url: string }) => string {
    const startAnchor = 'return `/* AUTO-GENERATED';
    const start = genSwSrc.indexOf(startAnchor);
    const end = genSwSrc.search(/\r?\n`;\r?\n\}/);
    const template = genSwSrc.slice(start + 'return `'.length, end);
    const workerSource = new Function(
      'PRECACHE',
      'IMAGES_CACHE',
      'IMAGE_CACHE_LIMIT',
      'NAV_FALLBACK',
      'precacheUrls',
      'withBase',
      'return `' + template + '`'
    )('trip-precache-test', 'trip-images-v1', 80, '/', ['/'], (p: string) => p);
    // cacheKey() is a plain function declared at top level of the worker source;
    // grab a reference to it without driving the whole install/fetch machinery.
    return new Function(`${workerSource}\nreturn cacheKey;`)();
  }

  const cacheKey = extractCacheKey();

  it('rewrites a non-root __next._index.txt onto the base-prefixed root path', () => {
    const key = cacheKey({ url: 'https://example.test/plan/__next._index.txt?_rsc=abc' });
    expect(key).toBe('https://example.test/__next._index.txt');
  });

  it('normalizes the root __next._index.txt request to the same URL, search stripped', () => {
    const key = cacheKey({ url: 'https://example.test/__next._index.txt?_rsc=abc' });
    expect(key).toBe('https://example.test/__next._index.txt');
  });

  it('still strips the search from every other .txt payload as before', () => {
    const key = cacheKey({ url: 'https://example.test/plan/index.txt?focus=abc&_rsc=zzz' });
    expect(key).toBe('https://example.test/plan/index.txt');
  });
});
