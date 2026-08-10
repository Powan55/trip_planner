import { test, expect } from './fixtures';
import type { Page, ConsoleMessage } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * S185 → S317 — Travel Mode Now/Next STRIP E2E pack (D-016 / D-131 / D-007).
 *
 * S317 made `/travel` checklist-first: the day's plan list is the primary surface and the hero
 * shrank from the full expand/progress/recalc/flip card to a ONE-LINE now/next strip. The detail
 * that card used to carry now lives in the agenda rows below (per-row now/upcoming/done phase +
 * times, covered by travel-agenda.spec.ts). So this pack now proves the STRIP: the derived phase,
 * the now/next headline + "then" line, the shrink (the old interactive affordances are gone), the
 * empty state, the static reduced-motion branch, a11y, and console-cleanliness.
 *
 * Runs against the served static `out/` build (D-093) on the DEFAULT (signed-in) identity, so
 * `/travel` is reachable with no gate. The clock is driven by the D-075 `?today=` override (local
 * NOON of the day) exactly like the S186 agenda pack. `2026-12-10` is a Nepal day (NPT +5:45);
 * under `?today=2026-12-10` "now" is 12:00 NPT.
 */

const ITINERARY_KEY = 'nepal_japan_itinerary';
const DAY = '2026-12-10';

type SeedItem = {
  id: string;
  title: string;
  category: string;
  startMinutes?: number;
  durationMinutes?: number;
  notes?: string;
  location?: string;
  done?: boolean;
};

/** Register a localStorage itinerary seed for DAY before any app script runs. */
async function seedDay(page: Page, items: SeedItem[]) {
  await page.addInitScript(
    ({ key, day, items }) => {
      window.localStorage.setItem(
        key,
        JSON.stringify([{ date: day, city: 'Kathmandu', country: 'nepal', items }]),
      );
    },
    { key: ITINERARY_KEY, day: DAY, items },
  );
}

/** Navigate to /travel under the noon `?today=` clock and wait for the hydrated strip. */
async function gotoCard(page: Page, opts: { reduced?: boolean } = {}) {
  if (opts.reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/travel/?today=${DAY}`, { waitUntil: 'load' });
  await expect(page.getByTestId('travel-hero')).toBeVisible();
}

// A current (in-progress at noon) item plus a later "then" item.
const NOW_FIXTURE: SeedItem[] = [
  {
    id: 'now-item',
    title: 'Boudhanath sunrise walk',
    category: 'photography',
    startMinutes: 660, // 11:00
    durationMinutes: 120, // → 13:00, in progress at noon
    notes: 'Bring a wide lens and warm layers.',
    location: 'Boudhanath Stupa',
  },
  { id: 'then-item', title: 'Thamel lunch', category: 'food', startMinutes: 900 }, // 15:00
];

test.describe('S317 · the strip shows the now item + the "then" line (now phase)', () => {
  test('data-phase=now, headline is the current item, "then" names what follows', async ({ page }) => {
    await seedDay(page, NOW_FIXTURE);
    await gotoCard(page);

    await expect(page.getByTestId('travel-hero')).toHaveAttribute('data-phase', 'now');
    await expect(page.getByTestId('travel-hero-headline')).toContainText('Boudhanath sunrise walk');
    await expect(page.getByTestId('travel-hero-then')).toContainText('Thamel lunch');

    // The shrink (S317): the old full-hero affordances are gone — no expand toggle, no progress
    // bar, no recalculate button on the strip.
    await expect(page.getByTestId('travel-hero-expand')).toHaveCount(0);
    await expect(page.getByTestId('travel-hero-progress')).toHaveCount(0);
    await expect(page.getByTestId('travel-hero-recalc')).toHaveCount(0);
  });
});

test.describe('S317 · upcoming phase — the headline is the NEXT item', () => {
  test('an all-ahead schedule reads as upcoming with the next item as the headline', async ({ page }) => {
    // Only a 15:00 item — at noon nothing is in progress, so the next-up is the headline.
    await seedDay(page, [
      { id: 'later', title: 'Patan evening walk', category: 'sightseeing', startMinutes: 900 },
    ]);
    await gotoCard(page);

    await expect(page.getByTestId('travel-hero')).toHaveAttribute('data-phase', 'upcoming');
    await expect(page.getByTestId('travel-hero-headline')).toContainText('Patan evening walk');
    // No "then" line in the upcoming phase (there is no current activity to follow).
    await expect(page.getByTestId('travel-hero-then')).toHaveCount(0);
  });
});

test.describe('S317 · empty day — the strip shows the honest empty state', () => {
  test('a zero-item in-trip day renders the empty strip, not a headline', async ({ page }) => {
    await seedDay(page, []);
    await gotoCard(page);

    await expect(page.getByTestId('travel-hero-empty')).toBeVisible();
    await expect(page.getByTestId('travel-hero-headline')).toHaveCount(0);
  });
});

test.describe('S317 · reduced motion — the strip is a static (non-animated) container (D-007)', () => {
  test('the strip renders the non-animated branch and the headline is fully opaque at rest', async ({
    page,
  }) => {
    await seedDay(page, NOW_FIXTURE);
    await gotoCard(page, { reduced: true });

    // The strip is static by construction (no framer flip) — the marker is permanently false.
    const flip = page.getByTestId('travel-hero-flip');
    await expect(flip).toHaveAttribute('data-flip-animated', 'false');

    const opacity = await page
      .getByTestId('travel-hero-headline')
      .evaluate((el) => getComputedStyle(el).opacity);
    expect(Number(opacity)).toBe(1);
  });
});

test.describe('S317 · axe — /travel with the strip', () => {
  test('zero serious/critical violations', async ({ page }, testInfo) => {
    await seedDay(page, NOW_FIXTURE);
    await gotoCard(page);
    await expect(page.getByTestId('travel-hero')).toHaveAttribute('data-phase', 'now');

    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    for (const v of results.violations) {
      testInfo.annotations.push({
        type: `axe:${v.impact ?? 'unknown'}`,
        description: `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length})`,
      });
    }
    expect(
      blocking,
      `serious/critical: ${blocking.map((v) => `${v.id} [${v.impact}]`).join('; ')}`,
    ).toEqual([]);
  });
});

test.describe('S317 · no console errors', () => {
  test('the strip loads with no console.error / pageerror', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(String(err)));

    await seedDay(page, NOW_FIXTURE);
    await gotoCard(page);
    await expect(page.getByTestId('travel-hero-headline')).toContainText('Boudhanath sunrise walk');

    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });
});
