import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * S359B / S394 — the EXERCISED proof for how `scripts/gen-sw.mjs` scopes the precache.
 *
 * `buildPrecacheList` used to precache ALL of `_next/static/**`. It now precaches only
 * the app shell's share of it. Route HTML is UNCHANGED and still fully precached — that
 * is the D-073 contract and the S271 torn-update invariant.
 *
 * 🔴 S394 INVERTED THE FIRST TEST HERE, deliberately, and the old shape is worth knowing
 * so nobody "restores" it. Under D-271 ① maplibre's engine was the heaviest thing the
 * scoping dropped, and this file proved the runtime BACKFILL rescued it: it asserted the
 * ~1 MB asset was in the cache but NOT in the install list. The owner reversed that
 * ruling (S394 — the two maplibre chunks total 1.01 MiB, under the 2 MB bar), so that
 * assertion now fails BY CONSTRUCTION. The coverage was not deleted, it was flipped:
 *   · Test 1 asserts the NEW invariant — the engine IS in the install list, and /map/
 *     therefore renders offline on a cache holding nothing but the install set.
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
  test("maplibre's engine ships WITH the install, so /map/ renders offline on an install-only cache", async ({
    page,
    context,
  }) => {
    // 1) Warm the worker on the app root and let the install settle.
    await page.goto('/', { waitUntil: 'load' });
    await waitForActivatedSW(page);
    await expect.poll(async () => (await precachedStatic(page)).length).toBeGreaterThan(20);

    const installedStatic = await installedStaticUrls(page);

    // 2) THE INVERTED ASSERTION (S394). The ~1 MB asset is identified by RUNTIME BYTE
    //    SIZE, so no content hash is hard-coded — but where the old test required it to
    //    be ABSENT from the install list, it must now be PRESENT in it. This is the half
    //    with discriminating power: it is exactly what the pre-S394 worker failed.
    const bigCached: string[] = await page.evaluate(async (paths: string[]) => {
      const big: string[] = [];
      for (const p of paths) {
        const res = await caches.match(p);
        if (res && (await res.clone().arrayBuffer()).byteLength > 500_000) big.push(p);
      }
      return big;
    }, await precachedStatic(page));
    expect(bigCached.length, 'no >500 KB asset is cached at all — the engine never shipped').toBeGreaterThan(0);
    for (const p of bigCached) expect(installedStatic).toContain(p);

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

    // 4) OFFLINE, on a cache holding nothing but the install set, and WITHOUT this
    //    context ever having opened /map/ online. The GL canvas only exists once
    //    maplibre's engine has actually executed, so it is the proof the engine shipped.
    //    NOTE what is deliberately NOT asserted: basemap imagery. Tiles come from
    //    basemaps.cartocdn.com, which is cross-origin and hits the SW's untouched
    //    cross-origin passthrough — offline the canvas paints the navy underlay, the
    //    marker circles and the day route, with no street artwork. That is exactly what
    //    the landing copy promises and no more.
    await context.setOffline(true);
    await page.goto('/map/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('map-shell')).toBeVisible();
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 20_000 });

    await context.setOffline(false);
  });

  test('a chunk still OUTSIDE the shell is backfilled by the static cacheFirst handler on its first online fetch', async ({
    page,
    context,
  }) => {
    // The safety argument for everything the scoping still drops. S394 precached the
    // maplibre engine, so the old vehicle for this proof is gone — the subject is now
    // DERIVED: diff what the build emitted against what the shipped worker installs, and
    // take a chunk from the difference. That keeps the test honest if the shell grows.
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
