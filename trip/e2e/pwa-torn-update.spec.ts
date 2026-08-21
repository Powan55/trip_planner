import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * S271 (R4/R5.2) — torn-update / atomic-install invariant for the hand-rolled SW
 * (out/sw.js, scripts/gen-sw.mjs, D-073 LOCKED). Runs against the served static
 * `out/` build (D-093).
 *
 * The invariant: a subsequent build whose precache CANNOT fully fetch must NOT
 * replace the working cache — `/travel/` and `/plan/` still resolve to their
 * REAL shells offline, never the app-root (Home) shell.
 *
 * ── Why this is split into two parts (both against the REAL shipped sw.js) ────
 * A LIVE second-build swap is not reproducible in this single-immutable-`out/`
 * harness (the exact reason `pwa.spec.ts` skips the full waiting→toast→reload
 * flow), and the torn build's install fetches are SW-INITIATED, so they are
 * invisible to Playwright network routing / `setOffline` (playwright#2311, and
 * our own SW-stub-bypass memory note) — there is no honest way to make a
 * precache fetch fail via the browser harness. So we prove the two halves the
 * invariant decomposes into, each on the real worker source, deterministically:
 *
 *   Part A — the SURVIVING-cache half (real registered worker): offline, the
 *   worker's nav handler serves `/travel/` and `/plan/` from cache with their
 *   real DOCUMENT IDENTITY (their own <title>), while an uncached route falls
 *   back to the Home shell. This is exactly what a controlling last-good worker
 *   does after a rejected update.
 *
 *   Part B — the ATOMIC-REJECT half (real shipped source, run in a controlled
 *   harness): the shipped install handler REJECTS its `waitUntil` if ANY precache
 *   entry fetches non-OK, so a torn build never activates and therefore never
 *   deletes the old precache (deletion happens only in `activate`). The happy
 *   path (all OK) resolves and commits the full shell — proving the reject is
 *   caused specifically by the failed fetch, not a always-throwing handler.
 *
 * Together: a torn build cannot commit (Part B) → the last-good worker keeps
 * controlling → it serves the real per-route shells offline (Part A).
 *
 * `test`/`expect` from `./fixtures` (signed-in default) so `/travel` + `/plan`
 * are reachable with no gate. `waitUntil:'load'` per D-093 (the live tick never
 * lets the net idle).
 */

// Distinctive per-route <title>s baked into each static route HTML (identity
// markers). The Home/app-root shell's title carries the date range; the two
// deep routes carry a "·"-joined page name and NEVER the date range — that is
// the tell that distinguishes "served the real route shell" from "fell back to
// the Home shell".
const TRAVEL_TITLE = 'Travel Mode · Nepal × Japan Journey';
const PLAN_TITLE = 'Plan · Nepal × Japan Journey';
const HOME_TITLE_MARK = 'Dec 2026 - Jan 2027'; // only in the Home/app-root shell <title>

async function waitForControllingSW(page: Page): Promise<void> {
  await page.waitForFunction(
    () => 'serviceWorker' in navigator && navigator.serviceWorker.controller?.state === 'activated',
    null,
    { timeout: 25_000 },
  );
}

async function precacheCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const names = await caches.keys();
    const precacheName = names.find((n) => n.startsWith('trip-precache-'));
    if (!precacheName) return 0;
    const cache = await caches.open(precacheName);
    return (await cache.keys()).length;
  });
}

test.describe('S271 · Part A — offline, the surviving worker serves real per-route shells (not Home)', () => {
  test('/travel/ and /plan/ resolve to their OWN shells offline; an uncached route falls back to Home', async ({
    page,
    context,
  }) => {
    // Warm the real worker: install → activate → precache the shell.
    await page.goto('/', { waitUntil: 'load' });
    await waitForControllingSW(page);
    await expect.poll(() => precacheCount(page)).toBeGreaterThan(20);

    // Cut the network entirely — from here, only the SW cache can answer.
    await context.setOffline(true);

    // /travel/ is precached → nav handler serves the REAL travel shell. Assert
    // the exact document identity, not just a 200: its <title> is the travel
    // page's, and it does NOT carry the Home-shell date marker.
    await page.goto('/travel/', { waitUntil: 'load' });
    expect(await page.title()).toBe(TRAVEL_TITLE);
    expect(await page.title()).not.toContain(HOME_TITLE_MARK);
    await expect(page.locator('h1').first()).toHaveText('Travel Mode');

    // /plan/ likewise resolves to its own real shell.
    await page.goto('/plan/', { waitUntil: 'load' });
    expect(await page.title()).toBe(PLAN_TITLE);
    expect(await page.title()).not.toContain(HOME_TITLE_MARK);

    // Control: an UNCACHED route DOES fall back to the Home/app-root shell — so
    // the two assertions above are meaningful (the deep routes are genuinely
    // served their own shells, not accidentally the Home fallback everywhere).
    await page.goto('/this-route-never-precached/', { waitUntil: 'load' });
    expect(await page.title()).toContain(HOME_TITLE_MARK);

    await context.setOffline(false);
  });

  /**
   * Every other offline assertion in this suite — here, in `pwa.spec.ts`, in
   * `sw-shell-scope.spec.ts` — reaches its route with `page.goto`. Nothing ever
   * CLICKED a link offline, and that is the path real use takes: `next/link` fetches
   * the target's RSC payload from `<route>/index.txt`, and when that fetch fails Next
   * falls back to a BROWSER NAVIGATION to the `.txt` URL itself. Nothing precached
   * matches it, so the nav handler answered with the app-root shell: tap "Plan"
   * offline, the address bar reads `…/plan/index.txt`, and Home renders — from which
   * every further tap does the same, so the UI can never leave Home. `page.goto` never
   * produces that URL, which is why a green suite said nothing about it.
   */
  test('offline, CLICKING an in-app link lands on that route, not back on Home', async ({
    page,
    context,
  }) => {
    await page.goto('/', { waitUntil: 'load' });
    await waitForControllingSW(page);
    await expect.poll(() => precacheCount(page)).toBeGreaterThan(20);

    await context.setOffline(true);

    // COLD-offline load, deliberately: nothing was prefetched in this session, so the
    // router's RSC fetch for /plan/ genuinely has to fail. Reusing the warm page would
    // let an already-prefetched payload soft-navigate and prove nothing.
    await page.goto('/', { waitUntil: 'load' });
    expect(await page.title()).toContain(HOME_TITLE_MARK);

    await Promise.all([
      page.waitForURL(/\/plan(\/|\.txt)/, { timeout: 20_000 }),
      page.getByTestId('navbar-link-plan').click(),
    ]);
    await page.waitForLoadState('load');

    expect(await page.title()).toBe(PLAN_TITLE);
    expect(await page.title()).not.toContain(HOME_TITLE_MARK);

    // The URL may still carry the RSC suffix. The hard navigation is Next's, and only
    // precaching the 19 route payloads would keep the click a soft one — +461 KB on an
    // ATOMIC install, which is an owner call, not a bug fix. Serving the right shell
    // for that URL is the half that belongs to the worker.
    expect(new URL(page.url()).pathname).toMatch(/\/plan\/(index\.txt)?$/);

    await context.setOffline(false);
  });
});

test.describe('S271 · Part B — the shipped install handler is ATOMIC (rejects on any non-OK precache fetch)', () => {
  test('one non-OK precache fetch rejects the whole install; an all-OK install resolves and commits the full shell', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'load' });

    // Pull the REAL shipped worker source (byte-identical to what the browser
    // runs) and drive ONLY its install handler in a controlled harness, so we
    // can inject a fetch failure the browser network layer cannot reach.
    const swSource = await page.evaluate(
      async () => (await fetch('/sw.js', { cache: 'no-store' })).text(),
    );

    const result = await page.evaluate((src) => {
      // The content type a real static host returns for each precache entry shape.
      // Plausible per-URL types matter: a blanket '' would slide the healthy arm
      // through isExpectedPrecacheBody's "absent type is trusted" branch and stop
      // exercising the real one.
      const contentTypeFor = (u: string) => {
        if (u.endsWith('/') || u.endsWith('.html')) return 'text/html; charset=utf-8';
        if (u.endsWith('.js')) return 'text/javascript';
        if (u.endsWith('.css')) return 'text/css';
        if (u.endsWith('.woff2')) return 'font/woff2';
        if (u.endsWith('.avif')) return 'image/avif';
        if (u.endsWith('.png')) return 'image/png';
        if (u.endsWith('.svg')) return 'image/svg+xml';
        if (u.endsWith('.webmanifest')) return 'application/manifest+json';
        return 'application/octet-stream';
      };
      // Instantiate the shipped source with controlled globals; capture the
      // install handler and run it with a fake waitUntil-capturing event.
      function runInstall(mode: 'torn' | 'healthy' | 'portal') {
        const handlers: Record<string, (e: unknown) => void> = {};
        const committed: string[] = [];
        let firstUrl: string | null = null;
        const fakeSelf = {
          addEventListener: (t: string, cb: (e: unknown) => void) => {
            handlers[t] = cb;
          },
          location: { origin: location.origin },
          clients: { claim: async () => {} },
          skipWaiting: () => {},
        };
        const fakeCaches = {
          open: async () => ({ put: async (k: unknown) => void committed.push(String(k)) }),
          keys: async () => [] as string[],
          match: async () => undefined,
          delete: async () => true,
        };
        const fakeFetch = async (url: string) => {
          const u = String(url);
          if (firstUrl === null) firstUrl = u; // the first URL the map() reaches
          const ok = !(mode === 'torn' && u === firstUrl);
          // 'portal': a captive portal answers EVERY request 200 with its login
          // page, whatever was asked for (#136).
          const contentType = mode === 'portal' ? 'text/html; charset=utf-8' : contentTypeFor(u);
          return {
            ok,
            status: ok ? 200 : 404,
            type: 'basic',
            redirected: false,
            headers: {
              get: (name: string) =>
                name.toLowerCase() === 'content-type' ? contentType : null,
            },
            clone() {
              return this;
            },
          };
        };
        new Function('self', 'caches', 'fetch', 'Response', 'location', src)(
          fakeSelf,
          fakeCaches,
          fakeFetch,
          Response,
          location,
        );
        return new Promise<{ settled: 'resolved' | 'rejected'; committed: number; err: string }>(
          (resolve) => {
            const evt = {
              waitUntil: (p: Promise<unknown>) => {
                Promise.resolve(p).then(
                  () => resolve({ settled: 'resolved', committed: committed.length, err: '' }),
                  (e) =>
                    resolve({
                      settled: 'rejected',
                      committed: committed.length,
                      err: String((e && (e as Error).message) || e),
                    }),
                );
              },
            };
            handlers.install(evt);
          },
        );
      }
      return Promise.all([
        runInstall('torn'),
        runInstall('healthy'),
        runInstall('portal'),
      ]).then(([torn, healthy, portal]) => ({ torn, healthy, portal }));
    }, swSource);

    // Torn build: one non-OK precache fetch → the install waitUntil REJECTS
    // (never activates → never deletes the old precache → last good build lives).
    expect(result.torn.settled).toBe('rejected');
    expect(result.torn.err).toContain('precache fetch failed');

    // Healthy build: all-OK → install RESOLVES and commits the full shell,
    // proving the reject above is caused by the failed fetch, not a handler that
    // always throws.
    expect(result.healthy.settled).toBe('resolved');
    // RE-BASED BY S359B. The old floor was 150 against a 177-entry list that
    // precached ALL of _next/static/**. S359B scoped that arm to the assets the
    // precached routes actually reference, so a healthy install now commits 80:
    // 18 route HTML + 56 static (47 JS + 2 CSS + 7 woff2) + 4 icons + favicon +
    // manifest.
    //
    // 50 keeps this DISCRIMINATING rather than merely green: the failure mode the
    // scoping introduces is `eagerStaticAssets` scraping ~nothing (a future Next
    // output-shape change), which collapses the list to the ~24 non-static entries
    // — well under 50 — while leaving ~30 entries of headroom for legitimate chunk
    // consolidation.
    //
    // It does NOT claim to catch route HTML dropping out (that would land at ~62
    // and still pass). It shouldn't: `e2e/pwa.spec.ts` pins the 7 named routes by
    // path, and Part A above catches it behaviourally by rendering them offline.
    // A count floor is the wrong instrument for that, and pretending otherwise is
    // how a check ends up detecting nothing.
    expect(result.healthy.committed).toBeGreaterThan(50);

    // Captive portal: every fetch is a 200 carrying the portal's login page, so
    // res.ok alone would commit HTML as every JS chunk in the shell — durably.
    // The body guard rejects it, and the install stays atomic (#136).
    expect(result.portal.settled).toBe('rejected');
    expect(result.portal.err).toContain('precache body rejected');
  });
});

test.describe('S271 · Part C — nav backfill caches a missed route on a successful online navigation', () => {
  // Every valid route in THIS build is already precached, so there is no
  // valid-but-unprecached navigation to exercise backfill in the real browser.
  // Prove it against the REAL shipped nav (fetch) handler instead: a same-origin
  // navigate that MISSES the cache and fetches OK must `cache.put` the normalized
  // path into PRECACHE (only for OK 'basic' responses).
  test('a same-origin navigate cache-miss with an OK basic response is put() into the precache; error/opaque is not', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'load' });
    const swSource = await page.evaluate(
      async () => (await fetch('/sw.js', { cache: 'no-store' })).text(),
    );

    const putKeys = await page.evaluate((src) => {
      // Drive the shipped `fetch` handler once with a controlled navigate event.
      function runNav(fetchOutcome: 'ok-basic' | 'ok-opaque' | 'error') {
        const handlers: Record<string, (e: unknown) => void> = {};
        const committed: string[] = [];
        const fakeSelf = {
          addEventListener: (t: string, cb: (e: unknown) => void) => {
            handlers[t] = cb;
          },
          location: { origin: location.origin },
          clients: { claim: async () => {} },
          skipWaiting: () => {},
        };
        const fakeCaches = {
          open: async () => ({ put: async (k: unknown) => void committed.push(String(k)) }),
          keys: async () => [] as string[],
          match: async () => undefined, // force the cache MISS
          delete: async () => true,
        };
        const fakeFetch = async () => {
          if (fetchOutcome === 'error') throw new Error('offline');
          const type = fetchOutcome === 'ok-opaque' ? 'opaque' : 'basic';
          return { ok: true, status: 200, type, clone() { return this; } };
        };
        new Function('self', 'caches', 'fetch', 'Response', 'location', src)(
          fakeSelf,
          fakeCaches,
          fakeFetch,
          Response,
          location,
        );
        return new Promise<string[]>((resolve) => {
          const req = {
            url: location.origin + '/backfill-me/',
            method: 'GET',
            mode: 'navigate',
            destination: 'document',
          };
          const evt = {
            request: req,
            respondWith: (p: Promise<unknown>) => {
              // Backfill is fire-and-forget after the response resolves; flush a
              // macrotask so the async caches.open().then(put) settles.
              Promise.resolve(p)
                .then(() => new Promise((r) => setTimeout(r, 0)))
                .then(() => resolve(committed.slice()));
            },
          };
          handlers.fetch(evt);
        });
      }
      return Promise.all([runNav('ok-basic'), runNav('ok-opaque'), runNav('error')]).then(
        ([basic, opaque, error]) => ({ basic, opaque, error }),
      );
    }, swSource);

    // OK 'basic' → backfilled under the NORMALIZED path.
    expect(putKeys.basic).toContain('/backfill-me/');
    // Opaque and network-error responses are NEVER backfilled into the shell.
    expect(putKeys.opaque).toEqual([]);
    expect(putKeys.error).toEqual([]);
  });
});
