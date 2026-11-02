import { spawn } from 'node:child_process';
import { test, expect } from './fixtures';

/**
 * Real WebKit checks (#918), run only by the webkit-desktop / webkit-mobile projects
 * (PLAYWRIGHT_WEBKIT=1, see playwright.config.ts). Two things Safari does differently from
 * Chromium and that the rest of the pack never sees: localStorage persistence across a reload,
 * and service-worker cached navigation with the origin gone.
 */

const ITINERARY_KEY = 'nepal_japan_itinerary';
const OFFLINE_PORT = 4199;

test.describe('@webkit Safari engine', () => {
  test('itinerary create, edit, delete each survive a reload', async ({ page }) => {
    const title = `webkit crud ${Date.now()}`;
    const edited = `${title} edited`;
    const days = page.locator('[data-testid^="calendar-day-"]');
    const items = page.locator('[data-testid^="calendar-item-"]');

    // Attached, not visible: on phone widths the month grid is collapsed behind the day strip.
    const open = () => days.first().waitFor({ state: 'attached' });

    await page.goto('/plan/', { waitUntil: 'domcontentloaded' });
    await open();
    const add = page.getByTestId('calendar-add-item');
    await add.scrollIntoViewIfNeeded();
    await add.click();
    await expect(page.getByTestId('calendar-editor')).toBeVisible();
    await page.getByTestId('calendar-editor-title-input').pressSequentially(title, { delay: 10 });
    await page.getByTestId('calendar-editor-save').click();
    await expect(page.getByTestId('calendar-editor')).toHaveCount(0);
    await expect(items.filter({ hasText: title })).toHaveCount(1);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await open();
    const card = items.filter({ hasText: title });
    await expect(card).toHaveCount(1);
    const id = (await card.getAttribute('data-testid'))!.replace('calendar-item-', '');
    expect(await page.evaluate((k) => localStorage.getItem(k) !== null, ITINERARY_KEY)).toBe(true);

    const editBtn = page.getByTestId(`calendar-item-edit-${id}`);
    await editBtn.scrollIntoViewIfNeeded();
    await editBtn.click();
    await expect(page.getByTestId('calendar-editor')).toBeVisible();
    const input = page.getByTestId('calendar-editor-title-input');
    await input.selectText();
    await input.pressSequentially(edited, { delay: 10 });
    await page.getByTestId('calendar-editor-save').click();
    await expect(page.getByTestId('calendar-editor')).toHaveCount(0);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await open();
    await expect(page.getByTestId(`calendar-item-${id}`)).toContainText(edited);

    const delBtn = page.getByTestId(`calendar-item-delete-${id}`);
    await delBtn.scrollIntoViewIfNeeded();
    await delBtn.click();
    await expect(page.getByTestId(`calendar-item-${id}`)).toHaveCount(0);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await open();
    await expect(page.getByTestId(`calendar-item-${id}`)).toHaveCount(0);
  });

  // WebKit's setOffline and request routing both sit in front of the service worker, so
  // neither can show what Safari serves from cache. Instead the app runs from its own
  // throwaway server on a second origin, and that server is killed once the worker is warm.
  test('cached navigation and reload work once the origin is gone', async ({ page }) => {
    test.setTimeout(90_000);
    const origin = `http://127.0.0.1:${OFFLINE_PORT}`;
    const server = spawn(process.execPath, ['scripts/serve-out.mjs', '--port', String(OFFLINE_PORT)], {
      stdio: 'ignore',
    });
    const exited = new Promise((done) => server.once('exit', done));
    try {
      await expect
        .poll(() => fetch(origin).then((r) => r.ok, () => false), { timeout: 15_000 })
        .toBe(true);

      await page.goto(`${origin}/`, { waitUntil: 'load' });
      // Cutting the origin while the page is still fetching leaves the worker unable to answer.
      await expect(page.getByTestId('navbar')).toBeVisible();
      await page.waitForLoadState('networkidle');
      await page.waitForFunction(
        async () => {
          if (navigator.serviceWorker.controller?.state !== 'activated') return false;
          // Install precaches entries one by one: wait for the route and its JS chunks, then
          // for the entry count to stop moving, so the cut lands after install has finished.
          if (!(await caches.match('/plan/'))) return false;
          let n = 0;
          let chunks = false;
          for (const name of await caches.keys()) {
            const keys = await (await caches.open(name)).keys();
            n += keys.length;
            chunks ||= keys.some((k) => k.url.includes('/_next/static/'));
          }
          const w = window as unknown as { __n?: number };
          const settled = chunks && w.__n === n;
          w.__n = n;
          return settled;
        },
        null,
        { timeout: 30_000, polling: 1000 },
      );

      server.kill();
      await exited;
      await expect
        .poll(() => fetch(origin).then(() => true, () => false), { timeout: 10_000 })
        .toBe(false);

      // The worker, not the network, must answer now; poll until it does.
      await expect
        .poll(() => page.evaluate(() => fetch('/plan/').then((r) => r.status, () => 0)), { timeout: 15_000 })
        .toBe(200);
      const crash = page.getByRole('heading', { name: 'The app hit a problem', exact: true });
      const navbar = page.getByTestId('navbar');
      // Page-initiated, as a user's tap or pull-to-refresh would be: the driver's own goto skips the worker.
      await page.evaluate((to) => { location.href = to; }, '/plan/');
      await page.waitForURL('**/plan/');
      await expect(navbar.or(crash).first()).toBeVisible({ timeout: 20_000 });
      await expect(crash).toHaveCount(0);
      await expect(navbar).toBeVisible();

      await page.evaluate(() => location.reload());
      await expect(navbar.or(crash).first()).toBeVisible({ timeout: 20_000 });
      await expect(crash).toHaveCount(0);
      await expect(navbar).toBeVisible();
    } finally {
      server.kill();
      await exited;
    }
  });
});
