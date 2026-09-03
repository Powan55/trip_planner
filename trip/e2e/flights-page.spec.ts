import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * S325 — /flights honesty + on-page deep-links.
 *
 * Asserts the defect fixes made without rebuilding the cards (S326 owns the anatomy):
 *   - the dead "Japan — to be booked" panel is gone (its heading never renders) and the
 *     stale "not yet booked / still to come" copy is replaced with honest, fully-booked copy;
 *   - all four booked stays render (the former empty desktop half is now filled);
 *   - each journey carries a "Check live status" rail of EXTERNAL deep-links (D-169: links
 *     OUT, target=_blank + rel=noopener noreferrer) whose hrefs come from lib/flight-deep-links
 *     fed by lib/booking-data — the SAME source Travel Mode uses;
 *   - verbatim booking labels are rendered as-is (D-034: no parse/recompute).
 *
 * Signed-in (fixtures seed tripPlannerToken) so DefaultTripOnly renders the section.
 * `goto` rides through the one-off first-load SW reload (D-093: waitUntil 'load', not networkidle).
 */

async function goto(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'load' });
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

test.describe('S325 · /flights honest + deep-linked', () => {
  test.beforeEach(async ({ page }) => {
    await goto(page, '/flights/');
    // Wait for the ssr:false section island to mount (first journey heading).
    await expect(page.locator('#journey-outbound-heading')).toBeVisible({ timeout: 15_000 });
  });

  test('the dead JAPAN_TODO panel and stale copy are gone; all four stays render', async ({ page }) => {
    await expect(page.locator('#japan-todo-heading')).toHaveCount(0);
    await expect(page.getByText(/not yet booked/i)).toHaveCount(0);
    await expect(page.getByText(/still to come/i)).toHaveCount(0);
    // The default-trip empty state must NOT be showing (section really mounted).
    await expect(page.getByTestId('default-trip-only-empty-state')).toHaveCount(0);
    // Four booked stays.
    for (const id of ['nepal-hotel', 'osaka-hotel', 'kyoto-hotel', 'tokyo-hotel']) {
      await expect(page.locator(`#stay-${id}-heading`)).toBeVisible();
    }
  });

  test('each journey shows an external "Check live status" deep-link rail from booking-data', async ({ page }) => {
    await expect(page.getByText('Check live status').first()).toBeVisible();

    // FlightRadar24 tracker for the outbound first leg (Delta 5363) — exact href + external attrs.
    const tracker = page.getByTestId('flights-tracker-out-1');
    await expect(tracker).toHaveAttribute('href', 'https://www.flightradar24.com/data/flights/dl5363');
    await expect(tracker).toHaveAttribute('target', '_blank');
    await expect(tracker).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(tracker).toHaveAttribute('aria-label', 'Track Delta 5363 on FlightRadar24');

    // Rome2Rio + Google Flights for the outbound journey (Syracuse -> Kathmandu).
    const r2r = page.getByTestId('flights-rome2rio-outbound');
    await expect(r2r).toHaveAttribute('href', /^https:\/\/www\.rome2rio\.com\/s\/Syracuse/);
    await expect(r2r).toHaveAttribute('target', '_blank');
    await expect(r2r).toHaveAttribute('rel', 'noopener noreferrer');

    const gf = page.getByTestId('flights-gflights-outbound');
    await expect(gf).toHaveAttribute('href', /^https:\/\/www\.google\.com\/travel\/flights\?q=/);
    await expect(gf).toHaveAttribute('target', '_blank');
    await expect(gf).toHaveAttribute('rel', 'noopener noreferrer');
  });

  test('verbatim booking labels are rendered as-is (D-034)', async ({ page }) => {
    // The outbound first-leg depart label and the whole-journey total — both verbatim source strings.
    await expect(page.getByText('5:30am Wed Dec 9').first()).toBeVisible();
    await expect(page.getByText('1d 15m').first()).toBeVisible();
  });
});

/**
 * S326 — the Flighty-anatomy card rebuild (D-233). Phase strip + proximity countdown derive
 * from the trip-clock targeting the AUTHORED `Journey.departDate` (never a booking label);
 * labelled chips fill from optional leg fields with non-fabricated, non-reflowing empty slots;
 * layover rows carry the authored Relaxed/Normal/Tight verdict.
 */
test.describe('S326 · /flights Flighty-anatomy card', () => {
  test('phase strip + live proximity countdown render from departDate (real clock → upcoming)', async ({ page }) => {
    await goto(page, '/flights/');
    await expect(page.getByTestId('flight-card-outbound')).toBeVisible({ timeout: 15_000 });

    // Real clock (pre-trip) → every journey is upcoming with a live "Departs in …" countdown.
    await expect(page.getByTestId('flight-phase-outbound')).toContainText('Upcoming');
    await expect(page.getByTestId('flight-countdown-outbound')).toContainText('Departs in');

    // Big route uses the structured from/to codes (SYR → KTM), not a parsed label.
    const card = page.getByTestId('flight-card-outbound');
    await expect(card.getByText('SYR', { exact: true }).first()).toBeVisible();
    await expect(card.getByText('KTM', { exact: true }).first()).toBeVisible();
  });

  test('labelled chips: Gate/Confirmation are labelled-empty (non-fabricated)', async ({ page }) => {
    await goto(page, '/flights/');
    const card = page.getByTestId('flight-card-outbound');
    await expect(card).toBeVisible({ timeout: 15_000 });
    // Fixed slots always present.
    await expect(card.getByText('Gate', { exact: true }).first()).toBeVisible();
    await expect(card.getByText('Confirmation', { exact: true }).first()).toBeVisible();
    await expect(card.getByText('Not yet assigned').first()).toBeVisible();
  });

  test('layover rows carry the authored verdict (Tight at Delhi, Relaxed at JFK)', async ({ page }) => {
    await goto(page, '/flights/');
    const card = page.getByTestId('flight-card-outbound');
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByText('Tight', { exact: true })).toBeVisible();   // DEL 1h10m intl
    await expect(card.getByText('Relaxed', { exact: true })).toBeVisible(); // JFK 4h53m
  });

  test('?today=2026-12-09: outbound flips to Departing today while the other three still count down', async ({ page }) => {
    await goto(page, '/flights/?today=2026-12-09');
    await expect(page.getByTestId('flight-card-outbound')).toBeVisible({ timeout: 15_000 });

    // Outbound departDate === 2026-12-09 → departing.
    await expect(page.getByTestId('flight-phase-outbound')).toContainText('Departing today');

    // The other three are still upcoming under the SAME clock (shared-clock honesty, D-075).
    for (const id of ['return-to-japan', 'tokyo-to-osaka', 'flight-home']) {
      await expect(page.getByTestId(`flight-phase-${id}`)).toContainText('Upcoming');
      await expect(page.getByTestId(`flight-countdown-${id}`)).toContainText('Departs in');
    }
  });
});
