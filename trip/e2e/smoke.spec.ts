import { test, expect } from './fixtures';
import type { ConsoleMessage } from '@playwright/test';

/**
 * Smoke pack (slice S80, D-093) — the FIRST browser-level E2E coverage for this
 * project. Deliberately light: by design, this proves the harness itself
 * (served static `out/`, wall bypass, console-error hygiene) rather than deep
 * feature behavior — the heavy testid-driven waves are S81-S84.
 *
 * For each of the 5 routes this asserts:
 *   1. The Trip Token wall is NOT blocking (the sign-in seed actually worked) —
 *      checked by asserting no `role="dialog"` wall panel is present AND the
 *      page's own <h1> is visible (the wall being open would cover it / the
 *      main content wouldn't be interactive).
 *   2. A visible, non-empty <h1> renders (Home's hero h1, or the PageHero h1
 *      on /plan, /nepal, /japan, /map — confirmed against the real DOM/source
 *      directly, not assumed).
 *   3. Zero console errors and zero uncaught page errors during load.
 */

const ROUTES = [
  { path: '/', name: 'home' },
  { path: '/plan/', name: 'plan' },
  { path: '/nepal/', name: 'nepal' },
  { path: '/japan/', name: 'japan' },
  { path: '/map/', name: 'map' },
] as const;

for (const route of ROUTES) {
  test(`${route.name} (${route.path}) — renders, wall bypass holds, no console errors`, async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err: Error) => {
      pageErrors.push(err.message);
    });

    // NOTE: this app ships a service worker + a live per-second countdown tick,
    // so the network is never truly idle — `waitUntil: 'networkidle'` reliably
    // times out here. `load` (default `waitUntil`) + Playwright's own
    // auto-waiting assertions below are the robust, idiomatic wait strategy.
    await page.goto(route.path);

    // Wall bypass: the Trip Token wall must NOT be present. The wall renders a
    // role="dialog" panel with this accessible name (h2 "Nepal × Japan Journey")
    // when open; assert it's absent so we know we're seeing the real app, not
    // the wall sitting on top of it. Auto-retries until the wall (if it ever
    // flashed open) has resolved away.
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);

    // Primary render proof: a visible, non-empty <h1>.
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible();
    await expect(h1).not.toHaveText('');

    // /map additionally mounts the persistent map-host shell (D-093 registry,
    // docs/test-ids.md #9) — supplement the render proof there.
    if (route.name === 'map') {
      await expect(page.locator('[data-testid="map-shell"]')).toBeVisible();
    }

    // Zero console errors / uncaught page errors for this route's load.
    expect(consoleErrors, `console errors on ${route.path}: ${consoleErrors.join('\n')}`).toEqual(
      [],
    );
    expect(pageErrors, `uncaught page errors on ${route.path}: ${pageErrors.join('\n')}`).toEqual(
      [],
    );
  });
}
