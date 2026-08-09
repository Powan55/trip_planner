import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Nightlife visibility-gate E2E pack (slice S113).
 *
 * `components/nightlife-section.tsx` is gated on `useActiveTraveler().traveler`: with no guest
 * mode (D-241, S351), an unidentified visitor never visibly reaches `/nepal/` or `/japan/` at all
 * — TokenGate's wall covers every route — so the render-gate's own independent correctness is no
 * longer separately observable in a real browser (there's nothing else to see once the wall is
 * up); a signed-in traveler (a real Trip Token persisted at `tripPlannerToken`, matching
 * `STORAGE_KEYS.token`/`lib/token-auth.ts`'s `TRAVELERS`) sees the section exactly as before. This
 * pack accordingly asserts only the signed-in branch now — the render-gate's `traveler === null`
 * branch is covered at the unit level (`components/__tests__/` / gate-consumer tests), not here.
 *
 * Deliberately does NOT import `test`/`expect` from `./fixtures` — each test here seeds its own
 * identity via `page.addInitScript` (runs before any app script on every navigation in that page,
 * same technique `fixtures.ts` and `visual.spec.ts` use), proven on real rendered output — a
 * mutation-style proof (D-055/D-120 shape), not a "the JS still compiles" check.
 *
 * The served static `out/` build must already exist (`npm run build`), same as
 * every other spec in this pack (playwright.config.ts's `webServer`).
 *
 * ROUTE NOTE (verified against source, not assumed): `NightlifeSection` is dynamically
 * imported and mounted ONLY on `/nepal/page.tsx` and `/japan/page.tsx` — Home
 * (`app/page.tsx`) never renders it (its section list is Hero/TodayPanel/TripRecap/
 * TripDashboard/TripTimeline/TravelEssentials/LegacyHashRedirect — FlightsSection moved
 * off Home to its own `/flights/` route in S113D; no NightlifeSection import at all).
 * The original "mounted on /, /nepal, /japan" premise
 * does not match the shipped code — a recorded finding. This spec's gate
 * assertions therefore target `/nepal/` and `/japan/` only, where the gate is real and
 * observable; a Home spot-check below independently confirms the section remains absent
 * there, which is correct but is not evidence of the gate itself (there's nothing to gate
 * on that route).
 */

const GATED_ROUTES = ['/nepal/', '/japan/'] as const;

/** Seed a SIGNED-IN traveler's token and navigate; wait for real render (h1). */
async function gotoAsTraveler(page: Page, path: string, token = 'Powan') {
  await page.addInitScript((t: string) => {
    window.localStorage.setItem('tripPlannerToken', t);
    window.localStorage.setItem('nepal_japan_first_run_tour_seen', '1'); // S155: keep dormant
    window.localStorage.setItem('nepal_japan_install_hint_dismissed', '1'); // S272: dismiss app-wide install toast (duration:Infinity poisons axe scans)
  }, token);
  await page.goto(path, { waitUntil: 'load' });
  await expect(page.locator('h1').first()).toBeVisible();
}

test.describe('nightlife visibility gate — signed-in traveler (real Trip Token)', () => {
  for (const path of GATED_ROUTES) {
    test(`signed-in traveler SEES nightlife section on ${path}`, async ({ page }) => {
      await gotoAsTraveler(page, path);
      await expect(page.locator('[role="dialog"]')).toHaveCount(0);
      await expect(page.getByTestId('nightlife-section')).toBeVisible();
      await expect(page.locator('#nightlife-heading')).toBeVisible();
    });
  }

  test('signed-in traveler sees no nightlife section on Home either (never mounted there)', async ({
    page,
  }) => {
    await gotoAsTraveler(page, '/');
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    await expect(page.getByTestId('nightlife-section')).toHaveCount(0);
  });

  test('signed-in traveler: show/hide toggle + venue cards still work exactly as before', async ({
    page,
  }) => {
    await gotoAsTraveler(page, '/nepal/');
    const section = page.getByTestId('nightlife-section');
    await expect(section).toBeVisible();

    const venueCards = section.locator('[data-testid^="nightlife-add-"]');
    await expect(venueCards.first()).toBeVisible();
    expect(await venueCards.count()).toBeGreaterThan(0);

    // Spot-check the pre-existing show/hide toggle (untouched by this slice) still
    // functions normally for a signed-in traveler.
    const hideToggle = page.getByRole('button', { name: 'Hide Nightlife Section' });
    await expect(hideToggle).toHaveAttribute('aria-expanded', 'true');
    await hideToggle.click();

    const showToggle = page.getByRole('button', { name: 'Show Nightlife Section' });
    await expect(showToggle).toBeVisible();
    await expect(showToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(venueCards).toHaveCount(0);

    await showToggle.click();
    await expect(page.getByRole('button', { name: 'Hide Nightlife Section' })).toBeVisible();
    await expect(venueCards.first()).toBeVisible();
  });
});

/**
 * S138 (D-146) — nightlife "Added" feedback. Custom-added nightlife venues now carry
 * a namespaced sourceId (`nightlife-<id>`), so the venue card and the detail sheet's
 * add control can show real planned-state feedback (D-029 shape), where before they
 * never could (D-074's always-empty sourceId). Proven end-to-end on the DORMANT
 * `out/` build: add -> card badge appears -> reload -> still Added -> remove -> gone.
 */
test.describe('S138 · nightlife "Added" feedback (D-146)', () => {
  test('add a venue -> card badge appears -> reload -> still Added -> remove -> gone', async ({
    page,
  }) => {
    await gotoAsTraveler(page, '/nepal/');
    await expect(page.getByTestId('nightlife-section')).toBeVisible();

    // S257: the seed itinerary back-links nl1 (Purple Haze, planned Dec 11), so its
    // badge is present on a FRESH vault — assert the seed-linked badge as the feature.
    await expect(page.getByTestId('nightlife-added-nl1')).toBeVisible();
    // Not yet added: no passive badge on an unseeded venue's card (nl3, LOD).
    await expect(page.getByTestId('nightlife-added-nl3')).toHaveCount(0);

    // Open the detail sheet for a known UNSEEDED Nepal venue (nl3, "LOD (Lord of the Drinks)").
    await page.getByTestId('nightlife-add-nl3').click();
    const sheet = page.getByTestId('place-detail-sheet');
    await expect(sheet).toBeVisible();

    const footerBtn = page.getByTestId('place-detail-add-to-plan');
    await expect(footerBtn).toHaveText('Add to plan');

    // Add it via the custom dialog — title comes prefilled from the venue name.
    await footerBtn.click();
    const dialog = page.getByTestId('add-item-dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('add-item-title-input')).toHaveValue('LOD (Lord of the Drinks)');
    await page.getByTestId('add-item-confirm').click();
    await expect(dialog).toHaveCount(0);

    // The sheet's own footer flips to the state-aware "Added" treatment immediately.
    await expect(footerBtn).toContainText('Added');

    // Close the sheet; the card itself now shows the passive "Added" badge. S248: the
    // badge now carries the D-029 date parity ("Added · On <date>"), so assert both the
    // "Added" word and the "On " date summary (covers the one-day and N-days shapes).
    await page.getByTestId('place-detail-close').click();
    await expect(sheet).toHaveCount(0);
    const cardBadge = page.getByTestId('nightlife-added-nl3');
    await expect(cardBadge).toBeVisible();
    await expect(cardBadge).toContainText('Added');
    await expect(cardBadge).toContainText('On ');

    // Reload: the badge survives (localStorage persistence, D-018 shape).
    await page.reload({ waitUntil: 'load' });
    await expect(page.locator('h1').first()).toBeVisible();
    await expect(page.getByTestId('nightlife-section')).toBeVisible();
    await expect(cardBadge).toBeVisible();
    await expect(cardBadge).toContainText('Added');
    await expect(cardBadge).toContainText('On ');

    // Reopen the sheet: shows "Added" + a remove control in "Already planned"; remove it.
    await page.getByTestId('nightlife-add-nl3').click();
    await expect(page.getByTestId('place-detail-sheet')).toBeVisible();
    await expect(footerBtn).toContainText('Added');
    await footerBtn.click();
    await expect(dialog).toBeVisible();
    await page.getByRole('button', { name: /^Remove from/ }).click();

    // Close the dialog; the sheet's footer reverts to plain "Add to plan".
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(footerBtn).toHaveText('Add to plan');

    // Close the sheet; the card's badge is gone.
    await page.getByTestId('place-detail-close').click();
    await expect(page.getByTestId('nightlife-added-nl3')).toHaveCount(0);
  });
});
