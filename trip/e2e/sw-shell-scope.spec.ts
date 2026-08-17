import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * S359B / S394 — the EXERCISED proof for how `scripts/gen-sw.mjs` scopes the precache.
 *
 * `buildPrecacheList` used to precache ALL of `_next/static/**`. It now precaches only
 * the app shell's share of it. Route HTML is UNCHANGED and still fully precached — that
 * is the D-073 contract and the S271 torn-update invariant.
 *
 * 🔴 THE FIRST TEST HERE HAS NOW BEEN INVERTED TWICE. Read this before "restoring" either
 * older shape, because both existed and both were deliberate.
 *   · D-271 ① kept maplibre's engine OUT of the precache; this file proved the runtime
 *     BACKFILL rescued it (asset in the cache, NOT in the install list).
 *   · S394 reversed that on the owner's ruling (1.01 MiB, under the 2 MB bar) and the test
 *     was flipped to require the engine IN the install list, with a cold-offline /map/
 *     rendering a real GL canvas.
 *   · V6-14 reverses it again on a MEASUREMENT S394 did not have: the engine plus the glyph
 *     PBFs are ~363 KB GZIPPED, 21% of the gzipped install, spent on /map — the one route
 *     D-274 already declines to promise offline. So the engine is withheld again and
 *     runtime-cached on the first ONLINE /map visit instead, and a cold-offline /map/
 *     degrades to the island error boundary BY DESIGN.
 * The coverage was never deleted, only re-pointed:
 *   · Test 1 asserts the CURRENT invariant — the engine is NOT in the install list, and a
 *     cold-offline /map/ on an install-only cache paints the named boundary pane instead of
 *     a GL canvas, with the route itself still alive.
 *   · Test 2 keeps the runtime-backfill coverage, retargeted onto a chunk that is
 *     genuinely still outside the shell (20 of them survive on this tree, ~963 KB) and
 *     picked by DIFFING the build against the shipped worker rather than by hoping a
 *     particular feature imports one.
 *
 * `domcontentloaded` + block on a real testid, never `networkidle` (D-093).
 */

/** Resolve once a worker is activated AND controlling (rides the registrar's
 *  one-shot first-install reload). Same construction as `e2e/pwa.spec.ts`. */
async function waitForActivatedSW(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      if (!('serviceWorker' in navigator)) return false;
      const ctrl = navigator.serviceWorker.controller;
      return !!ctrl && ctrl.state === 'activated';
    },
    null,
    { timeout: 25_000 },
  );
}

/** Every `_next/static` pathname currently sitting in the content-hashed precache. */
function precachedStatic(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const name = (await caches.keys()).find((n) => n.startsWith('trip-precache-'));
    if (!name) return [];
    const cache = await caches.open(name);
    return (await cache.keys())
      .map((r) => new URL(r.url).pathname)
      .filter((p) => p.startsWith('/_next/static/'));
  });
}

/**
 * The INSTALL list, read straight out of the shipped worker source. This — not the
 * runtime cache — is what `buildPrecacheList` controls, and sampling the live cache
 * instead would race the backfill. (Same read-the-shipped-source idiom as
 * `e2e/pwa-torn-update.spec.ts`.)
 */
function installedStaticUrls(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const src = await (await fetch('/sw.js', { cache: 'no-store' })).text();
    const list = JSON.parse(src.match(/const PRECACHE_URLS = (\[[\s\S]*?\n\]);/)![1]) as string[];
    return list.filter((u) => u.startsWith('/_next/static/'));
  });
}

/** Every `_next/static/**` file the build actually emitted, as request paths. */
function builtStaticFiles(): string[] {
  const root = join(process.cwd(), 'out', '_next', 'static');
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name), `${prefix}/${entry.name}`);
      else out.push(`${prefix}/${entry.name}`);
    }
  };
  if (existsSync(root)) walk(root, '/_next/static');
  return out;
}

test.describe('S359B/S394 · what the scoped precache ships, and what it backfills', () => {
  test("maplibre's engine is NOT in the install list, so a cold-offline /map/ degrades to the island pane", async ({
    page,
    context,
  }) => {
    // 1) Warm the worker on the app root and let the install settle.
    await page.goto('/', { waitUntil: 'load' });
    await waitForActivatedSW(page);
    await expect.poll(async () => (await precachedStatic(page)).length).toBeGreaterThan(20);

    const installedStatic = await installedStaticUrls(page);
    // ANTI-VACUITY FLOOR. The assertion below FLIPPED at V6-14: `toContain` used to fail on
    // an empty list, `not.toContain` passes on one. `installedStaticUrls` filters on
    // `/_next/static/`, so a basePath build (`/trip_planner/_next/…`) yields [] and every
    // negative below would then pass by inspecting nothing — and step 3's set-equality
    // passes on [] too, so nothing downstream catches it.
    expect(
      installedStatic.length,
      'the shipped worker installs no _next/static asset at all — the negative below would pass by inspecting nothing',
    ).toBeGreaterThan(20);

    // 2) THE INVERTED ASSERTION (V6-14). The subject is read off DISK, not off the cache:
    //    the cache is not supposed to hold it, so sampling the cache would find nothing and
    //    assert nothing. Identified the way `gen-sw.mjs`'s isMaplibreChunk() and
    //    `e2e/pwa.spec.ts`'s eviction both identify it — by CONTENT, because the filenames
    //    are bare contenthashes — narrowed by size to the ENGINE itself (~1008 KiB). The
    //    size half matters: `lib/preflight.ts` carries the same literal to look FOR the
    //    engine, and a small chunk that merely mentions the marker is not the subject here.
    const engineChunks = builtStaticFiles().filter((f) => {
      if (!f.endsWith('.js')) return false;
      const body = readFileSync(join(process.cwd(), 'out', f.slice(1)));
      return body.byteLength > 500_000 && body.toString('utf8').includes('maplibregl');
    });
    expect(
      engineChunks.length,
      'the build emitted no >500 KB chunk carrying the maplibre marker — this test has lost its subject and must be retired deliberately rather than pass on an empty loop',
    ).toBeGreaterThan(0);
    for (const p of engineChunks) {
      expect(
        installedStatic,
        `${p} is the maplibre engine and it is in the INSTALL list — V6-14 withholds it from the precache (~363 KB gzip off every install) and runtime-caches it on the first ONLINE /map visit instead`,
      ).not.toContain(p);
    }

    // 3) PRUNE the cache back to exactly the install set. Without this the offline render
    //    below would also pass on a cache that a runtime backfill happened to warm — i.e.
    //    it would pass on the OLD worker too, and prove nothing about the prefetch.
    const pruned = await page.evaluate(async (keep: string[]) => {
      const allow = new Set(keep);
      const name = (await caches.keys()).find((n) => n.startsWith('trip-precache-'))!;
      const cache = await caches.open(name);
      let removed = 0;
      for (const req of await cache.keys()) {
        const path = new URL(req.url).pathname;
        if (path.startsWith('/_next/static/') && !allow.has(path)) {
          await cache.delete(req);
          removed++;
        }
      }
      // Every non-precache cache too (runtime images/frankfurter never hold JS, but a
      // future runtime cache might, and a silent hit there would fake this result).
      for (const n of await caches.keys()) {
        if (n === name) continue;
        const other = await caches.open(n);
        for (const req of await other.keys()) {
          if (new URL(req.url).pathname.startsWith('/_next/static/')) {
            await other.delete(req);
            removed++;
          }
        }
      }
      return removed;
    }, installedStatic);
    // Not an assertion that pruning found something (it legitimately may not) — logged so
    // a future reader can tell an install-only cache from a coincidentally-warm one.
    test.info().annotations.push({ type: 'pruned-non-install-entries', description: String(pruned) });
    expect(new Set(await precachedStatic(page))).toEqual(new Set(installedStatic));

    // 4) OFFLINE, on a cache holding nothing but the install set, and WITHOUT this context
    //    ever having opened /map/ online. What must appear is the ISLAND ERROR BOUNDARY's
    //    named pane (components/map-island-boundary.tsx), not a GL canvas: the island's
    //    chunk group carries a withheld maplibre chunk, so React.lazy throws at the
    //    `app/map/sections.tsx -> @/components/map-section` call site. That degradation is
    //    what D-274 already promises and what V6-14 spends 363 KB gzip to buy back.
    //
    //    Both halves are asserted, and each is vacuous alone: the pane's PRESENCE (the
    //    boundary really caught it and named it) plus the canvas's ABSENCE (no engine ran,
    //    so this cannot pass on a cache a backfill happened to warm).
    await context.setOffline(true);
    await page.goto('/map/', { waitUntil: 'domcontentloaded' });
    await expect(
      page.getByTestId('map-island-unavailable'),
      'cold-offline /map/ on an install-only cache: the map island neither degraded to its boundary pane nor was contained at all',
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('canvas.maplibregl-canvas')).toHaveCount(0);
    // …and the boundary contained it AT THE ISLAND: app/error.tsx did not replace the route,
    // so the hero and the rest of /map/ are still there.
    await expect(page.getByRole('heading', { name: 'Trip Map', level: 1 })).toBeVisible();

    await context.setOffline(false);
  });

  test('a chunk still OUTSIDE the shell is backfilled by the static cacheFirst handler on its first online fetch', async ({
    page,
    context,
  }) => {
    // The safety argument for everything the scoping still drops — and under V6-14 that
    // includes the maplibre engine again, whose runtime backfill is exactly this mechanism.
    // The subject stays DERIVED rather than named: diff what the build emitted against what
    // the shipped worker installs, and take a chunk from the difference. That keeps the test
    // honest whichever way the maplibre ruling swings next, and if the shell grows.
    await page.goto('/', { waitUntil: 'load' });
    await waitForActivatedSW(page);
    await expect.poll(async () => (await precachedStatic(page)).length).toBeGreaterThan(20);

    const installedStatic = await installedStaticUrls(page);
    const outside = builtStaticFiles().filter(
      (f) => f.endsWith('.js') && !installedStatic.includes(f),
    );
    // If the shell ever grows to cover everything, this test has nothing to prove and must
    // be retired deliberately rather than passing on an empty loop.
    expect(
      outside.length,
      'every emitted .js is now precached — the runtime backfill has no subject left, so retire this test rather than let it pass vacuously',
    ).toBeGreaterThan(0);
    const subject = outside.sort()[0];

    // It is genuinely not in the cache yet…
    expect(await precachedStatic(page)).not.toContain(subject);

    // …one successful ONLINE fetch goes through the static-asset cacheFirst handler…
    const status = await page.evaluate(async (url: string) => (await fetch(url)).status, subject);
    expect(status).toBe(200);

    // …and the handler backfilled it (fire-and-forget, so poll rather than assume).
    await expect
      .poll(async () => (await precachedStatic(page)).includes(subject), { timeout: 15_000 })
      .toBe(true);

    // And it now resolves OFFLINE, which is the whole claim.
    await context.setOffline(true);
    const offlineStatus = await page.evaluate(
      async (url: string) => (await fetch(url)).status,
      subject,
    );
    expect(offlineStatus).toBe(200);

    await context.setOffline(false);
  });

  test('route HTML is still precached at install: an offline COLD navigation to a never-visited route resolves', async ({
    page,
    context,
  }) => {
    // The counterpart guarantee. Scoping touched `_next/static/**` ONLY; every
    // route HTML is still precached at install (D-073), so a route this
    // context has NEVER visited must still resolve offline rather than falling
    // back to the Home shell.
    await page.goto('/', { waitUntil: 'load' });
    await waitForActivatedSW(page);
    await expect.poll(async () => (await precachedStatic(page)).length).toBeGreaterThan(20);

    await context.setOffline(true);
    await page.goto('/travel/', { waitUntil: 'domcontentloaded' });
    // Assert the route's REAL heading, not merely "an h1 is visible": the app's
    // error boundary also renders an h1 ("The app hit a problem"), and the route
    // HTML keeps its correct <title> even when the page fails to render — so both
    // a bare `toBeVisible()` and a title check PASS on a fully broken page. This
    // assertion is the one that actually discriminates.
    await expect(page.locator('h1').first()).toHaveText('Travel Mode');
    await expect(page).toHaveTitle(/travel/i);

    await context.setOffline(false);
  });
});
