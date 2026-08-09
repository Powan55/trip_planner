import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * S215 — pointer-driven 3D tilt on the `RecommendationCard` family (`components/
 * recommendation-section.tsx`, `hooks/use-card-tilt.ts`). Guides-scoped, desktop project.
 *
 * Proves, on a real run:
 *  1. A pointer move over a card mutates its `m.div` transform (tilt applied) — `data-tilt-enabled`
 *     is `"true"` and the computed transform changes vs its resting value.
 *  2. Under emulated `prefers-reduced-motion: reduce` (D-007/D-056b) the tilt is HARD-disabled:
 *     `data-tilt-enabled="false"` and the transform does NOT change on pointer move.
 *  3. Axe on `/nepal` after the change has zero serious/critical violations.
 *
 * Harness mirrors e2e/favorites.spec.ts (the existing `/nepal` guide pack): `waitUntil:'load'`
 * (never networkidle, D-093) + ride-through of the first-load SW `controllerchange` reload (D-073),
 * then wait for a real `guide-*` testid before interacting. `na1` (Boudhanath Stupa) is a stable
 * Nepal id reused from that pack.
 */

const BOUDHA_ID = 'na1';

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

async function waitForGuide(page: Page) {
  await expect(page.getByTestId('guide-search-input')).toBeVisible();
  await expect(page.getByTestId(`guide-tilt-${BOUDHA_ID}`)).toBeAttached();
}

test.describe('S215 · card tilt (desktop pointer)', () => {
  test('pointer move over a card applies a 3D tilt transform', async ({ page }) => {
    await goto(page, '/nepal/');
    await waitForGuide(page);

    const card = page.getByTestId(`guide-tilt-${BOUDHA_ID}`);
    await expect(card).toHaveAttribute('data-tilt-enabled', 'true');
    await card.scrollIntoViewIfNeeded();

    // Let the whileInView entrance settle, then capture the resting transform.
    await page.waitForTimeout(500);
    const resting = await card.evaluate((el) => getComputedStyle(el).transform);

    // Move the pointer to an off-centre point inside the card → non-zero tilt target.
    const box = await card.boundingBox();
    if (!box) throw new Error('card has no bounding box');
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.15, { steps: 4 });

    // The spring animates toward the tilted transform — poll until it differs from rest.
    await expect
      .poll(async () => card.evaluate((el) => getComputedStyle(el).transform), { timeout: 4000 })
      .not.toBe(resting);

    // And it is a real 3D transform (matrix3d), not just a translate.
    const tilted = await card.evaluate((el) => getComputedStyle(el).transform);
    expect(tilted).toContain('matrix3d');
  });

  test('reduced motion HARD-disables the tilt (no transform change on pointer move)', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await goto(page, '/nepal/');
    await waitForGuide(page);

    const card = page.getByTestId(`guide-tilt-${BOUDHA_ID}`);
    await expect(card).toHaveAttribute('data-tilt-enabled', 'false');
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);

    const before = await card.evaluate((el) => getComputedStyle(el).transform);
    const box = await card.boundingBox();
    if (!box) throw new Error('card has no bounding box');
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.15, { steps: 4 });
    await page.waitForTimeout(400); // give any (unexpected) spring time to move

    const after = await card.evaluate((el) => getComputedStyle(el).transform);
    expect(after).toBe(before);
  });

  test('axe /nepal: zero serious/critical violations', async ({ page }) => {
    await goto(page, '/nepal/');
    await waitForGuide(page);

    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    for (const v of blocking) {
      // eslint-disable-next-line no-console
      console.log(`  axe /nepal [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} nodes)`);
    }
    expect(blocking).toHaveLength(0);
  });
});
