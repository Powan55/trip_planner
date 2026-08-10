import { test, expect } from './fixtures';
import type { Page, ConsoleMessage } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * S344 + S343 — the Travel Mode per-day map, and the Travel Mode concierge mount.
 *
 * S344's headline requirement: "a map with pinned places for that specific day only, nothing
 * more, only that specific day's plans, and it should update as I change the days." So the load-
 * bearing assertions here are (a) the pins on screen are EXACTLY the selected day's marker-matched
 * stops — asserted by id, not just by count, via `data-stop-ids` on the S344 host — and (b) tapping
 * a different day chip changes those ids IN PLACE, with the map still mounted and no remount.
 *
 * Runs against the served static `out/` build (D-093) on the shared signed-in fixture identity, so
 * `/travel` is reachable with no gate; the clock is the D-075 `?today=` override (local noon), the
 * same idiom as travel-date/travel-agenda.
 *
 * S343 is asserted the way custom-trip-gating.spec.ts asserts the concierge: the default `out/`
 * build is DORMANT (`NEXT_PUBLIC_CONCIERGE_URL` unset → ConciergeChat renders null everywhere), so
 * a conditional check keyed off the SAME build's Home trigger — absent on both surfaces when
 * dormant, present on both when the Worker URL was inlined. The mount's own `isDefaultTrip()` gate
 * is unit-proven in `lib/__tests__/travel-concierge-gating.test.ts`.
 */

const TODAY = '2026-12-10';
const DAY_A = '2026-12-10'; // 2 marker-matched stops + 1 unmatched item
const DAY_B = '2026-12-11'; // 1 marker-matched stop (a DIFFERENT marker)
const DAY_EMPTY = '2026-12-12'; // seeded with no items

type SeedItem = { id: string; title: string; category: string };
type SeedDay = { date: string; city: string; country: 'nepal' | 'japan'; items: SeedItem[] };

// Titles chosen to resolve through `lib/itinerary-map.ts`'s name join to known curated markers.
const SEED: SeedDay[] = [
  {
    date: DAY_A,
    city: 'Kathmandu',
    country: 'nepal',
    items: [
      { id: 'dm-a1', title: 'Boudhanath Stupa', category: 'sightseeing' },
      { id: 'dm-a2', title: 'Pashupatinath Temple', category: 'cultural' },
      // No curated marker matches this one → it counts toward "of M" but plots no pin (the honest
      // "N of M" contract S137 built into plan-day-map).
      { id: 'dm-a3', title: 'Nap at the guesthouse', category: 'free' },
    ],
  },
  {
    date: DAY_B,
    city: 'Kathmandu',
    country: 'nepal',
    items: [{ id: 'dm-b1', title: 'Swayambhunath sunrise', category: 'photography' }],
  },
  { date: DAY_EMPTY, city: 'Kathmandu', country: 'nepal', items: [] },
];

const CANVAS = 'canvas.maplibregl-canvas';

async function seed(page: Page, days: SeedDay[] = SEED) {
  await page.addInitScript((data: SeedDay[]) => {
    window.localStorage.setItem('nepal_japan_itinerary', JSON.stringify(data));
  }, days);
}

async function gotoTravel(page: Page, query = `?today=${TODAY}`) {
  await page.goto(`/travel/${query}`, { waitUntil: 'load' });
  await expect(page.getByTestId('travel-mode-root')).toBeVisible();
}

/** Open the collapsed map row and wait for the maplibre canvas to come up. */
async function openMap(page: Page) {
  await page.getByTestId('travel-day-map-summary').click();
  await expect(page.locator(CANVAS)).toBeVisible({ timeout: 20_000 });
}

test.describe('S344 · the map is scoped to the selected day only', () => {
  test('collapsed by default and interaction-lazy: no maplibre canvas until it is opened', async ({
    page,
  }) => {
    await seed(page);
    await gotoTravel(page);

    const row = page.getByTestId('travel-day-map');
    await expect(row).toBeVisible();
    // Honest count in the collapsed summary: 2 of the day's 3 items plot.
    await expect(page.getByTestId('travel-day-map-count')).toHaveText('2 of 3 stops pinned');
    // The ~200 kB maplibre runtime has NOT loaded (D-047): no canvas, no pane.
    await expect(page.locator(CANVAS)).toHaveCount(0);
    await expect(page.getByTestId('plan-day-map')).toHaveCount(0);
  });

  test('opened: the pins are EXACTLY the selected day’s stops, nothing whole-trip', async ({
    page,
  }) => {
    await seed(page);
    await gotoTravel(page);
    await openMap(page);

    const row = page.getByTestId('travel-day-map');
    const pane = page.getByTestId('plan-day-map');
    // Only Dec 10's two matched markers — Dec 11's Swayambhunath is NOT on the map.
    await expect(row).toHaveAttribute('data-stop-ids', 'np-boudhanath,np-pashupatinath');
    await expect(row).toHaveAttribute('data-stop-count', '2');
    await expect(pane).toHaveAttribute('data-stop-count', '2');
    await expect(pane).toHaveAttribute('data-total-count', '3');
    // The honest overlay is visible on the pane itself.
    await expect(page.getByTestId('plan-day-map-count')).toHaveText('2 of 3 stops shown');
  });

  test('changing the day UPDATES THE PINS in place (the headline requirement)', async ({ page }) => {
    await seed(page);
    await gotoTravel(page);
    await openMap(page);

    const row = page.getByTestId('travel-day-map');
    const pane = page.getByTestId('plan-day-map');
    await expect(row).toHaveAttribute('data-stop-ids', 'np-boudhanath,np-pashupatinath');

    // Mark a DOM node so a full remount/navigation would be detectable (travel-date.spec idiom).
    await page.evaluate(() => {
      (document.body as HTMLElement).dataset.marker = 'still-here';
    });

    // Day B: a different plan → different pins, fewer of them.
    await page.getByTestId(`day-strip-${DAY_B}`).click();
    await expect(page).toHaveURL(new RegExp(`[?&]date=${DAY_B}`));
    await expect(row).toHaveAttribute('data-stop-ids', 'np-swayambhunath');
    await expect(row).toHaveAttribute('data-stop-count', '1');
    await expect(pane).toHaveAttribute('data-stop-count', '1');
    await expect(page.getByTestId('plan-day-map-count')).toHaveText('1 of 1 stop shown');
    // Still the same document (in-place `history.replaceState`, S192) and the map stayed open.
    await expect(page.locator('body')).toHaveAttribute('data-marker', 'still-here');
    await expect(page.locator(CANVAS)).toBeVisible();

    // Back to day A: the original two pins return.
    await page.getByTestId(`day-strip-${DAY_A}`).click();
    await expect(row).toHaveAttribute('data-stop-ids', 'np-boudhanath,np-pashupatinath');
    await expect(pane).toHaveAttribute('data-stop-count', '2');
  });

  test('an unplanned day gets the empty state, not a bare world map', async ({ page }) => {
    await seed(page);
    await gotoTravel(page);
    await openMap(page);

    await page.getByTestId(`day-strip-${DAY_EMPTY}`).click();
    await expect(page.getByTestId('travel-day-map-count')).toHaveText('nothing planned');
    await expect(page.getByTestId('travel-day-map-empty')).toBeVisible();
    await expect(page.getByTestId('travel-day-map-empty')).toContainText('Nothing planned');
    await expect(page.locator(CANVAS)).toHaveCount(0);
    await expect(page.getByTestId('plan-day-map')).toHaveCount(0);
  });

  test('opening the map and switching days logs no console/page errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(String(err)));

    await seed(page);
    await gotoTravel(page);
    await openMap(page);
    await page.getByTestId(`day-strip-${DAY_B}`).click();
    await expect(page.getByTestId('travel-day-map')).toHaveAttribute('data-stop-ids', 'np-swayambhunath');
    await page.getByTestId(`day-strip-${DAY_EMPTY}`).click();
    await expect(page.getByTestId('travel-day-map-empty')).toBeVisible();

    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('phone 390×844, high legibility ON, reduced motion: opens with no overflow and stays a card', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' }); // TripMap fits with jumpTo, no animation
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await gotoTravel(page);

    // S189 outdoor legibility mode (the widest-content state) must not break the map row.
    await page.getByTestId('travel-legibility-toggle').click();
    await expect(page.getByTestId('travel-legibility-toggle')).toHaveAttribute('aria-pressed', 'true');
    await openMap(page);

    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over, 'map open on a 390px phone: scrollWidth-innerWidth').toBeLessThanOrEqual(0);
    // The pane stays a card, not a screen-taker: under half the viewport height.
    const box = (await page.getByTestId('plan-day-map').boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(844 * 0.5);
    await expect(page.getByTestId('plan-day-map-count')).toBeVisible();
  });

  test('a11y: the map row is keyboard-operable and axe-clean, open and closed', async ({
    page,
  }, testInfo) => {
    await seed(page);
    await gotoTravel(page);

    const scan = async (label: string) => {
      const results = await new AxeBuilder({ page }).analyze();
      const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      for (const v of results.violations) {
        testInfo.annotations.push({
          type: `axe:${v.impact ?? 'unknown'}`,
          description: `${label} [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length})`,
        });
      }
      expect(blocking, `${label}: ${blocking.map((v) => `${v.id} [${v.impact}]`).join('; ')}`).toEqual([]);
    };

    await scan('map row collapsed');

    // Keyboard: focus the summary and open it with Enter (native <details> semantics).
    const summary = page.getByTestId('travel-day-map-summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator(CANVAS)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('travel-day-map')).toHaveAttribute('open', '');
    // ≥44px touch target for the row control (D-071/D-141 floor).
    const box = (await summary.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);

    await scan('map row open');
  });
});

test.describe('S343 · the concierge is mounted in Travel Mode', () => {
  test('present on /travel exactly when this build has it enabled (dormant build: absent on both)', async ({
    page,
  }) => {
    // Which build is this? The Home navbar mount is the reference: with NEXT_PUBLIC_CONCIERGE_URL
    // unset (the deploy-faithful default `out/`) ConciergeChat renders null everywhere.
    await page.goto('/', { waitUntil: 'load' });
    const enabled = (await page.getByTestId('concierge-trigger').count()) > 0;

    await gotoTravel(page);
    if (enabled) {
      // S343: the same component now reaches the chrome-free surface too, inside the TM root
      // (so the TM-9 no-chrome-leak focus walk still holds) and thumb-reachable.
      const trigger = page.getByTestId('concierge-trigger');
      await expect(trigger).toBeVisible();
      await expect(
        page.locator('[data-testid="travel-mode-root"] [data-testid="concierge-trigger"]'),
      ).toHaveCount(1);
      const box = (await trigger.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.y + box.height).toBeGreaterThan(page.viewportSize()!.height - 80);
    } else {
      // Dormant build: nothing rendered, and the reserved thumb band stays collapsed (`:empty`)
      // so the S317 layout is byte-identical to pre-S343.
      await expect(page.getByTestId('concierge-trigger')).toHaveCount(0);
      const band = page.locator('.tm-thumb-zone');
      await expect(band).toHaveCount(1);
      await expect(band).toBeHidden();
    }
  });
});
