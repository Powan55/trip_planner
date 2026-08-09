import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config (slice S80, D-093) — the browser-E2E harness for this
 * project. Points at the SERVED STATIC `out/` build (the exact artifact that
 * deploys to GitHub Pages), never `next dev` — the standing QA-harness rule
 * (memory `headless-qa-env`): the deployed artifact is what we test.
 *
 * `webServer` builds nothing itself (that's a separate, explicit `npm run
 * build` step — see package.json) — it only starts the
 * zero-dependency static file server (`scripts/serve-out.mjs`) against the
 * `out/` directory that must already exist, and Playwright waits for it to
 * respond before running specs.
 *
 * Browser: a downloaded Chromium (revision matching playwright-core's
 * `browsers.json`) was ALREADY present in this sandbox's
 * `%LOCALAPPDATA%/ms-playwright` cache and verified via
 * `npx playwright install chromium` (a no-op re-confirmation, since it was
 * already installed) — so this uses Playwright's own bundled/downloaded
 * Chromium (`{ channel: undefined }`, the default `chromium` project), NOT the
 * `channel: 'chrome'` system-Chrome fallback. If a future environment lacks
 * that cached browser and the download is blocked, switch this project's
 * `use` to `{ channel: 'chrome' }` per the brief's documented fallback.
 *
 * `workers: 1` (not Playwright's parallel default): in THIS sandbox, running
 * the 5 smoke specs across multiple parallel Chromium workers against the
 * single-threaded `serve-out.mjs` server produced consistent
 * `page.goto` timeouts (every route hung past 30s) even though the exact same
 * server answered every route instantly via `curl` and via a single-worker
 * run. Serialized (`workers: 1`) the identical pack is green in ~24s total.
 * This looks like a resource ceiling on concurrent Chromium processes in this
 * environment, not a bug in the app or the server — recorded here (and in the
 * D-093 proposal) so QA / CI reproduce with the same flag rather than
 * rediscovering the flake. Revisit if a beefier CI runner makes parallelism
 * safe.
 */
const PORT = Number(process.env.PLAYWRIGHT_PORT) || 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * S356 — the landing-page product-shot SHOOT (`e2e/landing-shots.spec.ts`) is an ASSET
 * GENERATOR, not a check: it WRITES the committed PNGs under `public/images/landing/`.
 * Letting the default net run it would rewrite tracked files mid-suite and re-shoot them on
 * every CI run, so it is `testIgnore`d out of chromium — the same mechanism that already
 * keeps `tm-acceptance.spec.ts` off this project. `PLAYWRIGHT_SHOOT=1` opts it back in for
 * the one explicit invocation that regenerates the assets. Default (unset) = excluded, so
 * `npm run test:e2e` is byte-identical to its pre-S356 spec set.
 */
const SHOOT_IGNORE = process.env.PLAYWRIGHT_SHOOT ? [] : ['**/landing-shots.spec.ts'];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // CI retries: a generic environmental backstop, NOT the mechanism for any known
  // flake. The D-093 CRUD-then-reload flake (persistence.spec.ts) was root-caused and
  // fixed at the source in S114/FU-15 — S113E removed the service-worker first-install
  // reload, and the spec's gotoSettled/reloadSettled now wait on a real readiness
  // signal (the lazy CalendarPlanner island's calendar-day-* grid) instead of the
  // non-deterministic `networkidle`. That pack is now green at `--repeat-each=20
  // --retries=0`, so these two retries are demonstrably NOT load-bearing for it. They
  // stay as a small backstop for genuinely-new environmental noise. See
  // docs/ci-flake-policy.md. Local = 0 (a bare failure surfaces immediately).
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      // The default net (373 specs). It must NOT also run the iPhone-scoped Travel Mode
      // acceptance net — that pack belongs to the two device projects below, and letting
      // chromium multiply it would double an already-~10-min run (S191). testIgnore keeps
      // chromium's spec set byte-identical to its pre-S191 baseline.
      // S356: the landing-shots shoot is excluded unless PLAYWRIGHT_SHOOT=1 (see SHOOT_IGNORE).
      testIgnore: ['**/tm-acceptance.spec.ts', ...SHOOT_IGNORE],
      use: { ...devices['Desktop Chrome'] },
    },
    // ── S191 — Travel Mode acceptance net on real-device-shaped viewports ────────────────────
    // Engine call (frontend-engineer, S191): CHROMIUM-ENGINE EMULATION, not real WebKit.
    // WebKit is not installed in this sandbox (only chromium-1228 is), a `playwright install
    // webkit` download is an unverified/possibly-blocked step, and WebKit-on-Windows against the
    // single-threaded serve-out server is exactly the class of flake the config header already
    // documents for parallel chromium. The brief's rule — "determinism on this machine beats
    // engine purity" — points at emulation: we take the iPhone descriptor's DPR 3 / touch /
    // isMobile / iOS-Safari UA and drive it on the SAME chromium the green 373-spec net uses.
    // Viewport is pinned to the device's FULL screen points (393×852 / 430×932 — the V5-DEVPLAN
    // TM-8 numbers, the standalone-PWA display Travel Mode targets), not the descriptor's
    // Safari-chrome-reduced web viewport. testMatch scopes each project to ONLY the TM net.
    {
      name: 'iphone-15-pro',
      testMatch: ['**/tm-acceptance.spec.ts'],
      use: {
        ...devices['iPhone 15 Pro'],
        viewport: { width: 393, height: 852 },
        defaultBrowserType: 'chromium',
      },
    },
    {
      name: 'iphone-15-pro-max',
      testMatch: ['**/tm-acceptance.spec.ts'],
      use: {
        ...devices['iPhone 15 Pro Max'],
        viewport: { width: 430, height: 932 },
        defaultBrowserType: 'chromium',
      },
    },
  ],

  webServer: {
    command: `node scripts/serve-out.mjs --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
