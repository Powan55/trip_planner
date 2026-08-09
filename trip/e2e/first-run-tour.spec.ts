import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * S155 — the first-run guided tour (`components/first-run-tour.tsx`) E2E pack, on the
 * served static `out/` build (D-093).
 *
 * Signs in EXPLICITLY (mirrors `settings.spec.ts` / `s158-…spec.ts`) rather than riding the
 * shared `fixtures.ts` default — that default now pre-seeds the tour "seen" flag (S155, so
 * the other ~200 specs in the pack stay undisturbed by this dialog); this pack needs FRESH
 * (unseeded) storage to actually see the tour fire.
 *
 * Proves: the tour shows once past the gate on fresh storage; Skip marks it seen and it
 * never reappears across a reload; a genuinely fresh storage context shows it again;
 * completing to the last step also marks it seen (reload-proof); full keyboard operation
 * (Tab trap, Enter advances, Esc skips); zero serious/critical axe violations.
 */

const TOUR_SEEN_KEY = 'nepal_japan_first_run_tour_seen';

async function settleSW(page: Page) {
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

/** Sign in as a traveler on FRESH storage (no tour-seen flag) and land on Home. */
async function gotoFreshHome(page: Page, token = 'Powan') {
  await page.addInitScript((t: string) => {
    window.localStorage.setItem('tripPlannerToken', t);
    window.localStorage.setItem('tripPlannerUserName', t);
  }, token);
  await page.goto('/', { waitUntil: 'load' });
  await settleSW(page);
}

async function expectTourVisible(page: Page) {
  await expect(page.getByTestId('tour-dialog')).toBeVisible({ timeout: 15_000 });
}

test.describe('S155 — first-run tour shows exactly once', () => {
  test('shows on first arrival past the gate, on step 1 of 5 ("Today")', async ({ page }) => {
    await gotoFreshHome(page);
    await expectTourVisible(page);
    await expect(page.getByTestId('tour-progress')).toHaveText('Step 1 of 5');
    await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
    // Not yet marked seen at this point.
    expect(await page.evaluate((k) => window.localStorage.getItem(k), TOUR_SEEN_KEY)).toBeNull();
  });

  test('Skip dismisses the tour, marks it seen, and it does NOT reappear after reload', async ({
    page,
  }) => {
    await gotoFreshHome(page);
    await expectTourVisible(page);

    await page.getByTestId('tour-skip').click();
    await expect(page.getByTestId('tour-dialog')).toHaveCount(0);
    expect(await page.evaluate((k) => window.localStorage.getItem(k), TOUR_SEEN_KEY)).toBe('1');

    // Reload — the hard guarantee: the tour must NOT come back.
    await page.reload({ waitUntil: 'load' });
    await settleSW(page);
    await expect(page.getByTestId('tour-dialog')).toHaveCount(0);
    // A second reload for good measure (no one-shot-per-session leak).
    await page.reload({ waitUntil: 'load' });
    await settleSW(page);
    await expect(page.getByTestId('tour-dialog')).toHaveCount(0);
  });

  test('a genuinely fresh storage context (new browser context) shows the tour again', async ({
    browser,
  }) => {
    // First context: skip the tour, confirm it's gone.
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    await gotoFreshHome(page1);
    await expectTourVisible(page1);
    await page1.getByTestId('tour-skip').click();
    await expect(page1.getByTestId('tour-dialog')).toHaveCount(0);
    await ctx1.close();

    // Second, ISOLATED context: fresh localStorage → the tour must show again.
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await gotoFreshHome(page2);
    await expectTourVisible(page2);
    await ctx2.close();
  });

  test('completing to the last step marks it seen and it does not reappear after reload', async ({
    page,
  }) => {
    await gotoFreshHome(page);
    await expectTourVisible(page);

    const labels = ['Today', 'Plan', 'Budget', 'Journal', 'Map'];
    for (let i = 0; i < labels.length; i++) {
      await expect(page.getByTestId('tour-progress')).toHaveText(`Step ${i + 1} of 5`);
      await expect(page.getByRole('heading', { name: labels[i] })).toBeVisible();
      await page.getByTestId('tour-next').click();
    }

    // The last click ("Let's go") finished the tour.
    await expect(page.getByTestId('tour-dialog')).toHaveCount(0);
    expect(await page.evaluate((k) => window.localStorage.getItem(k), TOUR_SEEN_KEY)).toBe('1');

    await page.reload({ waitUntil: 'load' });
    await settleSW(page);
    await expect(page.getByTestId('tour-dialog')).toHaveCount(0);
  });

  test('Back is disabled on step 1 and enabled after advancing; steps its way back and forth', async ({
    page,
  }) => {
    await gotoFreshHome(page);
    await expectTourVisible(page);

    await expect(page.getByTestId('tour-back')).toBeDisabled();
    await page.getByTestId('tour-next').click();
    await expect(page.getByTestId('tour-progress')).toHaveText('Step 2 of 5');
    await expect(page.getByTestId('tour-back')).toBeEnabled();

    await page.getByTestId('tour-back').click();
    await expect(page.getByTestId('tour-progress')).toHaveText('Step 1 of 5');
    await expect(page.getByTestId('tour-back')).toBeDisabled();
  });

});

test.describe('S155 — first-run tour keyboard + a11y', () => {
  test('Tab traps focus within the dialog; Enter on Next advances a step', async ({ page }) => {
    await gotoFreshHome(page);
    await expectTourVisible(page);

    // Skip button is focused on open (the dialog's first control).
    await expect(page.getByTestId('tour-skip')).toBeFocused();

    await page.keyboard.press('Tab'); // -> Back (disabled, skipped by native focus order)
    // Back is disabled on step 1, so Tab should land on Next.
    await expect(page.getByTestId('tour-next')).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page.getByTestId('tour-progress')).toHaveText('Step 2 of 5');

    // Tab wraps around: Skip -> Back -> Next -> (wrap) -> Skip.
    await page.getByTestId('tour-skip').focus();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('tour-back')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('tour-next')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('tour-skip')).toBeFocused(); // wraps back to first
  });

  test('Esc skips the tour from any step', async ({ page }) => {
    await gotoFreshHome(page);
    await expectTourVisible(page);
    await page.getByTestId('tour-next').click();
    await expect(page.getByTestId('tour-progress')).toHaveText('Step 2 of 5');

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('tour-dialog')).toHaveCount(0);
    expect(await page.evaluate((k) => window.localStorage.getItem(k), TOUR_SEEN_KEY)).toBe('1');
  });

  test('axe: zero serious/critical violations on the open tour dialog', async ({ page }, testInfo) => {
    await gotoFreshHome(page);
    await expectTourVisible(page);

    const results = await new AxeBuilder({ page }).include('[data-testid="tour-dialog"]').analyze();
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    for (const v of results.violations) {
      const line = `[${v.impact ?? 'n/a'}] ${v.id}: ${v.help} (${v.nodes.length} node${v.nodes.length === 1 ? '' : 's'})`;
      testInfo.annotations.push({ type: `axe:${v.impact ?? 'unknown'}`, description: line });
      // eslint-disable-next-line no-console
      console.log(`  axe / (S155 tour) ${line}`);
    }
    expect(
      blocking,
      `serious/critical a11y violations on the tour dialog: ${blocking.map((v) => `${v.id} [${v.impact}]`).join('; ')}`,
    ).toEqual([]);
  });
});

test.describe('S155 — reduced motion (D-007/D-056)', () => {
  test('the panel entrance transform is applied instantly (no ramp) under reduced motion', async ({
    page,
  }) => {
    // Pin reduced motion BEFORE first paint (mirrors motion.spec.ts's gotoReduced idiom).
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript((t: string) => {
      window.localStorage.setItem('tripPlannerToken', t);
      window.localStorage.setItem('tripPlannerUserName', t);
    }, 'Powan');
    await page.goto('/', { waitUntil: 'load' });
    await settleSW(page);

    await expectTourVisible(page);
    const dialog = page.getByTestId('tour-dialog');

    // Framer-motion's reducedMotion="user" (motion-dom) disables animation ONLY for
    // positional/transform keys (x/y/scale/rotate/…) — `{ type: false }`, applied with NO
    // animation frames at all — while opacity is still allowed to fade (the standard,
    // intentional framer contract; motion sickness triggers are transform/parallax, not a
    // plain fade). So the deterministic, honest proof is: the transform (scale + y) is
    // ALREADY at its rest identity the instant the dialog is observable — sampled twice,
    // immediately and after a delay, to prove it never ramps at all (not just "settles
    // eventually").
    const readTransform = () =>
      dialog.evaluate((el) => {
        const m = new DOMMatrix(getComputedStyle(el).transform);
        return { a: Math.round(m.a * 1000) / 1000, d: Math.round(m.d * 1000) / 1000, e: Math.round(m.e), f: Math.round(m.f) };
      });

    const first = await readTransform();
    expect(first).toEqual({ a: 1, d: 1, e: 0, f: 0 }); // identity: scale(1), translate(0,0)

    await page.waitForTimeout(400); // longer than the normal-motion transition duration (0.35s)
    const second = await readTransform();
    expect(second).toEqual({ a: 1, d: 1, e: 0, f: 0 }); // unchanged — never moved, proving no ramp
  });
});
