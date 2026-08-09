import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * S207 — currency converter ⌘K command (components/command-palette.tsx,
 * lib/currency-convert.ts). Runs against the served static `out/` build (D-093).
 * Frankfurter (`api.frankfurter.dev`) is STUBBED with `page.route(...)`, mirroring
 * travel-essentials.spec.ts's (S188) pattern — the live network is never touched.
 *
 * Proves, on a real run:
 *   1. Typing "100 usd to jpy" in the palette surfaces a "Currency Converter" result
 *      with a plausible converted number, sourced from the stubbed Frankfurter fixture.
 *   2. NPR (D-189, no Frankfurter coverage) renders the honest "unavailable" state when
 *      there is no prior cache — never a raw error, never a blank/hung result.
 *   3. A prior cached NPR rate (seeded directly into S188's cache key) is reused and
 *      shown, tagged as cached/stale — the offline-cache-hit path.
 *   4. No console errors; axe is serious/critical-clean with the result visible.
 */

// SW blocked - same D-190 frankfurter s-w-r stub-bypass race as travel-essentials.spec.ts (S213 triage).
test.use({ serviceWorkers: 'block' });

const FRANKFURTER_JPY_FIXTURE = { amount: 1, base: 'USD', date: '2026-07-15', rates: { JPY: 155.32 } };
const CURRENCY_CACHE_KEY = 'nepal_japan_currency_rate_cache';

async function stubFrankfurter(page: Page, fixture: unknown = FRANKFURTER_JPY_FIXTURE) {
  await page.route('**/api.frankfurter.dev/**', (route) => route.fulfill({ json: fixture }));
}

// Mirrors interaction.spec.ts's openPalette: absorbs the post-hydration listener race
// under the loaded single-worker harness (re-presses Ctrl+K until the dialog appears).
async function openPalette(page: Page) {
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(async () => {
    await page.keyboard.press('Control+k');
    await expect(palette).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15_000 });
}

test.describe('S207 · currency converter command', () => {
  test('typing "100 usd to jpy" shows a converted result from the live/stubbed rate', async ({ page }) => {
    await stubFrankfurter(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/', { waitUntil: 'load' });
    await openPalette(page);

    const input = page.getByPlaceholder('Jump to a section…');
    await input.pressSequentially('100 usd to jpy');

    const result = page.getByTestId('palette-currency-result');
    await expect(result).toBeVisible();
    await expect(result).toHaveAttribute('data-conversion-status', 'ok', { timeout: 10_000 });
    // 100 USD * 155.32 JPY/USD = 15,532 JPY.
    await expect(result).toContainText('15,532');
    await expect(result).toContainText('JPY');
  });

  test('S276: NPR with no prior cache resolves via the labeled reference rate (not a live quote), no crash', async ({ page }) => {
    // Frankfurter is stubbed defensively, but fetchCurrencyRate short-circuits NPR WITHOUT
    // ever calling it (D-189 gap). S276 superseded D-189's `unavailable` outcome: NPR with no
    // cache now resolves via a hand-set STATIC_REFERENCE_RATES entry (source:'reference'),
    // labeled "reference rate … not a live quote" — never presented as a live figure.
    await stubFrankfurter(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/', { waitUntil: 'load' });
    await openPalette(page);

    const input = page.getByPlaceholder('Jump to a section…');
    await input.pressSequentially('100 usd to npr');

    const result = page.getByTestId('palette-currency-result');
    await expect(result).toBeVisible();
    await expect(result).toHaveAttribute('data-conversion-status', 'ok', { timeout: 10_000 });
    await expect(result).toContainText('NPR');
    await expect(result).toContainText('reference rate');
  });

  test('a prior cached NPR rate is reused and shown as cached', async ({ page }) => {
    await stubFrankfurter(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/', { waitUntil: 'load' });
    await page.evaluate(
      ({ key }) => {
        window.localStorage.setItem(
          key,
          JSON.stringify({
            NPR: { currency: 'NPR', rate: 138.1, asOf: '2026-07-01', stale: false, fetchedAt: 'x' },
          }),
        );
      },
      { key: CURRENCY_CACHE_KEY },
    );
    await openPalette(page);

    const input = page.getByPlaceholder('Jump to a section…');
    await input.pressSequentially('10 usd to npr');

    const result = page.getByTestId('palette-currency-result');
    await expect(result).toBeVisible();
    await expect(result).toHaveAttribute('data-conversion-status', 'ok', { timeout: 10_000 });
    await expect(result).toContainText('1,381');
    await expect(result).toContainText('cached');
  });

  test('no console errors; axe is serious/critical-clean with the currency result visible', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));

    await stubFrankfurter(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/', { waitUntil: 'load' });
    await openPalette(page);

    const input = page.getByPlaceholder('Jump to a section…');
    await input.pressSequentially('100 usd to jpy');
    await expect(page.getByTestId('palette-currency-result')).toHaveAttribute('data-conversion-status', 'ok', {
      timeout: 10_000,
    });

    const results = await new AxeBuilder({ page }).exclude('canvas.maplibregl-canvas').analyze();
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(
      blocking,
      `serious/critical a11y violations on the palette (currency result visible): ${blocking
        .map((v) => `${v.id} [${v.impact}]`)
        .join('; ')}`,
    ).toEqual([]);

    expect(errors, `console/page errors: ${errors.join('\n')}`).toEqual([]);
  });
});
