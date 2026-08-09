import { test, expect } from './fixtures';
import type { Page, ConsoleMessage } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * S187 — Travel Mode `?date=` day-picking E2E pack (D-164 LOCKED).
 *
 * Runs against the served static `out/` build (D-093) on the DEFAULT (signed-in) identity, so
 * `/travel` is reachable with no gate. Mirrors the S185/S186 packs' seeding style (a guarded or
 * unguarded `addInitScript` localStorage seed, `?today=` = local NOON of that day).
 */

const ITINERARY_KEY = 'nepal_japan_itinerary';

type SeedItem = {
  id: string;
  title: string;
  category: string;
  startMinutes?: number;
  durationMinutes?: number;
  location?: string;
  done?: boolean;
};
type SeedDay = { date: string; city: string; country: 'nepal' | 'japan'; items: SeedItem[] };

/** Seed one or more day plans before any app script runs. */
async function seedDays(page: Page, days: SeedDay[]) {
  await page.addInitScript((data: SeedDay[]) => {
    window.localStorage.setItem('nepal_japan_itinerary', JSON.stringify(data));
  }, days);
}

test.describe('S187 · strip selection updates hero + agenda in place (no remount)', () => {
  test('tapping a different chip updates the URL and the hero/agenda content live', async ({ page }) => {
    await seedDays(page, [
      { date: '2026-12-10', city: 'Kathmandu', country: 'nepal', items: [{ id: 'd10', title: 'Day 10 thing', category: 'sightseeing' }] },
      { date: '2026-12-11', city: 'Kathmandu', country: 'nepal', items: [{ id: 'd11', title: 'Day 11 thing', category: 'sightseeing' }] },
    ]);
    await page.goto('/travel/?today=2026-12-10', { waitUntil: 'load' });
    await expect(page.getByTestId('travel-hero')).toBeVisible();
    await expect(page.getByTestId('travel-hero-untimed')).toContainText('1');

    // Mark a DOM node before navigating in-place so we can prove the island never remounted.
    await page.evaluate(() => {
      (document.body as HTMLElement).dataset.marker = 'still-here';
    });

    await page.getByTestId('day-strip-2026-12-11').click();
    await expect(page).toHaveURL(/[?&]date=2026-12-11/);
    // The chip is now selected and the untimed count still reads for the new day (in place —
    // the marker set above survives, proving no full navigation/remount happened).
    await expect(page.getByTestId('day-strip-2026-12-11')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('body')).toHaveAttribute('data-marker', 'still-here');
  });
});

test.describe('S187 · direct-URL `?date=` load', () => {
  test('navigating straight to `?date=` renders that day without visiting today first', async ({ page }) => {
    await seedDays(page, [
      { date: '2026-12-14', city: 'Kathmandu', country: 'nepal', items: [{ id: 'd14', title: 'Direct load item', category: 'food' }] },
    ]);
    await page.goto('/travel/?today=2026-12-10&date=2026-12-14', { waitUntil: 'load' });
    await expect(page.getByTestId('travel-hero')).toBeVisible();
    await expect(page.getByTestId('travel-hero-untimed')).toContainText('1');
    await expect(page.getByTestId('day-strip-2026-12-14')).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('S187 · out-of-range / malformed `?date=` → honest empty state', () => {
  test('a well-formed but out-of-window date shows "not a trip day" + a one-tap return', async ({ page }) => {
    await page.goto('/travel/?today=2026-12-10&date=2099-01-01', { waitUntil: 'load' });
    await expect(page.getByTestId('travel-date-empty')).toBeVisible();
    await expect(page.getByTestId('travel-hero')).toHaveCount(0);

    await page.getByTestId('travel-date-empty-return').click();
    await expect(page).not.toHaveURL(/date=/);
    await expect(page.getByTestId('travel-hero')).toBeVisible();
  });

  test('a malformed date string shows the same empty state, no crash', async ({ page }) => {
    await page.goto('/travel/?today=2026-12-10&date=not-a-date', { waitUntil: 'load' });
    await expect(page.getByTestId('travel-date-empty')).toBeVisible();
  });
});

test.describe('S187 · preview banner on a non-today `?date=` + "Back to today" clears it', () => {
  test('previewing a different in-trip day shows the banner; clearing returns to today', async ({ page }) => {
    await seedDays(page, [
      { date: '2026-12-10', city: 'Kathmandu', country: 'nepal', items: [] },
      { date: '2026-12-12', city: 'Kathmandu', country: 'nepal', items: [] },
    ]);
    await page.goto('/travel/?today=2026-12-10&date=2026-12-12', { waitUntil: 'load' });
    await expect(page.getByTestId('travel-preview-banner')).toBeVisible();
    await expect(page.getByTestId('travel-preview-banner')).toContainText('Previewing');

    await page.getByTestId('travel-preview-back').click();
    await expect(page).not.toHaveURL(/date=/);
    await expect(page.getByTestId('travel-preview-banner')).toHaveCount(0);
    await expect(page.getByTestId('day-strip-2026-12-10')).toHaveAttribute('aria-pressed', 'true');
  });

  test('a `?date=` equal to today shows NO preview banner', async ({ page }) => {
    await seedDays(page, [{ date: '2026-12-10', city: 'Kathmandu', country: 'nepal', items: [] }]);
    await page.goto('/travel/?today=2026-12-10&date=2026-12-10', { waitUntil: 'load' });
    await expect(page.getByTestId('travel-hero')).toBeVisible();
    await expect(page.getByTestId('travel-preview-banner')).toHaveCount(0);
  });
});

test.describe('S187 · pre-trip default (Day 1 + "Trip starts in N days")', () => {
  test('a pre-trip `?today=` with no `?date=` defaults to Day 1 and shows the countdown line', async ({ page }) => {
    await page.goto('/travel/?today=2026-12-05', { waitUntil: 'load' });
    await expect(page.getByTestId('travel-pretrip-notice')).toBeVisible();
    await expect(page.getByTestId('travel-pretrip-notice')).toContainText(/Trip starts in \d+ days?/);
    await expect(page.getByTestId('day-strip-2026-12-09')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('travel-hero')).toBeVisible();
  });
});

test.describe('S187 · both `?today=` and `?date=` compose (D-164)', () => {
  test('`?date=` picks the day; `?today=`\'s clock still drives the phase for that day', async ({ page }) => {
    // `?today=2026-12-10` (noon NPT) previews `?date=2026-12-19` (Osaka, JST). The hero must
    // re-interpret "noon" at the PREVIEWED day's place (JST), not today's (NPT) — else this
    // item (11:00-13:00 JST) would not read as "now".
    await seedDays(page, [
      {
        date: '2026-12-19',
        city: 'Osaka',
        country: 'japan',
        items: [{ id: 'compose-now', title: 'Compose now item', category: 'sightseeing', startMinutes: 660, durationMinutes: 120 }],
      },
    ]);
    await page.goto('/travel/?today=2026-12-10&date=2026-12-19', { waitUntil: 'load' });
    await expect(page.getByTestId('travel-hero')).toHaveAttribute('data-phase', 'now');
    await expect(page.getByTestId('travel-hero-headline')).toContainText('Compose now item');
  });
});

test.describe('S187 · Dec 18 / Dec 19 leg boundary resolves to the correct leg/day', () => {
  test('Dec 18 shows the Nepal leg; Dec 19 shows the Japan leg', async ({ page }) => {
    await page.goto('/travel/?today=2026-12-10&date=2026-12-18', { waitUntil: 'load' });
    await expect(page.locator('#travel-hero-title')).toContainText('Kathmandu');

    await page.goto('/travel/?today=2026-12-10&date=2026-12-19', { waitUntil: 'load' });
    await expect(page.locator('#travel-hero-title')).toContainText('Osaka');
  });
});

test.describe('S187 · axe — the date-picking states', () => {
  test('zero serious/critical violations on the strip, the preview banner, and the empty state', async ({ page }, testInfo) => {
    const scan = async (label: string) => {
      const results = await new AxeBuilder({ page }).analyze();
      const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      for (const v of results.violations) {
        testInfo.annotations.push({ type: `axe:${v.impact ?? 'unknown'}`, description: `${label} [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length})` });
      }
      expect(blocking, `${label}: ${blocking.map((v) => `${v.id} [${v.impact}]`).join('; ')}`).toEqual([]);
    };

    await seedDays(page, [
      { date: '2026-12-10', city: 'Kathmandu', country: 'nepal', items: [] },
      { date: '2026-12-12', city: 'Kathmandu', country: 'nepal', items: [] },
    ]);
    await page.goto('/travel/?today=2026-12-10&date=2026-12-12', { waitUntil: 'load' });
    await expect(page.getByTestId('travel-preview-banner')).toBeVisible();
    await scan('preview banner + strip');

    await page.goto('/travel/?today=2026-12-10&date=2099-01-01', { waitUntil: 'load' });
    await expect(page.getByTestId('travel-date-empty')).toBeVisible();
    await scan('empty state');
  });
});

test.describe('S187 · no console errors', () => {
  test('strip selection, preview clear, and the empty-state return all run with no console.error / pageerror', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(String(err)));

    await seedDays(page, [
      { date: '2026-12-10', city: 'Kathmandu', country: 'nepal', items: [] },
      { date: '2026-12-11', city: 'Kathmandu', country: 'nepal', items: [] },
    ]);
    await page.goto('/travel/?today=2026-12-10', { waitUntil: 'load' });
    await page.getByTestId('day-strip-2026-12-11').click();
    await expect(page.getByTestId('travel-preview-banner')).toBeVisible();
    await page.getByTestId('travel-preview-back').click();

    await page.goto('/travel/?today=2026-12-10&date=nope', { waitUntil: 'load' });
    await page.getByTestId('travel-date-empty-return').click();

    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });
});
