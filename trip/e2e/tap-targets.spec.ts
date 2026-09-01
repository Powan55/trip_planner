import { test, expect } from './fixtures';
import type { Locator, Page } from '@playwright/test';

/**
 * Tap-target floor outside `/travel`.
 *
 * `tm-acceptance.spec.ts` (TM-10) already pins the 44px floor, but only for `/travel`'s own
 * controls — every other route's hit areas were unmeasured, and axe has no target-size rule
 * enabled, so a shrunk control anywhere else regresses silently. This pack covers the rest:
 * the four search "clear" buttons (`/plan` + the three `/nepal` guide sections), the navbar
 * sign-out, the mobile tab bar, and `/map`'s MapLibre control group + popup favourite heart.
 *
 * Same assertion shape and floor as TM-10 (a rendered `boundingBox()` ≥ 44×44 CSS px, a null
 * box failing loudly so a deleted control cannot pass vacuously). 44 is the base `--tap`;
 * outdoor mode raises it to 52, so ≥44 holds in both.
 *
 * Widths are deliberate, not incidental: the traveler chip that carries the sign-out is
 * `hidden md:flex` and the tab bar is `md:hidden`, so each is measured at the width where it
 * actually renders.
 */

const PHONE = { width: 390, height: 844 } as const;
const DESKTOP = { width: 1280, height: 900 } as const;
const TAP = 44;

const BOUDHA_ID = 'np-boudhanath'; // Cultural category, Nepal — matches map-favorites-offline.spec.ts

/** Assert a control's rendered box clears the tap floor (TM-10's shape). */
async function expectTapFloor(locator: Locator, label: string) {
  const box = await locator.boundingBox();
  expect(box, `${label} has a layout box`).not.toBeNull();
  expect(box!.width, `${label} width ≥ ${TAP}`).toBeGreaterThanOrEqual(TAP);
  expect(box!.height, `${label} height ≥ ${TAP}`).toBeGreaterThanOrEqual(TAP);
}

/**
 * Every search field in this app renders its clear button as the input's next sibling
 * (icon → input → conditional button), and the button only exists once the query is
 * non-empty — so type first, then read the sibling.
 */
async function clearButtonAfterTyping(input: Locator): Promise<Locator> {
  await input.fill('a');
  const clear = input.locator('xpath=following-sibling::button[1]');
  await expect(clear).toBeVisible();
  return clear;
}

async function goto(page: Page, path: string, viewport: { width: number; height: number }) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize(viewport);
  await page.goto(path, { waitUntil: 'domcontentloaded' });
}

test.describe('tap targets ≥44×44 outside /travel', () => {
  test('the three /nepal guide search clear buttons', async ({ page }) => {
    await goto(page, '/nepal/', PHONE);

    const cases: Array<[string, Locator]> = [
      ['guide search clear', page.getByTestId('guide-search-input')],
      ['nightlife search clear', page.getByLabel('Search nightlife venues')],
      ['photography search clear', page.getByLabel('Search photography guide')],
    ];
    for (const [label, input] of cases) {
      await expect(input).toBeVisible({ timeout: 20_000 });
      await expectTapFloor(await clearButtonAfterTyping(input), label);
    }
  });

  test('/plan search clear button', async ({ page }) => {
    await goto(page, '/plan/', PHONE);
    const input = page.getByTestId('plan-search-input');
    await expect(input).toBeVisible({ timeout: 20_000 });
    await input.fill('a');
    await expectTapFloor(page.getByTestId('plan-search-clear'), 'plan-search-clear');
  });

  test('every mobile tab-bar item', async ({ page }) => {
    await goto(page, '/', PHONE);
    const tabs = page.locator('[data-testid^="tab-bar-"]');
    await expect(tabs.first()).toBeVisible({ timeout: 20_000 });
    const count = await tabs.count();
    expect(count, 'the tab bar renders its items').toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const id = await tabs.nth(i).getAttribute('data-testid');
      await expectTapFloor(tabs.nth(i), id ?? `tab ${i}`);
    }
  });

  test('navbar sign-out (traveler chip, desktop-only)', async ({ page }) => {
    await goto(page, '/', DESKTOP);
    const signOut = page.getByTestId('navbar-sign-out');
    await expect(signOut).toBeVisible({ timeout: 20_000 });
    await expectTapFloor(signOut, 'navbar-sign-out');
  });

  test('/map MapLibre control group + popup favourite heart', async ({ page }) => {
    await goto(page, '/map/', DESKTOP);
    await expect(page.getByTestId('map-shell')).toBeVisible();
    // The GL canvas gates both the controls and the search-to-popup path (maplibre-gl is a
    // lazy chunk — D-047), so block on it rather than on the controls themselves.
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 20_000 });

    const ctrls = page.locator('.maplibregl-ctrl-group button');
    const count = await ctrls.count();
    expect(count, 'zoom in/out + geolocate render').toBeGreaterThanOrEqual(3);
    for (let i = 0; i < count; i++) {
      await expectTapFloor(ctrls.nth(i), `maplibregl control ${i}`);
    }

    // Search-to-select is the deterministic way to open a specific marker's popup regardless
    // of the active filter (map-favorites-offline.spec.ts's idiom), retried because the camera
    // flyTo/popup-open is timing-sensitive on a cold GL canvas.
    const popup = page.locator('.njp-map-popup');
    await expect(async () => {
      const toggle = page.getByTestId('map-search-toggle');
      if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
        await toggle.click();
      }
      await page.getByTestId('map-search-input').fill('Boudhanath');
      await page.getByTestId(`map-search-result-${BOUDHA_ID}`).click();
      await expect(popup).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 20_000 });

    await expectTapFloor(
      popup.getByTestId(`map-popup-favorite-${BOUDHA_ID}`),
      `map-popup-favorite-${BOUDHA_ID}`,
    );
  });
});
