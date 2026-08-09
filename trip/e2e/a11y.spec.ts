import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Axe accessibility scan pack (slice S85, D-088) — E2E wave 5 (part 1).
 *
 * Runs an automated axe-core scan (via `@axe-core/playwright`, MIT/OSS → free per
 * D-088) over each of the five app routes with a SIGNED-IN identity (fixtures seed
 * `tripPlannerToken`/`tripPlannerUserName` so the Trip Token wall never opens —
 * otherwise every scan would just audit the token dialog, not the page).
 *
 * ── Gate widened to `moderate` (S157, FU-12/FU-22 sweep) ────────────────────────
 *   Originally `serious`/`critical` only (S85). An audit for this slice suspected a
 *   `heading-order` (moderate) defect in `country-essentials.tsx` on /nepal + /japan
 *   — re-verified against the CURRENT tree with `.withRules(['heading-order'])`
 *   directly: the rule ran (`passes:1`) and found **zero violations** on both
 *   routes (DOM dump confirms monotonic h1→h2→h3→h4, no skips) — the suspected
 *   defect does not reproduce here, so no heading-level code change was made. A
 *   full run across all five routes independently confirmed **zero moderate/minor
 *   findings everywhere** (`axe SUMMARY` per route, S157), so the gate
 *   widens to `serious`/`critical`/`moderate` for ALL FIVE routes — not just
 *   /nepal + /japan — with no carve-outs needed. `minor` stays advisory/logged
 *   only (still frequently opinionated house-style noise, e.g. "region"). If a
 *   moderate finding appears in a future change, the contract is: fix it or
 *   revert — do NOT lower this threshold to go green.
 *
 * ── Harness notes ───────────────────────────────────────────────────────────────
 *   - `test`/`expect` from `./fixtures` (signed-in front-door bypass).
 *   - The served `out/` is a production build, so the SW registrar does ONE
 *     first-load `location.reload()` (D-073). Scanning the DOM before that reload
 *     flushes → "execution context destroyed" flakes. So after `goto` we ride
 *     through the reload by waiting for the SW to control the page (mirror of the
 *     S83/S84 `goto` settle) BEFORE handing the page to axe. `waitUntil:'load'`,
 *     never networkidle (D-093).
 *   - `/nepal` and `/japan` mount their guide islands via `dynamic({ssr:false})`
 *     behind a skeleton; `/plan` and `/map` likewise lazy-mount. We wait for each
 *     route's real lead content (its <h1>/known testid) to attach so axe scans the
 *     mounted page, not the loading skeleton.
 *   - axe is scoped with `.exclude()` of the persistent MapLibre canvas on /map:
 *     the WebGL `<canvas>` is an opaque third-party render surface with no
 *     semantic children for axe to evaluate, and it is already labelled at the
 *     `map-shell` host level. Excluding the canvas subtree avoids canvas-internal
 *     noise while still scanning the whole map PAGE (chrome, filters, controls).
 */

// The routes under test (trailing slash — the canonical static-export form).
// S325: `/flights/` added — it was previously never axe-gated; its "Check live
// status" deep-link rails + booked-stay cards must meet the same contract.
const ROUTES = ['/', '/plan/', '/nepal/', '/japan/', '/map/', '/flights/'] as const;

/**
 * Navigate and settle past the FIRST-LOAD service-worker reload before scanning.
 *
 * Identical intent to the S83/S84 specs' `goto` helper: the served production
 * `out/` registers the SW, and on first registration clients.claim() triggers a
 * one-off `location.reload()` (D-073). `page.waitForFunction` re-evaluates on the
 * post-reload execution context (a plain `evaluate`/axe run started mid-reload gets
 * its context destroyed), so we block until the SW controls the page — by which
 * point the reload has flushed. If no SW registers (defensive), the timeout expires
 * and we proceed, so this can only ADD stability.
 */
async function gotoSettled(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'load' });
  await page
    .waitForFunction(
      () => !('serviceWorker' in navigator) || navigator.serviceWorker.controller !== null,
      null,
      { timeout: 15_000 },
    )
    .catch(() => {
      /* no SW / already stable — proceed */
    });
}

/**
 * Wait for each route's real lead content to be present so axe scans the mounted
 * page rather than a `dynamic({ssr:false})` loading skeleton. Every route renders
 * an <h1> once its content island mounts (Home hero h1, or the per-page PageHero
 * h1 on the sub-routes), so a visible <h1> is a reliable, route-agnostic "content
 * is up" signal.
 */
async function waitForRouteContent(page: Page) {
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
}

/**
 * Build an axe scan for the current page. Excludes only the opaque MapLibre WebGL
 * canvas (no semantic subtree; the host is labelled at `map-shell`) — everything
 * else on every page IS scanned.
 */
function scanFor(page: Page) {
  return new AxeBuilder({ page }).exclude('canvas.maplibregl-canvas');
}

for (const route of ROUTES) {
  test(`axe: ${route} has zero serious/critical/moderate violations (signed-in)`, async ({
    page,
  }, testInfo) => {
    await gotoSettled(page, route);
    await waitForRouteContent(page);

    const results = await scanFor(page).analyze();

    // Partition by impact so serious/critical/moderate are the hard gate (S157
    // widen — all five routes independently verified clean at this level) while
    // minor is surfaced (attached to the report) but non-fatal.
    const blocking = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical' || v.impact === 'moderate',
    );
    const advisory = results.violations.filter(
      (v) => v.impact !== 'serious' && v.impact !== 'critical' && v.impact !== 'moderate',
    );

    // Log EVERY violation (both tiers) to the test annotations + stdout so the run
    // output is a real per-route audit record, not just a pass/fail bit.
    for (const v of results.violations) {
      const line = `[${v.impact ?? 'n/a'}] ${v.id}: ${v.help} (${v.nodes.length} node${v.nodes.length === 1 ? '' : 's'})`;
      testInfo.annotations.push({ type: `axe:${v.impact ?? 'unknown'}`, description: line });
      // eslint-disable-next-line no-console
      console.log(`  axe ${route} ${line}`);
    }
    // eslint-disable-next-line no-console
    console.log(
      `axe SUMMARY ${route}: serious/critical/moderate=${blocking.length}, minor=${advisory.length}`,
    );

    // The hard contract: no serious, critical, or moderate violations. On
    // failure, the message lists the offending rule ids so they can be
    // reported as findings (do NOT lower the threshold to pass).
    expect(
      blocking,
      `serious/critical/moderate a11y violations on ${route}: ${blocking
        .map((v) => `${v.id} [${v.impact}] × ${v.nodes.length}`)
        .join('; ')}`,
    ).toEqual([]);
  });
}

/**
 * S322G — the guide facets moved behind ONE "Filters · n" sheet. The route loop above
 * already scans /nepal + /japan with the sheet CLOSED; this scans /nepal with the sheet
 * OPEN so the modal dialog (portal, focus-trap, chips, sort select) is audited for the
 * same serious/critical/moderate contract.
 */
test('axe: /nepal with the filters sheet OPEN has zero serious/critical/moderate violations', async ({
  page,
}, testInfo) => {
  await gotoSettled(page, '/nepal/');
  await waitForRouteContent(page);

  // Open the filters sheet and wait for the dialog to attach before scanning.
  await page.getByTestId('guide-filters-trigger').click();
  await expect(page.getByTestId('guide-filters-sheet')).toBeVisible();

  const results = await scanFor(page).analyze();

  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical' || v.impact === 'moderate',
  );
  const advisory = results.violations.filter(
    (v) => v.impact !== 'serious' && v.impact !== 'critical' && v.impact !== 'moderate',
  );
  for (const v of results.violations) {
    const line = `[${v.impact ?? 'n/a'}] ${v.id}: ${v.help} (${v.nodes.length} node${v.nodes.length === 1 ? '' : 's'})`;
    testInfo.annotations.push({ type: `axe:${v.impact ?? 'unknown'}`, description: line });
    // eslint-disable-next-line no-console
    console.log(`  axe /nepal[filters-open] ${line}`);
  }
  // eslint-disable-next-line no-console
  console.log(
    `axe SUMMARY /nepal[filters-open]: serious/critical/moderate=${blocking.length}, minor=${advisory.length}`,
  );

  expect(
    blocking,
    `serious/critical/moderate a11y violations on /nepal (filters sheet open): ${blocking
      .map((v) => `${v.id} [${v.impact}] × ${v.nodes.length}`)
      .join('; ')}`,
  ).toEqual([]);
});
