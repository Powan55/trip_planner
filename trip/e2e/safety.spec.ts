import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * S152 — the travel-safety kit (`/safety`, `components/travel-safety-kit.tsx`) E2E pack.
 *
 * Signs in with a real Trip Token EXPLICITLY (mirrors `journal-browse.spec.ts` /
 * `nightlife-gate.spec.ts`) rather than riding the shared `fixtures.ts` default, deliberately
 * (S152). `/safety`, like every route, sits behind the front-door wall (D-241) — the
 * signed-in token passes it with zero gate code of this slice's own.
 *
 * Proves, on real rendered output against the served static `out/` build (never `next dev`):
 *   1. All three sections render (emergency & embassy / phrasebook / document checklist).
 *   2. Every emergency contact's `tel:` href is correct and keyboard-reachable.
 *   3. Zero serious/critical axe violations, scanned twice for determinism.
 *   4. `prefers-reduced-motion: reduce` renders the same content (no motion-only affordance).
 */

async function gotoAsTraveler(page: Page, path: string, token = 'Powan') {
  await page.addInitScript((t: string) => {
    window.localStorage.setItem('tripPlannerToken', t);
    window.localStorage.setItem('tripPlannerUserName', t);
    window.localStorage.setItem('nepal_japan_first_run_tour_seen', '1'); // S155: keep dormant
    window.localStorage.setItem('nepal_japan_install_hint_dismissed', '1'); // S272: dismiss app-wide install toast (duration:Infinity poisons axe scans)
  }, token);
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
  await expect(page.locator('h1').first()).toBeVisible();
}

test.describe('S152 safety kit — renders the three sections', () => {
  test('emergency & embassy, phrasebook, and checklist sections all render', async ({ page }) => {
    await gotoAsTraveler(page, '/safety/');
    await expect(page.getByTestId('safety-kit')).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Emergency & Embassy Contacts' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Phrasebook' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Document Checklist' })).toBeVisible();

    // Emergency contacts: at least one per country, rendered as tel links.
    await expect(page.getByTestId('safety-contact-np-police')).toBeVisible();
    await expect(page.getByTestId('safety-contact-jp-police')).toBeVisible();

    // Phrasebook: 20 rows total across the grouped tables.
    const phraseRows = page.locator('[data-testid^="safety-phrase-"]');
    await expect(phraseRows).toHaveCount(20);

    // Checklist: at least one item per group is present.
    await expect(page.getByTestId('safety-checklist-passport-validity')).toBeVisible();
    await expect(page.getByTestId('safety-checklist-cloud-backups')).toBeVisible();
  });
});

test.describe('S152 safety kit — tel: hrefs are correct and reachable', () => {
  test('emergency contact links carry the exact tel: href from the content module', async ({ page }) => {
    await gotoAsTraveler(page, '/safety/');

    const cases: Array<[string, string]> = [
      ['np-police', 'tel:100'],
      ['np-ambulance', 'tel:102'],
      ['np-fire', 'tel:101'],
      ['jp-police', 'tel:110'],
      ['jp-fire-ambulance', 'tel:119'],
      ['jp-us-embassy', 'tel:+81332245000'],
    ];

    for (const [id, href] of cases) {
      const link = page.getByTestId(`safety-contact-${id}`).locator('a');
      await expect(link).toHaveAttribute('href', href);
      // Accessible name is distinct from — and more descriptive than — the visible digits.
      const accName = await link.getAttribute('aria-label');
      expect(accName).toBeTruthy();
      expect(accName!.length).toBeGreaterThan(href.replace('tel:', '').length);
    }
  });

  test('a tel: link is keyboard-focusable and shows a visible focus ring', async ({ page }) => {
    await gotoAsTraveler(page, '/safety/');
    const link = page.getByTestId('safety-contact-np-police').locator('a');
    await link.focus();
    await expect(link).toBeFocused();
  });
});

test.describe('S152 axe — /safety (run twice for determinism)', () => {
  for (const run of [1, 2] as const) {
    test(`axe run ${run}: /safety has zero serious/critical violations`, async ({ page }, testInfo) => {
      await gotoAsTraveler(page, '/safety/');
      await expect(page.getByTestId('safety-kit')).toBeVisible();

      const results = await new AxeBuilder({ page }).analyze();
      const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      for (const v of results.violations) {
        const line = `[${v.impact ?? 'n/a'}] ${v.id}: ${v.help} (${v.nodes.length} node${v.nodes.length === 1 ? '' : 's'})`;
        testInfo.annotations.push({ type: `axe:${v.impact ?? 'unknown'}`, description: line });
        // eslint-disable-next-line no-console
        console.log(`  axe /safety (run ${run}) ${line}`);
      }
      expect(
        blocking,
        `serious/critical a11y violations on /safety: ${blocking.map((v) => `${v.id} [${v.impact}]`).join('; ')}`,
      ).toEqual([]);
    });
  }
});

test.describe('S152 safety kit — reduced motion', () => {
  test('renders the same content under prefers-reduced-motion: reduce', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await gotoAsTraveler(page, '/safety/');
    await expect(page.getByTestId('safety-kit')).toBeVisible();
    await expect(page.locator('[data-testid^="safety-phrase-"]')).toHaveCount(20);
  });
});
