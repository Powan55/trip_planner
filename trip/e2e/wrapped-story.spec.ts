import { test, expect } from '@playwright/test';
import type { Page, BrowserContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * S219 — the "Trip Wrapped" capstone (`components/wrapped-story.tsx`, `/recap`) E2E pack.
 * Mirrors `e2e/recap-story.spec.ts`'s harness: signs in with a real Trip Token, drives the clock
 * via `?today=`, seeds every composed domain via a ONE-TIME `page.evaluate` after navigation + a
 * single reload (never `addInitScript` for the data), `domcontentloaded` navigation, and
 * `emulateMedia` for reduced-motion.
 *
 * Proves, on real rendered output against the served static `out/` build:
 *   1. Every headline stat renders the EXACT number derived from a known seed (mid-trip).
 *   2. The clipboard fallback fires (and copies real text) when `navigator.share` is absent.
 *   3. Under reduced motion the wrapped panels render fully visible with no celebration burst.
 *   4. axe serious/critical = 0 on `/recap` with the wrapped section open.
 *   5. The existing `recap-story*` specs are unaffected (host untouched) — run separately in CI,
 *      not duplicated here.
 */

const ITINERARY_KEY = 'nepal_japan_itinerary';
const JOURNAL_KEY = 'nepal_japan_journal';
const EXPENSES_KEY = 'nepal_japan_expenses';
const PHOTOS_KEY = 'nepal_japan_photos';
const PACKING_KEY = 'nepal_japan_packing';
const DOCS_KEY = 'nepal_japan_docs_checklist';

// Day 12 of the trip (2026-12-09 .. 2026-12-20 inclusive = 12 elapsed days) — matches the "Day 12"
// convention already established by e2e/recap-spend.spec.ts.
const SEED_DAY = '2026-12-09';
const MID_TRIP_DAY = '2026-12-20';
const POST_TRIP_DAY = '2027-01-15';

async function seedTraveler(page: Page, token = 'Powan') {
  await page.addInitScript((t: string) => {
    window.localStorage.setItem('tripPlannerToken', t);
    window.localStorage.setItem('tripPlannerUserName', t);
    window.localStorage.setItem('nepal_japan_first_run_tour_seen', '1');
    window.localStorage.setItem('nepal_japan_install_hint_dismissed', '1'); // S272: dismiss app-wide install toast (duration:Infinity poisons axe scans)
  }, token);
}

async function gotoRecapWithClock(page: Page, todayParam: string) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/recap/?today=${todayParam}`, { waitUntil: 'domcontentloaded' });
}

async function settleWrapped(page: Page) {
  await expect(page.getByTestId('wrapped-story')).toBeVisible();
  // The island swaps skeleton -> real content; wait for the real entry card testid.
  await expect(page.getByTestId('wrapped-entry')).toBeVisible();
}

/** ONE-TIME seed across every domain `deriveWrapped` composes. Callers reload once after seeding. */
async function seedStores(page: Page) {
  await page.evaluate(
    (keys) => {
      const plans = [
        {
          date: keys.day,
          city: 'Kathmandu',
          country: 'nepal',
          items: [
            { id: 's219-a', title: 'S219 Boudhanath at dawn', category: 'sightseeing', done: true },
            { id: 's219-b', title: 'S219 Thamel market walk', category: 'shopping', done: false },
          ],
        },
      ];
      window.localStorage.setItem(keys.itin, JSON.stringify(plans));

      window.localStorage.setItem(
        keys.journal,
        JSON.stringify([
          { date: keys.day, text: 'S219 wrapped seed entry', createdAt: '2026-12-09T07:00:00.000Z', updatedAt: '2026-12-09T07:00:00.000Z' },
        ]),
      );

      window.localStorage.setItem(
        keys.exp,
        JSON.stringify([
          { id: 's219-exp-1', leg: 'nepal', category: 'food', amount: 1000, date: keys.day, createdAt: '2026-12-09T08:00:00.000Z' },
          { id: 's219-exp-2', leg: 'nepal', category: 'food', amount: 500, date: keys.day, createdAt: '2026-12-09T09:00:00.000Z' },
          { id: 's219-exp-3', leg: 'nepal', category: 'shopping', amount: 800, date: keys.day, createdAt: '2026-12-09T10:00:00.000Z' },
          { id: 's219-exp-4', leg: 'japan', category: 'transportation', amount: 3000, date: keys.day, createdAt: '2026-12-09T11:00:00.000Z' },
        ]),
      );

      window.localStorage.setItem(
        keys.photos,
        JSON.stringify([
          { id: 's219-ph-1', owner: { kind: 'journal', date: keys.day }, altText: 'A', w: 10, h: 10, bytes: 100, createdAt: '2026-12-09T07:00:00.000Z' },
          { id: 's219-ph-2', owner: { kind: 'journal', date: keys.day }, altText: 'B', w: 10, h: 10, bytes: 100, createdAt: '2026-12-09T07:01:00.000Z' },
        ]),
      );

      window.localStorage.setItem(
        keys.packing,
        JSON.stringify([
          { id: 's219-pk-1', label: 'Boots', category: 'nepal', checked: true },
          { id: 's219-pk-2', label: 'Coat', category: 'japan', checked: false },
        ]),
      );

      window.localStorage.setItem(
        keys.docs,
        JSON.stringify([
          { id: 's219-d1', section: 'critical', label: 'Passport', checked: true },
          { id: 's219-d2', section: 'critical', label: 'Visa', checked: false },
          { id: 's219-d3', section: 'dayzero', label: 'Check-in', checked: false },
        ]),
      );
    },
    { itin: ITINERARY_KEY, journal: JOURNAL_KEY, exp: EXPENSES_KEY, photos: PHOTOS_KEY, packing: PACKING_KEY, docs: DOCS_KEY, day: SEED_DAY },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
}

test.describe('S219 wrapped — exact stats against a known seed (mid-trip)', () => {
  test('every headline stat matches the seed exactly', async ({ page }) => {
    await seedTraveler(page);
    await gotoRecapWithClock(page, MID_TRIP_DAY);
    await seedStores(page);
    await settleWrapped(page);

    expect(await page.getAttribute('[data-testid="wrapped-story"]', 'data-wrapped-status')).toBe('mid');

    await expect(page.getByTestId('wrapped-stat-days')).toContainText('12');
    await expect(page.getByTestId('wrapped-stat-days')).toContainText('32');

    await expect(page.getByTestId('wrapped-stat-activities')).toContainText('1');
    await expect(page.getByTestId('wrapped-stat-activities')).toContainText('2');

    const nepalSpend = page.getByTestId('wrapped-spend-nepal');
    await expect(nepalSpend).toContainText('2,300'); // 1000+500+800
    await expect(nepalSpend).toContainText('Food'); // top category

    const japanSpend = page.getByTestId('wrapped-spend-japan');
    await expect(japanSpend).toContainText('3,000');
    await expect(japanSpend).toContainText('Transportation');

    await expect(page.getByTestId('wrapped-stat-journal')).toContainText('1');
    await expect(page.getByTestId('wrapped-stat-photos')).toContainText('2');

    const packing = page.getByTestId('wrapped-stat-packing');
    await expect(packing).toContainText('1');
    await expect(packing).toContainText('2');

    const docs = page.getByTestId('wrapped-stat-docs');
    await expect(docs).toContainText('1');
    await expect(docs).toContainText('3');

    // Survives a reload — reads PERSISTED data (the seed was a one-time evaluate).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await settleWrapped(page);
    await expect(page.getByTestId('wrapped-stat-journal')).toContainText('1');
  });

  test('post-trip clock flips status to "post" and days-lived covers all 32', async ({ page }) => {
    await seedTraveler(page);
    await gotoRecapWithClock(page, POST_TRIP_DAY);
    await seedStores(page);
    await settleWrapped(page);

    expect(await page.getAttribute('[data-testid="wrapped-story"]', 'data-wrapped-status')).toBe('post');
    await expect(page.getByTestId('wrapped-stat-days')).toContainText('32');
  });
});

test.describe('S219 wrapped — share: clipboard + toast fallback', () => {
  test('with navigator.share absent, Share copies the summary text to the clipboard', async ({ page, context }: { page: Page; context: BrowserContext }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await seedTraveler(page);
    // Force the feature-detection branch: no navigator.share on this "device".
    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, 'share', { value: undefined, configurable: true });
    });
    await gotoRecapWithClock(page, MID_TRIP_DAY);
    await seedStores(page);
    await settleWrapped(page);

    await page.getByTestId('wrapped-share').click();

    await expect(page.locator('[data-sonner-toaster]')).toContainText('Copied your wrapped summary');

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toContain('Nepal × Japan trip, wrapped');
    expect(clipboardText).toContain('12/32 days');
    expect(clipboardText).not.toMatch(/data:image|blob:/); // D-159 — text only, never a photo blob
  });
});

test.describe('S219 wrapped — reduced motion renders static, no celebration burst', () => {
  test('post-trip + reduced motion: panels are visible immediately, celebration burst never renders', async ({ page }) => {
    await seedTraveler(page);
    await gotoRecapWithClock(page, POST_TRIP_DAY); // emulateMedia reduced already set by the helper
    await seedStores(page);
    await settleWrapped(page);

    await expect(page.getByTestId('wrapped-stat-days')).toBeVisible();
    await expect(page.getByTestId('wrapped-stat-docs')).toBeVisible();
    // The one-shot completion flourish is D-056b-gated: it must never render under reduced motion,
    // even though this is exactly the post-trip transition that would trigger it motion-on.
    await expect(page.getByTestId('wrapped-celebration')).toHaveCount(0);
  });
});

test.describe('S219 axe — /recap with the wrapped section open', () => {
  test('zero serious/critical violations with wrapped stats rendered', async ({ page }, testInfo) => {
    await seedTraveler(page);
    await gotoRecapWithClock(page, MID_TRIP_DAY);
    await seedStores(page);
    await settleWrapped(page);

    // S336: the mid-trip travel-arrival toast (fixed, fades opacity 0->1 on mount) can be sampled
    // by axe mid-fade, which multiplies its text-white/60 down to ~0.42 effective (4.05:1) — a
    // false positive; at rest it composites to ~7:1 on the glass surface. Settle it to opacity 1
    // first (the s157-a11y-close-targets settle-guard pattern), so the scan reads its true colors.
    const arrivalToast = page.getByTestId('travel-arrival-toast');
    await arrivalToast.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
    if (await arrivalToast.count()) {
      await expect(arrivalToast).toHaveCSS('opacity', '1');
    }

    const results = await new AxeBuilder({ page }).exclude('[data-sonner-toaster]').analyze();
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    for (const v of results.violations) {
      testInfo.annotations.push({ type: `axe:${v.impact ?? 'unknown'}`, description: `${v.id}: ${v.help}` });
    }
    expect(blocking, blocking.map((v) => `${v.id} [${v.impact}]`).join('; ')).toEqual([]);
  });
});
