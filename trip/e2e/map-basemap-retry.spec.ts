import { test, expect } from './fixtures';

// Both a 5xx and a network-level failure must show the map's own banner (not the offline
// hint) while the connection is up, and Retry must recover.
const tilejson = 'https://tiles.openfreemap.org/planet';

for (const [name, fail] of [
  ['503', (r: import('@playwright/test').Route) => r.fulfill({ status: 503, body: 'down' })],
  ['aborted', (r: import('@playwright/test').Route) => r.abort('failed')],
] as const) {
  test(`basemap ${name} on a live connection shows a banner; Retry clears it`, async ({ page }) => {
    await page.route(tilejson, fail);
    await page.goto('/map/', { waitUntil: 'domcontentloaded' });
    const banner = page.getByTestId('map-basemap-error');
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('map-offline-hint')).toHaveCount(0);

    await page.unroute(tilejson);
    await banner.getByRole('button', { name: 'Retry' }).click();
    await expect(banner).toBeHidden({ timeout: 20_000 });
  });
}
