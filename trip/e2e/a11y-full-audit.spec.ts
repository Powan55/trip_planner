import { test, expect, settleAnimations } from './fixtures';
import type { Page, TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * S212 — app-wide axe completeness pass. Closes the ROUTE and DIALOG gaps left by the
 * established axe packs, so serious/critical = 0 is proven EVERYWHERE, not just on the
 * historically-gated surfaces.
 *
 * ── Current coverage BEFORE this pack (enumerated so the gap is explicit) ───────────────
 *   - a11y.spec.ts (S85/S157):        /, /plan, /nepal, /japan, /map, /flights   — serious/critical/MODERATE
 *   - a11y-intrip.spec.ts (F19b):     / + /plan in-trip panels          — serious/critical
 *   - packing-a11y.spec.ts (S206):    /packing                          — serious/critical
 *   - docs-checklist-a11y (S217):     /checklist                        — serious/critical
 *   - journal-browse-a11y (S153):     /journal                          — serious/critical
 *   - tm-acceptance TM-12 (S191):     /travel legibility OFF/ON (iPhone)— serious/critical
 *   - s157-a11y-close-targets:        calendar-editor / add-item / expense / place-detail /
 *                                     time-picker / command-palette dialogs (SCOPED subtree scan)
 *
 * ── The GAP this pack closes ────────────────────────────────────────────────────────────
 *   - Routes with NO full-page axe gate:  /safety, /recap, /settings, /share  (traveler state).
 *     `/flights` joined a11y.spec.ts's ROUTES afterwards (S325) at the stricter moderate bar, so
 *     it is now double-scanned — kept here deliberately, since this pack is the full-page net.
 *   - TM designed states on the DESKTOP net (TM-12 only runs iPhone): pre / nepal / japan /
 *     post / empty / legibility-ON — full-page scans, not the scoped hero.
 *   - v5 dialogs/overlays as FULL-PAGE scans (background + dialog together, stronger than the
 *     s157 subtree scan): trip-join handshake, add-to-itinerary, expense log. Plus the /recap
 *     Wrapped story surface (inline section, not a modal) in its populated state.
 *
 * Hard contract = serious/critical/moderate = 0 (issue #215 — widened to match a11y.spec.ts's
 * S157 bar; a loosened run came back 17/17 clean). minor stays advisory. NO axe `.exclude()`
 * is used anywhere in this file EXCEPT the single
 * opaque MapLibre WebGL canvas that every existing pack already excludes (it has no semantic
 * subtree and is labelled at its host) — no NEW exclusion is introduced (house rule: an
 * exclude is a STOP-and-report; none was needed).
 *
 * Harness mirrors a11y.spec.ts: signed-in wall-bypass fixture, settle past the D-073
 * first-load SW reload, wait for real content, and settle the reveal animations before every
 * scan (`settleAnimations`, shared from e2e/fixtures.ts — this pack copied the rest of that
 * harness without the settle and re-ran its contrast race). `waitUntil:'load'` (never
 * networkidle, D-093).
 */

async function settleSW(page: Page) {
  await page
    .waitForFunction(
      () => !('serviceWorker' in navigator) || navigator.serviceWorker.controller !== null,
      null,
      { timeout: 15_000 },
    )
    .catch(() => {});
}

async function gotoSettled(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'load' });
  await settleSW(page);
}

/** Only the opaque MapLibre canvas is excluded — the SAME exclusion every existing pack uses. */
function scanFor(page: Page) {
  return new AxeBuilder({ page }).exclude('canvas.maplibregl-canvas');
}

/**
 * Shared serious/critical/moderate assertion + advisory logging (matches a11y.spec.ts's
 * S157 bar). Issue #215: this pack started at serious/critical-only while a11y.spec.ts had
 * already widened to moderate — a full loosened run came back 100% clean (17/17, only a
 * `minor` aria-allowed-role finding logged as advisory), so the two packs are level again.
 */
async function expectAxeClean(page: Page, label: string, testInfo: TestInfo) {
  await settleAnimations(page);
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
    console.log(`  axe ${label} ${line}`);
  }
  console.log(`axe SUMMARY ${label}: serious/critical/moderate=${blocking.length}, minor=${advisory.length}`);
  expect(
    blocking,
    `serious/critical/moderate a11y violations on ${label}: ${blocking
      .map((v) => `${v.id} [${v.impact}] × ${v.nodes.length}`)
      .join('; ')}`,
  ).toEqual([]);
}

// ── The previously-ungated content routes (traveler state) ──────────────────────────────
// Issue #5 adds `/passport/`, and it is the one entry here that is not merely "another route
// nobody scanned yet": it is the app's ONLY light surface (D-294's parchment exception to
// dark-only), so every contrast assumption the dark chrome was measured against is inverted on
// it. scripts/contrast-tokens.mjs measures the pairs from the token values; this scans what the
// browser actually composited.
//
// `/profile/` (issue #4) joins the list rather than getting its own pack: it is a form, and a
// form is the shape axe has the most to say about — labels, names, the invalid state.
//
// `/plan/` carries a viewport because a11y.spec.ts already scans it at desktop width, where
// the expense ledger's table fits and its scroller does not exist to be scanned.
const UNGATED_ROUTES: {
  path: string;
  viewport?: { width: number; height: number };
  ready?: string;
}[] = [
  { path: '/flights/' },
  { path: '/safety/' },
  { path: '/recap/' },
  { path: '/settings/' },
  { path: '/share/' },
  { path: '/passport/' },
  { path: '/profile/' },
  { path: '/plan/', viewport: { width: 390, height: 844 }, ready: 'budget-ledger' },
];

for (const { path, viewport, ready } of UNGATED_ROUTES) {
  const label = viewport ? `${path} @${viewport.width}px` : path;
  test(`axe: ${label} has zero serious/critical (traveler state)`, async ({ page }, testInfo) => {
    if (viewport) await page.setViewportSize(viewport);
    await gotoSettled(page, path);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
    if (ready) await expect(page.getByTestId(ready)).toBeVisible({ timeout: 15_000 });
    await expectAxeClean(page, label, testInfo);
  });
}

// axe only proves something in that region is focusable, not that the node which scrolls is.
test('the expense ledger scroller is keyboard-reachable and named @390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoSettled(page, '/plan/');
  const scroller = page.getByTestId('budget-ledger-scroll');
  await expect(scroller).toBeVisible({ timeout: 15_000 });

  const overflows = await scroller.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(overflows, 'ledger scroller should overflow horizontally at 390px').toBe(true);

  await scroller.focus();
  await expect(scroller).toBeFocused();
  await expect(scroller).toHaveAccessibleName(/Logged spend by category/);
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollLeft), { timeout: 5_000 })
    .toBeGreaterThan(0);
});

// ── Travel Mode designed states, full-page, on the desktop net (TM-12 runs iPhone-only) ──
const TM_SEED = {
  date: '2026-12-10',
  city: 'Kathmandu',
  country: 'nepal',
  items: [
    { id: 'ax-now', title: 'Boudhanath walk', category: 'photography', startMinutes: 660, durationMinutes: 120 },
    { id: 'ax-next', title: 'Thamel lunch', category: 'food', startMinutes: 900 },
    { id: 'ax-untimed', title: 'Souvenir hunt', category: 'sightseeing' },
  ],
};

async function gotoTravel(page: Page, query: string) {
  await page.goto(`/travel/${query}`, { waitUntil: 'load' });
  await settleSW(page);
  await expect(page.getByTestId('travel-mode-root')).toBeVisible({ timeout: 15_000 });
}

test.describe('axe: Travel Mode designed states (full page, desktop net)', () => {
  test('pre-trip preview notice', async ({ page }, testInfo) => {
    await gotoTravel(page, '?today=2026-12-05');
    await expect(page.getByTestId('travel-pretrip-notice')).toBeVisible();
    await expectAxeClean(page, '/travel pre-trip', testInfo);
  });

  test('in-trip nepal (now phase)', async ({ page }, testInfo) => {
    await page.addInitScript((d) => {
      window.localStorage.setItem('nepal_japan_itinerary', JSON.stringify([d]));
    }, TM_SEED);
    await gotoTravel(page, '?today=2026-12-10');
    await expect(page.getByTestId('travel-agenda')).toBeVisible();
    await expectAxeClean(page, '/travel nepal', testInfo);
  });

  test('in-trip japan (Osaka)', async ({ page }, testInfo) => {
    await page.addInitScript((d) => {
      window.localStorage.setItem('nepal_japan_itinerary', JSON.stringify([d]));
    }, { ...TM_SEED, date: '2026-12-19', city: 'Osaka', country: 'japan' });
    await gotoTravel(page, '?today=2026-12-19');
    await expect(page.locator('#travel-hero-title')).toContainText('Osaka');
    await expectAxeClean(page, '/travel japan', testInfo);
  });

  test('post-trip off-trip card', async ({ page }, testInfo) => {
    await gotoTravel(page, '?today=2027-02-01');
    await expect(page.getByTestId('travel-hero-offtrip')).toBeVisible();
    await expectAxeClean(page, '/travel post-trip', testInfo);
  });

  test('empty date (trip day, nothing planned)', async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'nepal_japan_itinerary',
        JSON.stringify([{ date: '2026-12-10', city: 'Kathmandu', country: 'nepal', items: [] }]),
      );
    });
    await gotoTravel(page, '?today=2026-12-10');
    await expect(page.getByTestId('travel-hero-empty')).toBeVisible();
    await expectAxeClean(page, '/travel empty-date', testInfo);
  });

  test('legibility-ON (outdoor high-legibility, D-192)', async ({ page }, testInfo) => {
    await page.addInitScript((d) => {
      window.localStorage.setItem('nepal_japan_itinerary', JSON.stringify([d]));
    }, TM_SEED);
    await gotoTravel(page, '?today=2026-12-10');
    await page.getByTestId('travel-legibility-toggle').click();
    await expect(page.getByTestId('travel-legibility-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expectAxeClean(page, '/travel legibility-ON', testInfo);
  });
});

// ── v5 dialogs / overlays — FULL-PAGE scans (background + open dialog together) ──────────
test.describe('axe: key dialogs open (full page)', () => {
  test('trip-join handshake dialog (?trip=<other token>)', async ({ page }, testInfo) => {
    // A token that differs from getActiveTripId() opens the handshake island's AlertDialog (#10).
    await gotoSettled(page, '/?trip=some-other-trip-token');
    await expect(page.getByTestId('trip-join-dialog')).toBeVisible({ timeout: 15_000 });
    await expectAxeClean(page, 'trip-join handshake', testInfo);
  });

  test('add-to-itinerary (quick-add) dialog', async ({ page }, testInfo) => {
    // The quick-add FAB is a mobile surface — phone viewport, matching the S157 pack's harness.
    await page.setViewportSize({ width: 390, height: 844 });
    /**
     * S357C — background route moved `/plan/` → `/`. This is a COVERAGE decision, not a
     * locator tweak, because this describe does FULL-PAGE scans (background + open dialog),
     * so the host route is part of what axe sees. It does not shrink coverage:
     *
     *  - The AUDITED SUBJECT is unchanged. `quickadd:open` has exactly ONE dispatcher in the
     *    app (`components/quick-add-fab.tsx`), so the FAB is the only way to reach
     *    `AddToItineraryDialog mode="custom"` — the mode with the editable Title/Location
     *    fields. Same component, same mode, same trigger, same 390px viewport, same
     *    full-page scan. Reaching it "by another affordance on /plan/" is not available:
     *    the planner's own add path opens `calendar-editor`, a DIFFERENT dialog (already
     *    axe-gated by e2e/s157-a11y-close-targets.spec.ts), and the S357A composer is not a
     *    quickadd dispatcher.
     *  - The BACKGROUND that was dropped is independently gated, and more strictly:
     *    `e2e/a11y.spec.ts` scans `/plan/` at serious/critical/MODERATE (this pack's bar is
     *    serious/critical). `/` is in that same route list, so the new background is gated
     *    too.
     *  - `/` as a dialog backdrop is this describe's existing idiom — the trip-join
     *    handshake test above scans a dialog over `/`.
     *
     * Net: one full-page scan of the custom add-to-itinerary dialog, before and after.
     */
    await gotoSettled(page, '/');
    await page.getByTestId('quick-add-fab').click();
    await expect(page.getByTestId('add-item-dialog')).toBeVisible();
    // Settle the entrance fade before the axe scan: axe samples computed colors, and the
    // dialog's opacity 0→1 entrance composites text to a lower-contrast mid-fade blend (a
    // false serious hit). Exposed by the S323 de-glass (the former glass gradient bg made
    // axe skip contrast on these panels); mirrors the s157 close-targets guard.
    await expect(page.getByTestId('add-item-dialog')).toHaveCSS('opacity', '1');
    await expectAxeClean(page, 'add-to-itinerary dialog', testInfo);
  });

  test('expense log dialog', async ({ page }, testInfo) => {
    await page.goto('/plan/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('budget-panel')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('budget-view-tab-expenses').click(); // S322: log trigger is on the Expenses view
    await page.getByTestId('expense-log-open').click();
    await expect(page.getByTestId('expense-dialog')).toBeVisible();
    // Settle the entrance fade before the axe scan (see the add-to-itinerary guard above).
    await expect(page.getByTestId('expense-dialog')).toHaveCSS('opacity', '1');
    await expectAxeClean(page, 'expense dialog', testInfo);
  });

  test('Wrapped story (populated, mid-trip) on /recap', async ({ page }, testInfo) => {
    await gotoSettled(page, '/recap/?today=2026-12-20');
    await expect(page.getByTestId('wrapped-story')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('wrapped-entry')).toBeVisible({ timeout: 15_000 });

    // S336 settle-guard (ported S351B — found missing here in the same survey that ported it to
    // weather-tag.spec.ts): 2026-12-20 is on-trip and this test never dismisses/seeds the
    // travel-arrival toast's 'seen' flag, so it is eligible on /recap exactly as it was on
    // wrapped-story.spec.ts's own (already-guarded) /recap axe test. Settle its opacity 0->1
    // entrance fade before scanning, or axe can misread its text-ink-mid subtitle mid-fade.
    const arrivalToast = page.getByTestId('travel-arrival-toast');
    await arrivalToast.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
    if (await arrivalToast.count()) {
      await expect(arrivalToast).toHaveCSS('opacity', '1');
    }

    await expectAxeClean(page, '/recap Wrapped story', testInfo);
  });
});
