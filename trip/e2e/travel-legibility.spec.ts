import { test, expect, assertConciergeWired } from './fixtures';
import type { ConsoleMessage } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * S189 — Travel Mode outdoor high-legibility toggle E2E pack (D-165 LOCKED).
 *
 * Runs against the served static `out/` build (D-093) on the DEFAULT (signed-in) identity, so
 * `/travel` is reachable with no gate. Mirrors the S184–S188 packs' seeding/mobile-viewport style.
 */

test.use({ viewport: { width: 390, height: 844 } });

async function goto(page: import('@playwright/test').Page, path = '/travel/') {
  await page.goto(path, { waitUntil: 'load' });
  await expect(page.getByTestId('travel-mode-root')).toBeVisible();
}

test.describe('S189 · toggling flips the presentation (token/attribute, not a screenshot)', () => {
  test('OFF by default: no attribute, base surface tokens', async ({ page }) => {
    await goto(page);
    const attr = await page.evaluate(() => document.documentElement.getAttribute('data-tm-legibility'));
    expect(attr).toBeNull();

    const toggle = page.getByTestId('travel-legibility-toggle');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  test('ON: stamps the attribute AND changes the computed surface color + font-size', async ({ page }) => {
    await goto(page);
    const before = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return { surface: cs.getPropertyValue('--surface').trim(), fontSize: cs.fontSize };
    });

    await page.getByTestId('travel-legibility-toggle').click();
    await expect(page.getByTestId('travel-legibility-toggle')).toHaveAttribute('aria-pressed', 'true');

    const after = await page.evaluate(() => ({
      attr: document.documentElement.getAttribute('data-tm-legibility'),
      surface: getComputedStyle(document.documentElement).getPropertyValue('--surface').trim(),
      fontSize: getComputedStyle(document.documentElement).fontSize,
    }));

    expect(after.attr).toBe('high');
    expect(after.surface).not.toBe(before.surface);
    expect(after.fontSize).not.toBe(before.fontSize);

    // The root font-size genuinely grew (112.5% bump).
    const beforePx = parseFloat(before.fontSize);
    const afterPx = parseFloat(after.fontSize);
    expect(afterPx).toBeGreaterThan(beforePx);
  });
});

test.describe('S189 · persists across reload / PWA relaunch', () => {
  test('ON survives a reload', async ({ page }) => {
    await goto(page);
    await page.getByTestId('travel-legibility-toggle').click();
    await expect(page.getByTestId('travel-legibility-toggle')).toHaveAttribute('aria-pressed', 'true');

    await page.reload({ waitUntil: 'load' });
    await expect(page.getByTestId('travel-mode-root')).toBeVisible();
    await expect(page.getByTestId('travel-legibility-toggle')).toHaveAttribute('aria-pressed', 'true');
    const attr = await page.evaluate(() => document.documentElement.getAttribute('data-tm-legibility'));
    expect(attr).toBe('high');
  });

  test('the persisted flag is the gateway key nepal_japan_travel_legibility, String(boolean)', async ({ page }) => {
    await goto(page);
    await page.getByTestId('travel-legibility-toggle').click();
    const stored = await page.evaluate(() => window.localStorage.getItem('nepal_japan_travel_legibility'));
    expect(stored).toBe('true');
  });
});

test.describe('S189 · the attribute NEVER leaks off /travel (the leak test)', () => {
  test('ON on /travel, then navigating Home: the attribute is absent everywhere else', async ({ page }) => {
    await goto(page);
    await page.getByTestId('travel-legibility-toggle').click();
    const onTravel = await page.evaluate(() => document.documentElement.getAttribute('data-tm-legibility'));
    expect(onTravel).toBe('high');

    await page.goto('/', { waitUntil: 'load' });
    const onHome = await page.evaluate(() => document.documentElement.getAttribute('data-tm-legibility'));
    expect(onHome).toBeNull();
  });

  test('a fresh direct load of / never carries the attribute, even with the flag persisted ON', async ({ page }) => {
    await goto(page);
    await page.getByTestId('travel-legibility-toggle').click();
    await expect(page.getByTestId('travel-legibility-toggle')).toHaveAttribute('aria-pressed', 'true');

    await page.goto('/nepal/', { waitUntil: 'load' });
    const attr = await page.evaluate(() => document.documentElement.getAttribute('data-tm-legibility'));
    expect(attr).toBeNull();
  });
});

test.describe('S189 · ≥44px hit target', () => {
  test('the toggle button meets the 44×44 minimum', async ({ page }) => {
    await goto(page);
    const box = await page.getByTestId('travel-legibility-toggle').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});

test.describe('Outdoor at 360px', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('the sync strip is not clipped, online or offline', async ({ page, context }) => {
    await goto(page);
    await page.getByTestId('travel-legibility-toggle').click();
    await expect(page.getByTestId('travel-legibility-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-tm-legibility', 'high');
    const strip = page.getByTestId('travel-sync-line');
    const clipped = () => strip.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(await clipped()).toBeLessThanOrEqual(0);

    await context.setOffline(true);
    await expect(strip).toHaveAttribute('data-online', 'false');
    await expect(strip.getByText('Cached')).toBeVisible();
    expect(await clipped()).toBeLessThanOrEqual(0);
  });

  test('the concierge trigger follows --tap and sits clear of the left two thirds', async ({ page }) => {
    await goto(page);
    await assertConciergeWired(page);
    const trigger = page.getByTestId('concierge-trigger');
    await page.getByTestId('travel-legibility-toggle').click();
    await expect(page.getByTestId('travel-legibility-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-tm-legibility', 'high');
    const box = (await trigger.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(52);
    expect(box.width).toBeGreaterThanOrEqual(52);
    expect(box.x).toBeGreaterThan(360 * (2 / 3));
  });
});

test.describe('S189 axe — /travel in BOTH states', () => {
  test('zero serious/critical violations OFF', async ({ page }, testInfo) => {
    await goto(page);
    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    for (const v of results.violations) {
      testInfo.annotations.push({ type: `axe:${v.impact ?? 'unknown'}`, description: `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length})` });
    }
    expect(blocking, blocking.map((v) => `${v.id} [${v.impact}]`).join('; ')).toEqual([]);
  });

  test('zero serious/critical violations ON', async ({ page }, testInfo) => {
    await goto(page);
    await page.getByTestId('travel-legibility-toggle').click();
    await expect(page.getByTestId('travel-legibility-toggle')).toHaveAttribute('aria-pressed', 'true');

    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    for (const v of results.violations) {
      testInfo.annotations.push({ type: `axe:${v.impact ?? 'unknown'}`, description: `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length})` });
    }
    expect(blocking, blocking.map((v) => `${v.id} [${v.impact}]`).join('; ')).toEqual([]);
  });
});

test.describe('S189 · no console errors toggling on and off', () => {
  test('a full toggle on -> off cycle runs with no console.error / pageerror', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(String(err)));

    await goto(page);
    const toggle = page.getByTestId('travel-legibility-toggle');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');

    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });
});
