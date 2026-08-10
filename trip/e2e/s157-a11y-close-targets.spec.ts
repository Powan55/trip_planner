import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * S157 — dialog close-X ≥44px touch targets (FU-22).
 *
 * Five sub-44px close-X buttons (`p-1`/`p-1.5` + a `w-4/w-5` icon = ~24-32px hit
 * area) grew a HIT-AREA-ONLY fix — `inline-flex items-center justify-center
 * min-h-[44px] min-w-[44px]` (the S110-FIX / tour-Skip idiom), the visible icon
 * size UNCHANGED (no visual drift):
 *   - add-to-itinerary-dialog.tsx  `add-item-cancel`
 *   - calendar-planner.tsx         `calendar-editor-cancel`
 *   - expense-dialog.tsx           `expense-cancel`
 *   - place-detail-sheet.tsx       `place-detail-close` (corner-anchored, absolute)
 *   - time-picker.tsx              `time-picker-close`
 *
 * ── Harness note: reaching the item editor at phone width via the REAL mobile path ──
 * The month CALENDAR GRID (`calendar-day-*`) is not the mobile day-picker: at `<lg`
 * (1024px) the desktop month-grid pane is `hidden lg:block` (present in the DOM but
 * `display:none`), and the mobile equivalent (`DayStrip` + a collapsible "Month
 * view") renders NO `calendar-day-*` cells until manually expanded. A real phone
 * user selects a day via the `DayStrip` chips (`day-strip-*`) and opens the full
 * editor via the shared "Add Activity" button (`calendar-add-item`, NOT gated by
 * the `lg` breakpoint) — so these specs do exactly that, navigating at PHONE width
 * (390×844 — below Tailwind's md/lg, the touch-target-relevant breakpoints) from
 * the start, the same path a real phone user takes.
 *
 * Each spec here asserts the close-X's rendered bounding box is >=44x44 CSS px at
 * phone width (via `assertHitArea44`'s `expect.poll`, which rides out the entrance
 * spring — see its doc comment), then axe-scans the open dialog's own subtree for
 * serious/critical=0.
 *
 * A sixth close-X was found during the sweep — the shared Radix `ui/dialog.tsx`
 * `DialogPrimitive.Close` (reachable only via the ⌘K command palette,
 * `command-palette.tsx`) was ALSO sub-44px, deliberately left unfixed pending a
 * visual baseline for the open palette (see the old comment this replaces).
 *
 * FU-39 (S173) closes that gap: `e2e/visual.spec.ts` now carries an open-palette
 * baseline (`command-palette-*.png`, added and verified BEFORE the fix), and the
 * same hit-area-only pattern (`inline-flex items-center justify-center
 * min-h-[44px] min-w-[44px]`, corner anchoring + icon size unchanged) is applied
 * in `ui/dialog.tsx` itself — the fix lands there, not in `command-palette.tsx`,
 * because that's where the close-X actually renders and it's the ONLY real
 * consumer of `ui/dialog.tsx`'s `DialogContent`/`DialogPrimitive.Close` in this
 * app (the other 5 dialogs render their own inline close buttons, confirmed
 * untouched by this change and still covered by the 5 cases above).
 */

const PHONE = { width: 390, height: 844 } as const;
const KNOWN_DAY = '2026-12-11'; // inside NEPAL_START..NEPAL_END, matches persistence.spec.ts
const BOUDHA_ID = 'na1'; // "Boudhanath Stupa" — matches interaction.spec.ts

/** Navigate to /plan at PHONE width and wait for the mobile day-strip to mount. */
async function gotoPlanPhoneSettled(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize(PHONE);
  await page.goto('/plan/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('day-strip').waitFor({ state: 'visible' });
}

/**
 * Assert the element's rendered bounding box is >=44x44 CSS px. Several of these
 * dialogs enter with a `scale: 0.9 -> 1` spring (framer-motion); `toBeVisible()`
 * resolves as soon as the element is painted (opacity/display), not once the
 * spring has settled, so a bare single `boundingBox()` read right after can catch
 * a genuine mid-animation frame (observed: a reproducible ~39.6px = 44 * 0.9,
 * exactly the initial scale). `expect.poll` re-reads the real box until it
 * settles (or genuinely fails if the true end state is under 44px).
 */
async function assertHitArea44(locator: ReturnType<Page['getByTestId']>) {
  await expect
    .poll(async () => {
      const box = await locator.boundingBox();
      return box ? Math.min(box.width, box.height) : 0;
    }, { message: 'hit-area >= 44x44px (settled)', timeout: 5_000 })
    .toBeGreaterThanOrEqual(44);
}

/**
 * Scan ONLY the given dialog's own subtree (`.include(testid)`) — scoped, not a
 * whole-page scan, so a pre-existing unrelated finding elsewhere on the host
 * page (e.g. the /plan budget panel's `dl`/icon structure) can't leak into a
 * dialog-specific assertion. Assert zero serious/critical.
 *
 * FU-38: `place-detail-sheet`'s meta `<dl>` used to carry a `only-dlitems`
 * finding (each `<dt>/<dd>` wrapping `<div>` also held a decorative icon
 * `<svg>` as a third sibling). Fixed by moving each icon INSIDE its `<dt>` —
 * the `<dl>` is now fully valid, so no exclusion is needed here any more.
 */
async function assertDialogAxeClean(
  page: Page,
  testId: string,
  label: string,
  excludeSelector?: string,
) {
  const builder = new AxeBuilder({ page }).include(`[data-testid="${testId}"]`);
  if (excludeSelector) builder.exclude(excludeSelector);
  const results = await builder.analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    blocking,
    `serious/critical a11y violations on ${label}: ${blocking
      .map((v) => `${v.id} [${v.impact}] x ${v.nodes.length}`)
      .join('; ')}`,
  ).toEqual([]);
}

test.describe('S157 FU-22 — dialog close-X >=44px touch targets + axe', () => {
  test('calendar item editor close-X (calendar-editor-cancel)', async ({ page }) => {
    await gotoPlanPhoneSettled(page);
    await page.getByTestId(`day-strip-${KNOWN_DAY}`).click();
    await page.getByTestId('calendar-add-item').click();
    await expect(page.getByTestId('calendar-editor')).toBeVisible();
    // Settle the entrance fade before the axe scan (same guard the time-picker test
    // below uses): axe samples COMPUTED colors, and the dialog's opacity 0→1 entrance
    // composites text to a lower-contrast blend mid-fade — a false serious hit. The
    // S323 de-glass exposed this (the former glass gradient bg made axe skip contrast).
    await expect(page.getByTestId('calendar-editor')).toHaveCSS('opacity', '1');

    const closeBtn = page.getByTestId('calendar-editor-cancel');
    await assertHitArea44(closeBtn);
    await assertDialogAxeClean(page, 'calendar-editor', 'calendar item editor');

    await closeBtn.click();
    await expect(page.getByTestId('calendar-editor')).toHaveCount(0);
  });

  test('add-to-itinerary (quick-add FAB) dialog close-X (add-item-cancel)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize(PHONE);
    // S357C: hosted on `/` (was `/plan/`) — the FAB is route-suppressed on the planner now
    // (it has the S357A sticky composer), and the FAB is the app's only `quickadd:open`
    // dispatcher, so Home is where this dialog is reachable. The scan below is a SCOPED
    // subtree scan of `add-item-dialog` itself, so the host route does not change what is
    // audited; the `toBeVisible()` below would fail loudly if the host were wrong.
    await page.goto('/', { waitUntil: 'load' });
    await page
      .waitForFunction(
        () => !('serviceWorker' in navigator) || navigator.serviceWorker.controller !== null,
        null,
        { timeout: 15_000 },
      )
      .catch(() => {});

    const fab = page.getByTestId('quick-add-fab');
    await expect(fab).toBeVisible();
    await fab.click();
    const dialog = page.getByTestId('add-item-dialog');
    await expect(dialog).toBeVisible();
    // Settle the entrance fade before the axe scan (see the time-picker guard below).
    await expect(dialog).toHaveCSS('opacity', '1');

    const closeBtn = page.getByTestId('add-item-cancel');
    await assertHitArea44(closeBtn);
    await assertDialogAxeClean(page, 'add-item-dialog', 'add-to-itinerary (custom) dialog');

    await closeBtn.click();
    await expect(dialog).toHaveCount(0);
  });

  test('expense log dialog close-X (expense-cancel)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize(PHONE);
    await page.goto('/plan/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('budget-panel')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('budget-grand-total-value')).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('budget-view-tab-expenses').click(); // S322: log trigger is on the Expenses view
    await page.getByTestId('expense-log-open').click();
    const dialog = page.getByTestId('expense-dialog');
    await expect(dialog).toBeVisible();
    // Settle the entrance fade before the axe scan (see the time-picker guard below).
    await expect(dialog).toHaveCSS('opacity', '1');

    const closeBtn = page.getByTestId('expense-cancel');
    await assertHitArea44(closeBtn);
    await assertDialogAxeClean(page, 'expense-dialog', 'expense log dialog');

    await closeBtn.click();
    await expect(dialog).toHaveCount(0);
  });

  test('place detail sheet close-X (place-detail-close, corner-anchored)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize(PHONE);
    await page.goto('/nepal/', { waitUntil: 'load' });
    await page
      .waitForFunction(
        () => !('serviceWorker' in navigator) || navigator.serviceWorker.controller !== null,
        null,
        { timeout: 15_000 },
      )
      .catch(() => {});
    await expect(page.getByTestId('guide-search-input')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(`guide-card-${BOUDHA_ID}`)).toBeAttached({ timeout: 20_000 });

    await page.getByTestId(`guide-card-${BOUDHA_ID}`).click();
    const sheet = page.getByTestId('place-detail-sheet');
    await expect(sheet).toBeVisible();

    const closeBtn = page.getByTestId('place-detail-close');
    await assertHitArea44(closeBtn);
    // FU-38: the dl/icon `only-dlitems` finding is fixed — no exclusion needed.
    await assertDialogAxeClean(page, 'place-detail-sheet', 'place detail sheet');

    await closeBtn.click();
    await expect(sheet).toHaveCount(0);
  });

  test('time picker close-X (time-picker-close)', async ({ page }) => {
    await gotoPlanPhoneSettled(page);
    await page.getByTestId(`day-strip-${KNOWN_DAY}`).click();
    await page.getByTestId('calendar-add-item').click();
    await expect(page.getByTestId('calendar-editor')).toBeVisible();
    await page.getByTestId('calendar-editor-time-input').click();
    const panel = page.getByTestId('time-picker-panel');
    await expect(panel).toBeVisible();
    // Same settle-before-scan fix as the picker's own axe spec (time-picker.spec.ts):
    // axe samples COMPUTED colors, and a gold option mid-opacity-fade composites to a
    // lower-contrast blend over the dark backdrop (a false serious color-contrast hit).
    await expect(panel).toHaveCSS('opacity', '1');

    const closeBtn = page.getByTestId('time-picker-close');
    await assertHitArea44(closeBtn);
    await assertDialogAxeClean(page, 'time-picker-panel', 'time picker panel');

    await closeBtn.click();
    await expect(panel).toHaveCount(0);
  });

  test('command palette close-X (shared ui/dialog.tsx DialogPrimitive.Close, FU-39)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize(PHONE);
    await page.goto('/', { waitUntil: 'load' });
    await page
      .waitForFunction(
        () => !('serviceWorker' in navigator) || navigator.serviceWorker.controller !== null,
        null,
        { timeout: 15_000 },
      )
      .catch(() => {});

    await page.keyboard.press('Control+k');
    const dialog = page.getByTestId('command-palette-dialog');
    await expect(dialog).toBeVisible();

    const closeBtn = dialog.getByRole('button', { name: 'Close' });
    await assertHitArea44(closeBtn);
    // FU-40 (S178): the selected-item ~2.97:1 contrast finding is FIXED at the token
    // level (--accent-foreground flipped dark in globals.css, ~6:1 on the sakura
    // accent), so the exclusion is removed and this scan is back at full strength.
    await assertDialogAxeClean(page, 'command-palette-dialog', 'command palette');

    await closeBtn.click();
    await expect(dialog).toHaveCount(0);
  });
});
