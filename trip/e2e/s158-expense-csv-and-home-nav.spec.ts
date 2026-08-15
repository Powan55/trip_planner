import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * S158 E2E pack — two small additive wins on the served static `out/` build (D-093):
 *   (a) expense CSV export (`components/settings-panel.tsx` Data-management group, `lib/expense-csv.ts`)
 *   (b) the Home in-page sticky section nav (`components/home-section-nav.tsx`)
 *
 * Harness notes mirror the existing packs (`settings.spec.ts`, `interaction.spec.ts`,
 * `export-import.spec.ts`): sign in via `addInitScript` (every route walls an unidentified
 * visitor, D-241), ride through the one-off first-load SW reload before interacting, never
 * `networkidle` (D-093).
 */

async function settleSW(page: Page) {
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

/** Sign in as a traveler + optionally seed the expenses slot, then land on /settings. */
async function gotoSettings(page: Page, expenses?: unknown, token = 'Powan') {
  await page.addInitScript(
    ({ t, e }: { t: string; e: unknown }) => {
      window.localStorage.setItem('tripPlannerToken', t);
      window.localStorage.setItem('tripPlannerUserName', t);
      if (e !== undefined && window.localStorage.getItem('nepal_japan_expenses') === null) {
        window.localStorage.setItem('nepal_japan_expenses', JSON.stringify(e));
      }
    },
    { t: token, e: expenses },
  );
  await page.goto('/settings/', { waitUntil: 'load' });
  await settleSW(page);
  await expect(page.getByTestId('settings-panel')).toBeVisible({ timeout: 15_000 });
}

async function expandDataGroup(page: Page) {
  await page.getByTestId('settings-group-data-toggle').click();
}

async function gotoHome(page: Page) {
  await page.goto('/', { waitUntil: 'load' });
  await settleSW(page);
}

/** Wait for the sticky nav (a LazyVisible-deferred island, S158) to mount for real. */
async function expectNavVisible(page: Page) {
  await expect(page.getByTestId('home-section-nav')).toBeVisible({ timeout: 15_000 });
}

test.describe('S158a — expense CSV export', () => {
  test('the button is disabled when there are no expenses (empty-safe)', async ({ page }) => {
    await gotoSettings(page, []);
    await expandDataGroup(page);
    await expect(page.getByTestId('settings-export-expenses-csv')).toBeDisabled();
  });

  test('downloads a CSV with the expected rows, including escaped fields', async ({ page }) => {
    const expenses = [
      {
        id: 'e1',
        leg: 'nepal',
        category: 'food',
        amount: 500,
        date: '2026-12-10',
        note: 'Dal bhat, extra rice',
        createdAt: '2026-12-10T09:00:00.000Z',
      },
      {
        id: 'e2',
        leg: 'japan',
        category: 'transportation',
        amount: 1200,
        note: 'JR pass "unlimited"',
        paidBy: 'Powan',
        split: ['Powan', 'Alex'],
        createdAt: '2026-12-20T09:00:00.000Z',
      },
    ];
    await gotoSettings(page, expenses);
    await expandDataGroup(page);

    await expect(page.getByTestId('settings-export-expenses-csv')).toBeEnabled();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('settings-export-expenses-csv').click(),
    ]);

    expect(download.suggestedFilename()).toBe('nepal-japan-expenses.csv');
    const path = await download.path();
    expect(path).toBeTruthy();
    const fs = await import('node:fs/promises');
    const raw = await fs.readFile(path as string, 'utf-8');
    const lines = raw.split('\r\n').filter((l) => l.length > 0);

    expect(lines[0]).toBe('Date,Leg,Category,Currency,Amount,Note,Paid By,Split With');
    // Comma inside the note → quoted, no interior quotes to double.
    expect(lines[1]).toBe('2026-12-10,nepal,food,NPR,500,"Dal bhat, extra rice",,');
    // Quotes inside the note → quoted AND doubled; leg-derived currency is JPY for japan;
    // paidBy/split (S144) flatten to "Powan" / "Powan; Alex".
    expect(lines[2]).toBe(',japan,transportation,JPY,1200,"JR pass ""unlimited""",Powan,Powan; Alex');
    expect(lines).toHaveLength(3);
  });
});

test.describe('S158b — Home sticky section nav', () => {
  test('mounts, is keyboard-navigable (Tab between links, Enter activates), and jumps to the target section', async ({
    page,
  }) => {
    await gotoHome(page);
    await expectNavVisible(page);

    // Real anchors are natively focusable in their document order.
    await page.getByTestId('home-section-nav-hero').focus();
    await expect(page.getByTestId('home-section-nav-hero')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('home-section-nav-dashboard')).toBeFocused();

    // Wait for the Dashboard section to actually be mounted (it's its OWN LazyVisible island)
    // before jumping to it — a hash href against a not-yet-present id can't scroll anywhere.
    await expect(page.locator('#dashboard-heading')).toBeVisible({ timeout: 15_000 });

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#dashboard$/);
    await expect
      .poll(async () => page.locator('#dashboard').evaluate((el) => el.getBoundingClientRect().top))
      .toBeLessThan(200);
  });

  test('aria-current tracks the section nearest the viewport reading band as the page scrolls', async ({
    page,
  }) => {
    await gotoHome(page);
    await expectNavVisible(page);

    // At rest (top of page) the hero link is current.
    await expect(page.getByTestId('home-section-nav-hero')).toHaveAttribute('aria-current', 'true');

    // S321: the timeline moved off Home, so its nav anchor is gone — track the inspiration
    // gallery (`#inspiration`) instead, the last remaining below-the-fold nav target.
    await expect(page.locator('#inspiration-heading')).toBeVisible({ timeout: 15_000 });
    await page.locator('#inspiration').scrollIntoViewIfNeeded();

    await expect
      .poll(async () => page.getByTestId('home-section-nav-inspiration').getAttribute('aria-current'))
      .toBe('true');
    // Exactly one link is current at a time.
    await expect(page.getByTestId('home-section-nav-hero')).not.toHaveAttribute('aria-current', 'true');
    await expect(page.getByTestId('home-section-nav-dashboard')).not.toHaveAttribute('aria-current', 'true');
  });

  test('smooth-scroll is the active mechanism under normal motion, instant under reduced motion', async ({
    page,
  }) => {
    // Normal motion: the global html{scroll-behavior:smooth} rule (app/globals.css) is what
    // drives the real `<a href="#id">` anchor jump — this component ships no scroll JS of its own.
    await gotoHome(page);
    await expectNavVisible(page);
    expect(await page.locator('html').evaluate((el) => getComputedStyle(el).scrollBehavior)).toBe(
      'smooth',
    );

    // Reduced motion: the D-007/D-056 override neutralizes it to an instant jump.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await gotoHome(page);
    await expectNavVisible(page);
    await expect
      .poll(async () =>
        page.locator('html').evaluate((el) => getComputedStyle(el).scrollBehavior).catch(() => null),
      )
      .toBe('auto');

    // Functionally still jumps to the right section under reduced motion.
    await expect(page.locator('#inspiration-heading')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('home-section-nav-inspiration').click();
    await expect(page).toHaveURL(/#inspiration$/);
  });

  test('no layout overlap at mobile and desktop — the sticky strip never covers section content', async ({
    page,
  }) => {
    for (const viewport of [
      { width: 390, height: 844 }, // mobile
      { width: 1280, height: 800 }, // desktop
    ] as const) {
      await page.setViewportSize(viewport);
      await gotoHome(page);
      await expectNavVisible(page);
      await expect(page.locator('#dashboard-heading')).toBeVisible({ timeout: 15_000 });

      // Use the REAL click flow (not a raw scrollIntoViewIfNeeded on the whole, much-taller
      // `#dashboard` section, which can leave the far-shorter heading well outside the viewport)
      // so this exercises exactly the interaction a keyboard/mouse user takes.
      await page.getByTestId('home-section-nav-dashboard').click();
      // Give the (instant, since the nav's own click already triggered a same-document scroll)
      // sticky positioning a beat to settle post-scroll.
      await page.waitForTimeout(150);

      const navBox = await page.getByTestId('home-section-nav').boundingBox();
      const headingBox = await page.locator('#dashboard-heading').boundingBox();
      expect(navBox).toBeTruthy();
      expect(headingBox).toBeTruthy();
      // The heading's top must sit AT or BELOW the nav's bottom edge — no vertical overlap.
      expect(headingBox!.y).toBeGreaterThanOrEqual(navBox!.y + navBox!.height - 1);
      // The nav never overflows the viewport width (no horizontal scroll it introduces itself).
      expect(navBox!.width).toBeLessThanOrEqual(viewport.width);
    }
  });

  test('axe: zero serious/critical violations on Home with the nav mounted', async ({ page }, testInfo) => {
    await gotoHome(page);
    await expectNavVisible(page);
    await expect(page.locator('#dashboard-heading')).toBeVisible({ timeout: 15_000 });

    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    for (const v of results.violations) {
      const line = `[${v.impact ?? 'n/a'}] ${v.id}: ${v.help} (${v.nodes.length} node${v.nodes.length === 1 ? '' : 's'})`;
      testInfo.annotations.push({ type: `axe:${v.impact ?? 'unknown'}`, description: line });
      console.log(`  axe / (S158 nav) ${line}`);
    }
    expect(
      blocking,
      `serious/critical a11y violations on / with the sticky nav: ${blocking.map((v) => `${v.id} [${v.impact}]`).join('; ')}`,
    ).toEqual([]);
  });
});
