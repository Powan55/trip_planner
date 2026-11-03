import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });
test.setTimeout(90_000);

const LONG_NAMES: Array<[string, string, string]> = [
  ['Tokyo Metropolitan Government', 'jp-metro-gov-decks', 'Tokyo Metropolitan Government Building Observation Decks'],
  ['Kyoto Station Building', 'jp-kyoto-station', 'Kyoto Station Building and Nidec Kyoto Tower'],
];

async function openPopup(page: Page, query: string, id: string) {
  await expect(async () => {
    await page.goto('/map/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('map-shell')).toBeVisible({ timeout: 10_000 });
  }).toPass({ timeout: 45_000 });
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 20_000 });
  const popup = page.locator('.njp-map-popup');
  await expect(async () => {
    const toggle = page.getByTestId('map-search-toggle');
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    await page.getByTestId('map-search-input').fill(query);
    await page.getByTestId(`map-search-result-${id}`).click();
    await expect(popup).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
  return popup;
}

for (const [query, id, name] of LONG_NAMES) {
  test(`popup for "${name}" keeps its action buttons inside the visible popup at 390px`, async ({ page }) => {
    const popup = await openPopup(page, query, id);
    const content = popup.locator('.maplibregl-popup-content');
    const actions = popup.getByTestId('map-popup-actions');
    await expect(actions).toBeVisible();
    const c = (await content.boundingBox())!;
    const a = (await actions.boundingBox())!;
    expect(a.y).toBeGreaterThanOrEqual(c.y - 1);
    expect(a.y + a.height).toBeLessThanOrEqual(c.y + c.height + 1);
    await expect(popup.getByTestId('map-popup-directions')).toBeInViewport();
  });
}

test('a tap 14px off a pin still opens its popup', async ({ page }) => {
  const popup = await openPopup(page, 'Kyoto Station Building', 'jp-kyoto-station');
  await page.keyboard.press('Escape');
  await expect(popup).toBeHidden();
  await page.waitForTimeout(1_000);
  const shell = (await page.getByTestId('map-shell').boundingBox())!;
  // focusMarker seats the pin 150px below the container centre (POPUP_VIEW_OFFSET)
  await expect(async () => {
    await page.mouse.click(shell.x + shell.width / 2 + 14, shell.y + shell.height / 2 + 150);
    await expect(popup).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
});
