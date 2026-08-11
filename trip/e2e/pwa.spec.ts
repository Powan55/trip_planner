import { test, expect } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * PWA / service-worker E2E pack (slice S84, D-073 / D-086) — E2E wave 4 (part 1).
 *
 * Proves the hand-rolled service worker (emitted to `out/sw.js` by
 * scripts/gen-sw.mjs, D-073 LOCKED) actually installs, activates, precaches the
 * app shell, and serves a cold navigation OFFLINE — against the served static
 * `out/` build (D-093), which IS a production build, so the production-only
 * registrar (`components/service-worker-registrar.tsx`) does register on
 * `127.0.0.1` (a secure context).
 *
 * ── What IS deterministically testable here (and covered) ───────────────────
 *   1. Registration → the worker reaches `activated` and controls the page.
 *   2. The precache (`trip-precache-<hash>`) exists and holds the shell (route
 *      HTMLs + `_next/static/**` + manifest/icons) — D-073's precache contract.
 *   3. Offline COLD navigation: with the network cut, a fresh `page.goto` still
 *      renders the app (the SW's cache-first nav handler serves the shell).
 *   4. The `SKIP_WAITING` message-channel handler is present in the shipped
 *      sw.js source (the wiring the update flow's Refresh action posts to).
 *
 * ── What is NOT deterministically reproducible here (skipped + flagged) ──────
 *   The full update flow — a NEW sw.js version parking at `waiting`, the
 *   "New version available" toast, Refresh → SKIP_WAITING → exactly ONE reload
 *   (D-073) — requires a SECOND, byte-different build to be served so the
 *   browser detects a changed worker. The static harness serves ONE immutable
 *   `out/` for the whole run (D-093: no rebuild step mid-suite), so there is no
 *   honest way to make the browser see an updated worker. So we
 *   do NOT fake it: the `waiting→toast→one-reload` transition is `test.skip`-ped
 *   with this explanation and flagged for manual integration-QA
 *   (e.g. serve build A, register, then swap in build B and reload). The pieces
 *   that DON'T need a rebuild (registration/activation, precache, offline nav,
 *   the message-handler wiring) are all really exercised above.
 *
 * ── Harness notes ───────────────────────────────────────────────────────────
 *   - `test`/`expect` from `./fixtures` (wall bypass). Navigations use
 *     `waitUntil:'load'` (D-093 — the live tick + SW mean the net never idles;
 *     networkidle times out).
 *   - The registrar mounts + registers in a `useEffect` post-hydration, so every
 *     spec explicitly WAITS for `navigator.serviceWorker.ready` (resolves once a
 *     worker is activated) rather than assuming it's instant.
 *   - Chromium in this project runs headless with the default (non-persistent)
 *     context; SW + Cache Storage are available. Each test gets a fresh context
 *     (Playwright default), so registration is re-driven per test — no reliance
 *     on cross-test SW state.
 */

/**
 * Wait until a service worker is fully activated AND controlling this client,
 * then return its active-worker state.
 *
 * Two subtleties this must ride through:
 *  1. `navigator.serviceWorker.ready` resolves as soon as a worker becomes
 *     active, but the `activate` handler (which runs clients.claim()) finishes
 *     asynchronously — so a worker can momentarily read `'activating'`.
 *  2. On FIRST registration, clients.claim() fires a one-off `controllerchange`
 *     that the production registrar reacts to with a single `location.reload()`
 *     (components/service-worker-registrar.tsx) — a real page navigation. That
 *     reload fires on the SAME event that sets the controller, so there is a
 *     tiny window where the controller is set but the reload hasn't landed:
 *     a follow-up `page.evaluate` started in that window gets destroyed
 *     ("Execution context was destroyed, most likely because of a navigation").
 *
 * So the ENTIRE settle is done inside ONE `page.waitForFunction`, which — unlike
 * a separate `page.evaluate` — re-evaluates on the post-reload execution context
 * instead of throwing. It returns only once a worker is `activated` AND controls
 * the page, which by construction is after any first-load reload has flushed.
 * (Verified live: the mainframe navigates a few times during first-load SW
 * claim+reload, and this still lands on 'activated' / controller=true.)
 */
async function waitForActivatedSW(page: Page): Promise<string> {
  const handle = await page.waitForFunction(
    () => {
      if (!('serviceWorker' in navigator)) return 'unsupported';
      const ctrl = navigator.serviceWorker.controller;
      if (!ctrl) return false; // keep polling (across any reload) until controlling
      // The controlling worker is by definition activated — report its state so
      // the caller can assert it, and only resolve once it reads 'activated'.
      return ctrl.state === 'activated' ? 'activated' : false;
    },
    null,
    { timeout: 25_000 },
  );
  return (await handle.jsonValue()) as string;
}

/**
 * Run a `page.evaluate` that is resilient to the one-shot first-load SW reload.
 *
 * Even after `waitForActivatedSW` reports the worker activated+controlling, the
 * registrar's single `location.reload()` can still be in flight (it fires on the
 * same controllerchange that sets the controller). A `page.evaluate` started in
 * that narrow window is destroyed by the navigation. Since that reload is a
 * ONE-TIME event per context (the registrar guards re-entry with `refreshing`),
 * a single retry always lands on the stable post-reload context — so we retry
 * only on the specific "execution context was destroyed" navigation error, and
 * rethrow anything else. This reads the TRUE post-reload state; it masks nothing.
 */
async function safeEval<T>(page: Page, fn: () => T | Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await page.evaluate(fn);
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      if (/execution context was destroyed|navigation/i.test(msg)) {
        await page.waitForLoadState('load').catch(() => {});
        continue; // reload landed — retry on the fresh context
      }
      throw err;
    }
  }
  // Final attempt (let a genuine failure surface with its real error).
  return page.evaluate(fn);
}

/**
 * The two crash screens, kept as named constants because the WHOLE POINT of S364
 * is that these two are different failures with different blast radii:
 *   ROOT_CRASH  — `app/global-error.tsx`. Fires ONLY when the ROOT LAYOUT itself
 *                 throws. Nothing survives it: no navbar, no footer, no content,
 *                 on any route. It is the ONE crash `app/error.tsx` cannot catch.
 *   ROUTE_CRASH — `app/error.tsx`. The route BODY threw; the root layout is fine
 *                 and its chrome is still on screen around the message.
 */
const ROOT_CRASH = 'The app hit a problem';
const ROUTE_CRASH = 'Something went wrong';

/**
 * S364 — assert the ROOT APP SHELL really rendered, not a whole-app crash screen.
 *
 * 🔴 WHY THIS EXISTS. Until S364 the offline guard below asserted only:
 *     await expect(page.locator('h1').first()).toBeVisible();
 *     await expect(page.locator('h1').first()).not.toHaveText('');
 * BOTH crash screens render a visible, non-empty `h1`, so the check PASSED on an
 * app that crashed on every route — no discriminating power whatsoever (the
 * project's `vacuous-checks` mechanism 6). That is exactly how a cold-offline
 * install rendering `global-error` on `/`, `/plan/` and `/map/` shipped to `main`
 * under a green pack.
 *
 * Tightening the `h1` TEXT would only be a symptom fix — a future crash screen
 * with different copy sails through again. So this asserts two independent,
 * STRUCTURAL things:
 *
 *   (a) The root crash screen is ABSENT.
 *   (b) The root layout's OWN chrome actually mounted. `Navbar` and `BottomTabBar`
 *       are `dynamic(..., { ssr:false })` islands rendered by `app/layout.tsx` on
 *       every route, so their testids exist in the DOM if and only if those
 *       islands' chunks really loaded AND executed. Server-rendered HTML can NEVER
 *       satisfy this — which is the whole point: a cached route HTML whose layout
 *       chunks are missing still serves the correct <title>, so title/`h1` checks
 *       cannot tell a working app from a dead one. (b) can.
 *
 * MEASURED, not asserted: run against the pre-S364 build this fails on (a) with
 * `Received: 1` and the page snapshot containing nothing but the global-error
 * alert.
 *
 * ⚠️ WHAT THIS DELIBERATELY DOES *NOT* CLAIM. It does not assert the route BODY
 * rendered. On a cold-offline install a route's own `dynamic()` sections (e.g.
 * `app/plan/sections.tsx -> @/components/calendar-planner`) are still not
 * precached — the deliberate S359B scoping trade — so `/plan/` currently paints
 * ROUTE_CRASH inside working chrome. That is a REAL, measured residual, tracked by
 * the `test.fail()`-marked spec directly below, NOT something this helper quietly
 * tolerates. Do not "fix" that by widening this helper: the two guarantees have
 * different costs (closing the route-body one adds ~53 chunks / ~815 KiB to the
 * precache) and must be decided separately.
 *
 * `tab-bar` is asserted ATTACHED, not visible: it is `md:hidden`, so at the desktop
 * project viewport it is in the DOM but display:none.
 */
async function expectRootShellRendered(page: Page, where: string): Promise<void> {
  const rootCrash = page.getByRole('heading', { name: ROOT_CRASH, exact: true });
  const navbar = page.getByTestId('navbar');

  // Settle first: wait until the page has resolved into ONE of the two outcomes
  // (chrome mounted, or the root crash screen painted) so the assertions below read
  // a settled page rather than racing hydration and reporting a false "no crash".
  await expect(navbar.or(rootCrash).first()).toBeVisible({ timeout: 20_000 });

  // (a) The ROOT layout did not throw.
  await expect(
    rootCrash,
    `${where}: app/global-error.tsx rendered — the ROOT LAYOUT threw, so nothing on any route survives (a root-layout chunk is missing from the precache)`,
  ).toHaveCount(0);

  // (b) The root layout's ssr:false chrome islands really mounted and executed.
  await expect(
    navbar,
    `${where}: the root-layout Navbar island never mounted (its chunk did not load)`,
  ).toBeVisible();
  await expect(
    page.getByTestId('tab-bar'),
    `${where}: the root-layout BottomTabBar island never mounted (its chunk did not load)`,
  ).toBeAttached();
  await expect(
    page.getByRole('contentinfo'),
    `${where}: the root-layout Footer island never mounted (its chunk did not load)`,
  ).toBeAttached();
}

/**
 * S365 — assert the ROUTE BODY really rendered, not `app/error.tsx` inside working
 * chrome. The route-level companion to `expectRootShellRendered` above, and it is
 * deliberately the SAME shape: crash ABSENCE **plus** real-content PRESENCE.
 *
 * 🔴 WHY BOTH HALVES ARE REQUIRED — each alone is vacuous here:
 *   - PRESENCE alone would pass on a page that ALSO painted a crash somewhere.
 *   - ABSENCE alone would pass on a blank/never-mounted body (e.g. the
 *     `components/lazy-visible.tsx` mount latch failing open, which produces an
 *     EMPTY slot and NO error at all) — a silent no-op check.
 *
 * And `body` must be a locator for something inside an `ssr:false` island, never an
 * `h1` or a `<title>` check. Route HTML IS precached (D-073/S271), so a cold-offline
 * route whose body chunk is missing still serves its CORRECT `<title>` from cache;
 * and `app/error.tsx` replaces the page with its own visible, non-empty `h1`
 * ("Something went wrong"). MEASURED on the S365 red run: the dead /plan/ page's
 * ONLY level-1 heading was the crash screen's. So title/`h1` checks pass on a
 * completely dead route body — the zero-discriminating-power trap S364 found in
 * this file's own guard. Verified for the two anchors used below:
 * `grep -c calendar-toolbar out/plan/index.html` = 0 and
 * `grep -c 'id="nepal"' out/nepal/index.html` = 0, while each appears in exactly
 * one built chunk — so the locator resolves if and only if that chunk loaded AND
 * executed.
 */
/**
 * S365B — the route list is DERIVED from the built output, never hand-written.
 *
 * Ground truth is `out/`: every directory holding an `index.html` is a real built
 * route. Deliberately NOT read from `out/sw.js`'s precache list — that would make
 * the guard blind in exactly the direction that matters, because a route wrongly
 * dropped FROM the precache would also vanish from the list of routes being checked
 * and the test would stay green. Reading the filesystem means a route that exists but
 * is not precached shows up here and fails offline, which is the correct outcome.
 */
function discoverBuiltRoutes(): string[] {
  const outDir = join(process.cwd(), 'out');
  const routes = existsSync(join(outDir, 'index.html')) ? ['/'] : [];
  for (const entry of readdirSync(outDir, { withFileTypes: true })) {
    if (entry.isDirectory() && existsSync(join(outDir, entry.name, 'index.html'))) {
      routes.push(`/${entry.name}/`);
    }
  }
  return routes.sort();
}

/**
 * S365B — the per-route body anchor. The ROUTE LIST is derived (above); these ANCHORS
 * are declared, because "did this route's own content render" is domain knowledge that
 * cannot be derived, and a generic signal would be vacuous (the chrome mounts on every
 * route even when the body is dead, so "some client-only node exists" proves nothing).
 *
 * The two halves interlock: a route discovered in `out/` with NO entry here FAILS the
 * test. So a new route cannot silently fall out of the offline guarantee — someone has
 * to either give it an anchor or write down why it is skipped.
 *
 * Every anchor below was verified against the real build to be ABSENT from that route's
 * cached `index.html` and present once hydrated — i.e. it resolves if and only if that
 * route's `ssr:false` section really loaded AND executed. `kind: 'ssr'` marks the one
 * route where that is not true, and says so rather than pretending.
 */
type RouteBodyAnchor =
  | { anchor: string; what: string; kind?: 'ssr'; chromeless?: string }
  | { skip: string };

const ROUTE_BODY_ANCHOR: Record<string, RouteBodyAnchor> = {
  '/': {
    // The HOURS cell, not the days cell. Since issue #11 a calendar unit that is zero is
    // not rendered, so `countdown-days` is absent whenever the real remaining day count
    // divides by 7, a once-a-week false failure. The clock cells always render.
    anchor: '[data-testid="countdown-hours"]',
    what: 'the TripDashboard countdown island (app/page.tsx -> @/components/trip-dashboard)',
  },
  '/404/': {
    skip:
      'not a route: Next emits both 404.html and a redundant 404/index.html, and gen-sw ' +
      'deliberately precaches only 404.html as the nav fallback (see buildPrecacheList). ' +
      'It has no app chrome contract to assert.',
  },
  '/checklist/': {
    anchor: '[data-testid="docs-checklist"]',
    what: 'the DocsChecklist island (app/checklist/sections.tsx -> @/components/docs-checklist)',
  },
  '/flights/': {
    anchor: '#flights',
    what: 'the FlightsSection island (app/flights/sections.tsx -> @/components/flights-section)',
  },
  '/guides/': {
    anchor: '[data-testid="guides-country-nepal"]',
    what: 'the /guides/ country chooser body',
    // The ONE honest exception. app/guides/page.tsx is a fully static Server Component
    // with NO ssr:false sections at all (there is no app/guides/sections.tsx), so its
    // body is server-rendered and therefore present in the cached HTML. This anchor
    // still discriminates against app/error.tsx replacing the route — the failure this
    // test exists to catch — but it canNOT prove hydration ran. That half is covered on
    // this route by expectRootShellRendered, whose Navbar/BottomTabBar/Footer anchors
    // are ssr:false islands. Stated rather than silently weaker.
    kind: 'ssr',
  },
  '/japan/': {
    anchor: '#japan',
    what: 'the JapanSection island (app/japan/sections.tsx -> @/components/japan-section)',
  },
  '/journal/': {
    anchor: '[data-testid="journal-browse"]',
    what: 'the JournalBrowse island (app/journal/sections.tsx -> @/components/journal-browse)',
  },
  '/map/': {
    anchor: '[data-testid="map-shell"]',
    what: 'the MapSection island (app/map/sections.tsx -> @/components/map-section)',
    // S394 PROMOTED this from a `skip`. It was carved out because D-271 ① kept maplibre's
    // engine out of the precache, so cold-offline /map/ could only ever render the
    // MapIslandBoundary fallback and asserting route content would have contradicted the
    // decision. The owner reversed that: the engine (1.01 MiB) now ships with the install,
    // so /map/ owes the same cold-offline guarantee as every other route and gets the same
    // assertion. The boundary's degradation path did NOT lose its test — see the eviction-
    // driven one below, which now creates the missing-chunk condition itself instead of
    // borrowing it from an exclusion that no longer exists.
  },
  '/more/': {
    anchor: '[data-testid="more-link-flights"]',
    what: 'the /more/ hub link list',
  },
  '/nepal/': {
    anchor: '#nepal',
    what: 'the NepalSection island (app/nepal/sections.tsx -> @/components/nepal-section)',
  },
  '/packing/': {
    anchor: '[data-testid="packing-checklist"]',
    what: 'the PackingChecklist island (app/packing/sections.tsx -> @/components/packing-checklist)',
  },
  '/plan/': {
    anchor: '[data-testid="calendar-toolbar"]',
    what: 'the CalendarPlanner island (app/plan/sections.tsx -> @/components/calendar-planner)',
  },
  '/recap/': {
    anchor: '[data-testid="trip-story-recap"]',
    what: 'the TripStoryRecap island (app/recap/sections.tsx -> @/components/trip-story-recap)',
  },
  '/safety/': {
    anchor: '[data-testid="safety-kit"]',
    what: 'the TravelSafetyKit island (app/safety/sections.tsx -> @/components/travel-safety-kit)',
  },
  '/settings/': {
    anchor: '[data-testid="settings-panel"]',
    what: 'the SettingsPanel island (app/settings/sections.tsx -> @/components/settings-panel)',
  },
  '/share/': {
    anchor: '[data-testid="share-inbox"]',
    what: 'the ShareInbox island (app/share/sections.tsx -> @/components/share-inbox)',
  },
  '/travel/': {
    anchor: '[data-testid="day-strip"]',
    what: 'the TravelDatePicker island (app/travel/sections.tsx -> @/components/travel-date-picker)',
    // D-164 (LOCKED): Travel Mode is a CHROME-FREE route. All six chrome islands
    // self-suppress via lib/travel-route.ts `isTravelRoute()` — components/navbar.tsx
    // literally `return null`s here — so expectRootShellRendered CANNOT apply. Found by
    // running this widened guard: /travel/ rendered perfectly (Travel Mode heading,
    // agenda, day map, Exit button) and failed only on the absent navbar. The body
    // anchor below carries the full weight on this route, and it is enough: `day-strip`
    // lives inside the ssr:false TravelDatePicker island, so it is absent from the
    // cached HTML and proves hydration ran just as the navbar does elsewhere.
    chromeless: 'D-164 — Travel Mode deliberately renders no navbar/tab-bar/footer',
  },
  '/trips/': {
    anchor: '[data-testid="trips-hub"]',
    what: 'the TripsHub island (app/trips/sections.tsx -> @/components/trips-hub)',
  },
};

async function expectRouteBodyRendered(
  page: Page,
  where: string,
  body: Locator,
  what: string,
): Promise<void> {
  const routeCrash = page.getByRole('heading', { name: ROUTE_CRASH, exact: true });

  // Settle into ONE of the two outcomes (body mounted, or the route boundary
  // painted) before asserting, so this reads a settled page rather than racing
  // hydration and reporting a false "no crash".
  await expect(body.or(routeCrash).first()).toBeAttached({ timeout: 20_000 });

  // (a) The ROUTE boundary did not catch a throw.
  await expect(
    routeCrash,
    `${where}: app/error.tsx rendered — the route BODY threw inside working chrome (a route section's chunk is missing from the precache)`,
  ).toHaveCount(0);

  // (b) The route's own ssr:false section really mounted and executed.
  await expect(
    body,
    `${where}: ${what} never mounted (its chunk did not load), so the route body is empty`,
  ).toBeAttached();
}

test.describe('S84 · service worker registers + activates (D-073 / D-086)', () => {
  test('the SW reaches `activated` and controls the page on the served production build', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'load' });
    // The helper only returns once the active worker is `activated` AND a
    // controller exists, so a plain equality check proves both.
    const state = await waitForActivatedSW(page);
    expect(state).toBe('activated');
    expect(await safeEval(page, () => navigator.serviceWorker.controller != null)).toBe(true);
  });

  test('the registered SW script URL is /sw.js (single basePath prefix, empty here)', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'load' });
    await waitForActivatedSW(page);

    const scriptUrl = await safeEval(page, async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return reg?.active?.scriptURL ?? null;
    });
    expect(scriptUrl).not.toBeNull();
    // basePath is empty in this harness (gen-sw: basePath = (empty)), so the
    // registered worker is served at the origin root as /sw.js.
    expect(scriptUrl).toMatch(/\/sw\.js$/);
  });
});

test.describe('S84 · precache manifest present (D-073 shell contract)', () => {
  test('a trip-precache-* cache exists and holds the shell (root, static chunks, manifest)', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'load' });
    await waitForActivatedSW(page);

    const summary = await safeEval(page, async () => {
      const names = await caches.keys();
      const precacheName = names.find((n) => n.startsWith('trip-precache-'));
      if (!precacheName) return { precacheName: null, total: 0, urls: [] as string[] };
      const cache = await caches.open(precacheName);
      const reqs = await cache.keys();
      const urls = reqs.map((r) => new URL(r.url).pathname);
      return { precacheName, total: urls.length, urls };
    });

    // The content-hashed precache cache must exist and be non-trivially populated
    // (the build emitted 69 precache entries; assert a generous floor, not the
    // exact count, so a future shell change doesn't brittle-fail this).
    expect(summary.precacheName).toMatch(/^trip-precache-[a-f0-9]+$/);
    expect(summary.total).toBeGreaterThan(20);

    // The app-root shell is precached under its directory URL '/' (trailingSlash).
    expect(summary.urls).toContain('/');
    // The web app manifest is precached (D-073 lists manifest.webmanifest).
    expect(summary.urls.some((u) => u.endsWith('/manifest.webmanifest'))).toBe(true);
    // At least one hashed static chunk is precached (_next/static/**).
    expect(summary.urls.some((u) => u.startsWith('/_next/static/'))).toBe(true);
    // The other route HTMLs are precached too (nav offline works for all routes).
    // gen-sw.mjs DISCOVERS routes by walking out/ (TD-04 — no hand-kept ROUTE_HTML), so
    // every static route is precached automatically. S320 (D-231/D-170): the two new
    // routes `/guides/` and `/more/` are asserted here so the 5-tab IA's Guides + More
    // tabs resolve offline like every other route.
    for (const route of ['/plan/', '/nepal/', '/japan/', '/map/', '/travel/', '/guides/', '/more/']) {
      expect(summary.urls).toContain(route);
    }
  });

  test('images are NOT in the precache (runtime cache-first LRU, D-073)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    await waitForActivatedSW(page);

    const hasImages = await safeEval(page, async () => {
      const names = await caches.keys();
      const precacheName = names.find((n) => n.startsWith('trip-precache-'));
      if (!precacheName) return null;
      const cache = await caches.open(precacheName);
      const reqs = await cache.keys();
      return reqs.some((r) => /\/images\//.test(new URL(r.url).pathname));
    });
    // gen-sw.mjs deliberately EXCLUDES public/images/** from the precache (they
    // are runtime-cached in a separate LRU-capped cache), so none appear here.
    expect(hasImages).toBe(false);
  });
});

test.describe('S84 · offline cold navigation (SW cache-first nav handler)', () => {
  test('with the network offline, a fresh navigation still serves the app shell', async ({
    page,
    context,
  }) => {
    // 1) Warm the SW: load once online so it installs, activates, and precaches.
    await page.goto('/', { waitUntil: 'load' });
    await waitForActivatedSW(page);

    // Make sure the precache is actually populated before cutting the network
    // (install's individual puts are async within waitUntil).
    await expect
      .poll(async () =>
        safeEval(page, async () => {
          const names = await caches.keys();
          const precacheName = names.find((n) => n.startsWith('trip-precache-'));
          if (!precacheName) return 0;
          const cache = await caches.open(precacheName);
          return (await cache.keys()).length;
        }),
      )
      .toBeGreaterThan(20);

    // 2) Cut the network entirely.
    await context.setOffline(true);

    // 3) COLD navigate to a precached route while offline. The SW's navigate
    //    handler is cache-first on the normalized path (/plan/ is precached), so
    //    this must resolve from cache — not the (now-dead) network.
    //
    //    S364: this is the COLD-INSTALL condition, faithfully. The registrar does
    //    NOT reload on the first-install claim (S113E removed it —
    //    components/service-worker-registrar.tsx `hadController`), so the chunks
    //    step 1 fetched were fetched by an UNCONTROLLED page: the worker never saw
    //    them and never backfilled them. Whatever renders here renders from the
    //    INSTALL-TIME precache alone, which is exactly what a user gets who
    //    installs the PWA and goes offline without browsing first.
    await page.goto('/plan/', { waitUntil: 'load' });
    await expectRootShellRendered(page, 'offline cold nav to /plan/');

    // 4) An UNCACHED same-origin route falls back to the cached app-root shell
    //    (SPA-style offline nav fallback, D-073) rather than a browser error page.
    //    Same guard: the fallback must serve a WORKING Home shell, not a crash screen.
    await page.goto('/this-route-was-never-precached/', { waitUntil: 'load' });
    await expectRootShellRendered(page, 'offline nav fallback for an uncached route');

    // Restore the network for context teardown hygiene.
    await context.setOffline(false);
  });

  /**
   * S365 — the S364 residual, now CLOSED and guarded for real.
   *
   * This was `test.fail('KNOWN GAP (S364)')`: S364 restored the ROOT LAYOUT's
   * ssr:false islands to the precache (so the chrome renders cold-offline on every
   * route — the test above), but a route's OWN `dynamic()` sections were still not
   * precached, so a cold-offline `/plan/` painted `app/error.tsx` where the planner
   * should be, with "Loading chunk … failed" as the message. S365 widened
   * `gen-sw.mjs`'s island derivation from the root layout to the root layout PLUS
   * every `app/**​/page.tsx`, which closes it — so the marker becomes a real
   * assertion.
   *
   * 🔴 WHY IT ASSERTS WHAT IT ASSERTS. The route body is the HARDER half to check
   * honestly, because every cheap signal survives the failure:
   *   - the route HTML is precached, so the <title> and the SSR'd PageHero <h1> are
   *     CORRECT on a completely dead route body;
   *   - `app/error.tsx` renders a visible, non-empty `h1` of its own.
   * So `h1`/title checks have ZERO discriminating power here — that is the exact
   * vacuity S364 found in this file's own offline guard. `expectRouteBodyRendered`
   * asserts crash ABSENCE **plus** real-content PRESENCE, where the content anchor
   * is inside an `ssr:false` island and therefore CANNOT appear in the cached HTML.
   */
  test('cold-offline, EVERY route BODY renders its own dynamic sections (not app/error.tsx)', async ({
    page,
    context,
  }) => {
    // ~16 cold-offline navigations do not fit the 30s default (S365B measured the
    // default expiring mid-run). This is one test on purpose: the SW install + precache
    // warm-up is the expensive part and is shared across every route here.
    test.setTimeout(180_000);

    const routes = discoverBuiltRoutes();
    // The derivation itself must not silently collapse (a bad path, an empty out/)
    // and leave a green test that navigated nowhere.
    expect(routes.length, 'discoverBuiltRoutes() found no routes in out/').toBeGreaterThan(10);

    await page.goto('/', { waitUntil: 'load' });
    await waitForActivatedSW(page);
    await expect
      .poll(async () =>
        safeEval(page, async () => {
          const names = await caches.keys();
          const precacheName = names.find((n) => n.startsWith('trip-precache-'));
          if (!precacheName) return 0;
          const cache = await caches.open(precacheName);
          return (await cache.keys()).length;
        }),
      )
      .toBeGreaterThan(20);

    await context.setOffline(true);

    let asserted = 0;
    for (const route of routes) {
      const entry = ROUTE_BODY_ANCHOR[route];
      // A route on disk with no declared entry FAILS. This is the whole point of the
      // derive-the-list design: adding a route forces an explicit decision here, and a
      // new route can never quietly fall out of the offline guarantee.
      expect(
        entry,
        `route ${route} exists in out/ but has no ROUTE_BODY_ANCHOR entry — add a body ` +
          'anchor for it, or an explicit { skip: "<reason>" }. Never leave it undeclared.',
      ).toBeDefined();
      if ('skip' in entry!) continue;

      await page.goto(route, { waitUntil: 'load' });
      if (!entry!.chromeless) {
        await expectRootShellRendered(page, `offline cold nav to ${route} (route body)`);
      }
      await expectRouteBodyRendered(
        page,
        `offline cold nav to ${route}`,
        page.locator(entry!.anchor),
        entry!.what,
      );
      asserted++;
    }
    // Guards against the loop body being skipped wholesale (every entry a skip, an
    // empty route list that slipped the floor above) — a pass must mean real work.
    expect(asserted, 'no route body was actually asserted').toBeGreaterThan(14);

    await context.setOffline(false);
  });

  /**
   * S365 / S394 — a missing maplibre chunk must DEGRADE, not crash.
   *
   * In the App Router a `dynamic()` whose chunk is missing makes `React.lazy` THROW,
   * and the nearest boundary is `app/error.tsx` — so the failure is not "no map", it
   * is "no /map/ route at all", hero included. `components/map-island-boundary.tsx`
   * catches that throw at the call site and renders a named, honest pane.
   *
   * 🔴 WHAT S394 CHANGED, AND WHY THIS TEST WAS KEPT RATHER THAN DELETED. It used to
   * get the missing-chunk condition FOR FREE: D-271 ① kept maplibre out of the
   * precache, so cold-offline the chunk simply was not there. The owner reversed that
   * ruling and the engine now ships with the install — which removes the condition,
   * NOT the risk. Precached is not present: the chunk is still missing on a cold cache
   * (offline before the install finished), after a failed precache fetch, and after a
   * storage-pressure eviction. Deleting this test would have retired the boundary's
   * only proof at the exact moment its trigger became rarer and therefore less likely
   * to be noticed. So the test now CREATES the condition itself, by evicting maplibre
   * from the cache — which is a closer model of the real remaining failure anyway.
   *
   * The eviction is by CONTENT (`maplibregl` in the chunk body), the same predicate
   * `scripts/gen-sw.mjs`'s isMaplibreChunk() uses, because the filenames are bare
   * contenthashes. And it asserts it actually deleted something: an eviction that
   * silently matched nothing would leave a green test of a working map.
   */
  test('when maplibre is evicted from the cache, the map island degrades to a named pane instead of crashing its route', async ({
    page,
    context,
  }) => {
    await page.goto('/', { waitUntil: 'load' });
    await waitForActivatedSW(page);
    await expect
      .poll(async () =>
        safeEval(page, async () => {
          const names = await caches.keys();
          const precacheName = names.find((n) => n.startsWith('trip-precache-'));
          if (!precacheName) return 0;
          const cache = await caches.open(precacheName);
          return (await cache.keys()).length;
        }),
      )
      .toBeGreaterThan(20);

    const evicted = await safeEval(page, async () => {
      let removed = 0;
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const req of await cache.keys()) {
          if (!new URL(req.url).pathname.match(/^\/_next\/static\/.*\.js$/)) continue;
          const res = await cache.match(req);
          if (!res) continue;
          if ((await res.text()).includes('maplibregl')) {
            await cache.delete(req);
            removed++;
          }
        }
      }
      return removed;
    });
    expect(
      evicted,
      'no maplibre chunk was found in any cache to evict — the eviction matched nothing, so anything below would be a green test of a working map',
    ).toBeGreaterThan(0);

    await context.setOffline(true);
    await page.goto('/map/', { waitUntil: 'load' });

    // The root layout still mounts (S364) and the route boundary did NOT catch a
    // throw (S365) — i.e. the missing map chunk was contained at the island.
    await expectRootShellRendered(page, 'offline cold nav to /map/');
    await expect(
      page.getByRole('heading', { name: ROUTE_CRASH, exact: true }),
      'offline cold nav to /map/: the missing maplibre chunk escaped its island boundary and took the whole route down via app/error.tsx',
    ).toHaveCount(0);

    // The fallback pane is REAL, NAMED text (not a spinner) and is exposed to AT.
    const pane = page.getByTestId('map-island-unavailable').first();
    await expect(
      pane,
      'offline cold nav to /map/: the map island neither rendered nor fell back to its offline pane',
    ).toBeVisible({ timeout: 20_000 });
    await expect(pane).toContainText(/offline/i);

    // …and it is ACCESSIBLE. This pane is unreachable by every other axe spec in the
    // pack (it only exists when a chunk is genuinely missing), so if it is not scanned
    // here it is never scanned at all.
    // The app-wide offline banner fades opacity 0->1 on mount and axe sampling it
    // mid-fade deflates its contrast into a false positive — settle it first, the same
    // guard map-favorites-offline.spec.ts uses.
    const offlineBanner = page.getByTestId('offline-banner');
    await offlineBanner.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
    if (await offlineBanner.count()) {
      await expect(offlineBanner).toHaveCSS('opacity', '1');
    }
    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`),
      'offline cold nav to /map/: the map-unavailable fallback pane must be axe-clean',
    ).toEqual([]);

    await context.setOffline(false);
  });
});

test.describe('S84 · SW update flow (D-073 waiting→toast→one-reload)', () => {
  test('the SKIP_WAITING message handler is present in the shipped sw.js', async ({ page }) => {
    // The DETERMINISTIC half of the update flow: prove the message-channel wiring
    // the registrar's "Refresh" action posts to actually exists in the served
    // worker source. (The end-to-end waiting→toast→reload transition needs a
    // second build — see the skipped test below.)
    await page.goto('/', { waitUntil: 'load' });
    const swSource = await safeEval(page, async () => {
      const res = await fetch('/sw.js', { cache: 'no-store' });
      return res.text();
    });
    // Handler shape from gen-sw.mjs: a message listener gated on
    // `event.data.type === 'SKIP_WAITING'` that calls `self.skipWaiting()`.
    expect(swSource).toContain("event.data.type === 'SKIP_WAITING'");

    // D-073 LOCKED "no install-time skipWaiting" invariant: the install handler
    // must NOT call skipWaiting (it parks at `waiting` instead so the registrar
    // can surface the toast). Isolate the install block and assert it is clean;
    // the message block must carry the one real `self.skipWaiting()` call.
    // (A raw global count is unreliable — the source's own explanatory comment
    // mentions the token in prose — so we scope by handler instead.)
    const installBlock = swSource.slice(
      swSource.indexOf("addEventListener('install'"),
      swSource.indexOf("addEventListener('activate'"),
    );
    const messageBlock = swSource.slice(swSource.indexOf("addEventListener('message'"));
    expect(installBlock.length).toBeGreaterThan(0);
    expect(installBlock).not.toContain('self.skipWaiting()');
    expect(messageBlock).toContain('self.skipWaiting()');
  });

  test.skip('a new sw.js version parks at waiting, shows the toast, and Refresh does ONE reload', async () => {
    // NOT deterministically reproducible in the static-served harness (D-093):
    // triggering the browser's update detection requires serving a SECOND,
    // byte-different sw.js (a rebuild), which this single-immutable-`out/` harness
    // cannot do mid-run. Faking it (e.g. hand-editing the SW at runtime, or
    // forcing an `updatefound`) would not exercise the real registrar path and
    // would be a green lie. Left as an explicit skip so it shows in the
    // report as skipped — NOT silently omitted — for manual integration-QA:
    //   1. Serve build A; load; let the SW activate.
    //   2. Serve build B (any shell change → new precache hash → new sw.js).
    //   3. Reload; assert the "New version available" toast appears (worker parked
    //      at `waiting`, NO auto-activate), click Refresh, assert SKIP_WAITING is
    //      posted, `controllerchange` fires, and the page reloads EXACTLY once.
  });
});

test.describe('S221 · manifest shortcuts (installed-icon long-press jumps)', () => {
  test('the manifest ships 3 shortcuts, each with name+url, resolving to real routes', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'load' });
    const manifest = await page.evaluate(async () => {
      const res = await fetch('/manifest.webmanifest', { cache: 'no-store' });
      return res.json();
    });

    expect(Array.isArray(manifest.shortcuts)).toBe(true);
    expect(manifest.shortcuts).toHaveLength(3);

    for (const shortcut of manifest.shortcuts) {
      expect(typeof shortcut.name).toBe('string');
      expect(shortcut.name.length).toBeGreaterThan(0);
      expect(typeof shortcut.url).toBe('string');
      expect(shortcut.url.length).toBeGreaterThan(0);
    }

    // Every shortcut target must resolve to an existing, already-working route —
    // strip any #hash before navigating (a hash targets an in-page anchor, not a
    // separate document) and confirm the page actually renders an <h1>.
    for (const shortcut of manifest.shortcuts) {
      const path = shortcut.url.split('#')[0];
      await page.goto(path, { waitUntil: 'load' });
      await expect(page.locator('h1').first()).toBeVisible();
    }
  });
});

test.describe('S220 · manifest share_target (OS Share-sheet integration)', () => {
  test('the manifest declares a GET share_target for /share/ with title/text/url params', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'load' });
    const manifest = await page.evaluate(async () => {
      const res = await fetch('/manifest.webmanifest', { cache: 'no-store' });
      return res.json();
    });

    const st = manifest.share_target;
    expect(st).toBeTruthy();
    // GET is the ONLY method a static export (no server) can serve (S220).
    expect(st.method).toBe('GET');
    // Trailing-slash action, matching how every other static route resolves.
    expect(st.action).toBe('/share/');
    expect(st.params).toEqual({ title: 'title', text: 'text', url: 'url' });

    // The share_target action must resolve to a real, rendered route.
    await page.goto(st.action, { waitUntil: 'load' });
    await expect(page.locator('h1').first()).toBeVisible();

    // Adding share_target must NOT have disturbed the S221 shortcuts.
    expect(Array.isArray(manifest.shortcuts)).toBe(true);
    expect(manifest.shortcuts).toHaveLength(3);
  });
});
