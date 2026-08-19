import { test, expect } from './fixtures';
import type { Page, Route } from '@playwright/test';

/**
 * S285 — place-link import, inbox + palette integration & the reload-persistence guarantee
 * (`components/share-inbox.tsx`, `components/import-place-sheet.tsx` [S284], `components/command-
 * palette.tsx`). Runs against the served static
 * `out/` build (D-093), signed-in traveler by default (./fixtures) so the front-door wall
 * (D-241) never appears on `/share`, `/nepal`, `/plan`.
 *
 * SERVICE WORKERS ARE BLOCKED for the whole file: the SW's stale-while-revalidate would
 * serve `/resolve` fetches the page-level
 * `page.route` stub never sees, silently bypassing the stub. Block = the stub is the only thing
 * answering the Worker origin.
 *
 * The Worker resolution path is DORMANT unless the build inlined `NEXT_PUBLIC_CONCIERGE_URL`
 * (`lib/concierge-config.ts`) — with it unset, `resolvePlaceLink` short-circuits at
 * `lib/place-resolve.ts:50` and NO fetch fires (the import sheet stays fully manual, which is by
 * design — the feature never dead-ends).
 *
 * 🔴 THIS FILE IS WIRED-ONLY (issue #9). It used to BRANCH on whether resolution was wired —
 * `if (found) { assert the pre-fill } else { type the name by hand }` — so on a dormant build every
 * test below went green having exercised nothing but the manual fallback. `resolvePlaceLink` is
 * TOTAL and returns `null` on every failure, so "the Worker was never configured" and "the Worker
 * answered garbage" produce the identical, benign UI state; a spec that accepts both cannot tell
 * them apart, which is precisely how a file named `place-import` could stay green while place
 * import was not wired at all. Every resolve-path test now asserts POSITIVELY that the configured
 * endpoint was really requested (`hits.count`) and that the sheet really reached "Found" — the same
 * shape `concierge.spec.ts` already uses. On a dormant build these fail with the message below
 * rather than passing vacuously. CI builds with the env set (`.github/workflows/ci.yml`); locally:
 *   NEXT_PUBLIC_CONCIERGE_URL=https://concierge.test npm run build
 *
 * The manual-fallback guarantee is NOT lost: it is asserted by the 500-from-/resolve test, which
 * now proves the 500 came off the wire (the stub was hit) rather than from a build that never
 * called anything — the same vacuity, one branch over.
 */

test.use({ serviceWorkers: 'block' });

const GOOGLE_URL = 'https://maps.app.goo.gl/testPlaceS285';
// A deliberately unique name — the curated Nepal guide already ships a real "Boudhanath Stupa"
// card, so a colliding name would make the on-page text assertions ambiguous.
const PLACE_NAME = 'S285 Test Spot';
const RESOLVE_OK = {
  ok: true,
  finalUrl: 'https://www.google.com/maps/place/S285+Test+Spot/@27.7215,85.3620,17z',
  name: PLACE_NAME,
  lat: 27.7215,
  lng: 85.362,
};

// CORS headers: the client fetch carries an `X-Trip-Token` header (a non-simple request), so the
// browser sends a preflight OPTIONS to the (cross-origin) Worker URL before the GET. The stub must
// answer BOTH or the real GET is CORS-blocked and the sheet silently falls back to manual.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
};

/** Stub every `<origin>/resolve?url=…` (any origin — regex, origin-agnostic). Returns a hit counter. */
async function stubResolve(page: Page, body: unknown, status = 200) {
  const hits = { count: 0 };
  await page.route(/\/resolve\?url=/, async (route: Route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    hits.count += 1;
    if (status >= 400) {
      await route.fulfill({ status, headers: CORS, contentType: 'application/json', body: '{"ok":false}' });
      return;
    }
    await route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return hits;
}

/** Wait for the sheet's resolve status to reach a terminal state; return true iff "Found". */
async function waitResolveTerminal(page: Page): Promise<boolean> {
  const status = page.getByTestId('import-place-status');
  await expect(status).toHaveText(/Found this place|Couldn't read this link/, { timeout: 12_000 });
  return (await status.textContent())?.includes('Found this place') ?? false;
}

const NOT_WIRED =
  'PLACE IMPORT IS NOT WIRED in this build: the sheet never requested <origin>/resolve, so ' +
  'NEXT_PUBLIC_CONCIERGE_URL was not inlined at build time (lib/place-resolve.ts:50 short-circuits ' +
  'to null before any fetch). This spec is wired-only — it exists to prove the resolve path runs, ' +
  'and passing on the manual fallback would prove nothing. Rebuild with ' +
  'NEXT_PUBLIC_CONCIERGE_URL=https://concierge.test npm run build, then re-run.';

/**
 * #9 — the wiring check, asserted POSITIVELY and in both halves, because either alone can lie:
 *   • `hits.count` — the configured endpoint was actually REQUESTED (a dormant build makes no
 *     fetch at all, so this is 0 and nothing else in the test can tell).
 *   • `found` — the sheet actually reached "Found", i.e. the answer was parsed and applied, not
 *     just requested and dropped on the floor by the total `null` contract.
 */
async function assertResolveWired(page: Page, hits: { count: number }): Promise<void> {
  const found = await waitResolveTerminal(page);
  expect(hits.count, NOT_WIRED).toBeGreaterThan(0);
  // Distinct message on purpose: reaching here means the request DID go out, so this is a
  // parse/apply failure in the client, not a build-configuration one — very different fix.
  expect(
    found,
    `the stub was requested (${hits.count}x) but the sheet did not reach "Found" — the resolve ran ` +
      'and its answer was discarded (lib/place-resolve.ts returns null on any parse failure).',
  ).toBe(true);
}

test.describe('S285 · place import — persistence hard guarantee (paste → confirm → card + plan item → reload)', () => {
  test('paste a Google link, (stub) resolve, add to plan, and both the card and its plan link survive a reload', async ({
    page,
  }) => {
    const hits = await stubResolve(page, RESOLVE_OK);
    await page.goto('/share/', { waitUntil: 'load' });
    await expect(page.getByTestId('share-inbox')).toBeVisible();

    // Open the paste-a-link sheet.
    await page.getByTestId('share-paste-link').click();
    await expect(page.getByTestId('import-place-sheet')).toBeVisible();

    // Paste the URL and look it up.
    await page.getByTestId('import-place-url-input').fill(GOOGLE_URL);
    await page.getByTestId('import-place-lookup').click();

    // #9 — the stub really answered: name pre-filled, Nepal pre-selected from the resolved coords.
    // No `if (found)` branch: a dormant build fails here instead of typing the name by hand and
    // carrying on green.
    await assertResolveWired(page, hits);
    await expect(page.getByTestId('import-place-name-input')).toHaveValue(PLACE_NAME);
    await expect(page.getByTestId('import-place-leg-nepal')).toHaveAttribute('aria-pressed', 'true');

    // Force the leg deterministically (Nepal) so the card lands on /nepal/ regardless of build.
    await page.getByTestId('import-place-leg-nepal').click();

    // Also add it to the plan on a trip day.
    await page.getByTestId('import-place-toggle-plan').click();
    const daySelect = page.getByTestId('import-place-day-select');
    await expect(daySelect).toBeVisible();
    const dayValue = await daySelect.inputValue();

    await page.getByTestId('import-place-confirm').click();
    await expect(page.getByTestId('import-place-sheet')).toHaveCount(0);

    // The card appears in the Nepal "My places" grid, and — because a plan item was created with
    // sourceId `myplace-<id>` — its action reads "Added · edit plan" (findPlacements match). One
    // assertion proves BOTH the place and the linked plan item.
    await page.goto('/nepal/', { waitUntil: 'load' });
    const nepalGrid = page.getByTestId('my-places-grid-nepal');
    await expect(nepalGrid).toBeVisible({ timeout: 15_000 });
    await expect(nepalGrid.getByText(PLACE_NAME)).toBeVisible();
    await expect(nepalGrid.getByRole('button', { name: `Add ${PLACE_NAME} to your plan` })).toHaveText(/Added/);

    // The localStorage hard guarantee: reload, both survive.
    await page.reload({ waitUntil: 'load' });
    const nepalGridReloaded = page.getByTestId('my-places-grid-nepal');
    await expect(nepalGridReloaded).toBeVisible({ timeout: 15_000 });
    await expect(nepalGridReloaded.getByText(PLACE_NAME)).toBeVisible();
    await expect(nepalGridReloaded.getByRole('button', { name: `Add ${PLACE_NAME} to your plan` })).toHaveText(
      /Added/,
    );

    // Sanity: the day picked was a real trip day (the plan write targeted it).
    expect(dayValue).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // S349 — the actual bug: coords.lat/lng must ride the addItem() payload, not just the
    // MyPlace card. Open the plan item's editor (same day the sheet wrote to) and confirm the
    // pin is seeded from the resolve — the ItemEditor reads its pin straight from
    // item.lat/item.lng (calendar-planner.tsx), so a populated pin readout is direct proof
    // the persisted plan item itself carries the pin, not just the card.
    //
    // #9 — this block used to sit behind `if (found)`, which made the file's strongest assertion
    // (the resolved coordinates survive all the way into persisted plan state) the FIRST thing to
    // be skipped on the builds most likely to be broken.
    //
    // 🔴 S357B: this assertion changed SHAPE because its subject was deleted, not because it
    // was inconvenient. The pin used to be two text inputs and was read with `toHaveValue`;
    // S357B replaced them with a map picker whose chosen coordinate is echoed on
    // `calendar-editor-pin-value`. The EXPECTED LITERALS are unchanged ('27.7215' / '85.362',
    // the same `String(item.lat)` formatting the inputs carried), and the pin section is
    // reached with one disclosure click rather than by reading a hidden node — so this is
    // strictly the same check on the same values, not a weakened one.
    await page.goto('/plan/', { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid^="calendar-day-"]').first().waitFor({ state: 'attached' });
    await page.getByTestId(`calendar-day-${dayValue}`).click();
    await page.getByRole('button', { name: `Edit ${PLACE_NAME}` }).click();
    const editor = page.getByTestId('calendar-editor');
    await expect(editor).toBeVisible();
    await editor.getByTestId('calendar-editor-more-toggle').click();
    const pinValue = editor.getByTestId('calendar-editor-pin-value');
    await expect(pinValue).toHaveAttribute('data-lat', '27.7215');
    await expect(pinValue).toHaveAttribute('data-lng', '85.362');
    // Close without saving — this is a read-only assertion on what was already persisted.
    await editor.getByTestId('calendar-editor-cancel').click();
    await expect(editor).toBeHidden();
  });
});

test.describe('S349 · resolve outcomes — non-Google rejection, ccTLD allow-list, name-only success (D-243 amendment)', () => {
  test('a non-Google URL shows the rejection line and "Look up" stays disabled', async ({ page }) => {
    await page.goto('/share/', { waitUntil: 'load' });
    await expect(page.getByTestId('share-inbox')).toBeVisible();

    await page.getByTestId('share-paste-link').click();
    await expect(page.getByTestId('import-place-sheet')).toBeVisible();

    await page.getByTestId('import-place-url-input').fill('https://example.com/x');
    await expect(page.getByTestId('import-place-status')).toHaveText(
      "That doesn't look like a Google Maps share link — open the place in Google Maps, tap Share, and paste that link.",
    );
    await expect(page.getByTestId('import-place-lookup')).toBeDisabled();
  });

  test('a google.co.jp /maps/place/ link enables "Look up" (widened allow-list)', async ({ page }) => {
    await page.goto('/share/', { waitUntil: 'load' });
    await expect(page.getByTestId('share-inbox')).toBeVisible();

    await page.getByTestId('share-paste-link').click();
    await expect(page.getByTestId('import-place-sheet')).toBeVisible();

    await page
      .getByTestId('import-place-url-input')
      .fill('https://www.google.co.jp/maps/place/Kinkaku-ji/@35.0394,135.7292,17z');
    await expect(page.getByTestId('import-place-lookup')).toBeEnabled();
  });

  test('a resolved link with a name but NO coordinates shows a calm, non-error name-only line', async ({
    page,
  }) => {
    // The D-243 amendment shape: share.google resolves to a bare google.com/search URL with a
    // name and no coordinates anywhere. That is success, not failure.
    await stubResolve(page, {
      ok: true,
      finalUrl: 'https://www.google.com/search?q=Arashiyama+Bamboo+Grove&kgmid=/m/028h3l',
      name: 'Arashiyama Bamboo Grove',
    });
    await page.goto('/share/', { waitUntil: 'load' });
    await expect(page.getByTestId('share-inbox')).toBeVisible();

    await page.getByTestId('share-paste-link').click();
    await expect(page.getByTestId('import-place-sheet')).toBeVisible();
    await page.getByTestId('import-place-url-input').fill(GOOGLE_URL);
    await page.getByTestId('import-place-lookup').click();

    const status = page.getByTestId('import-place-status');
    await expect(status).toContainText('no map pin came with this link', { timeout: 12_000 });
    await expect(status).toContainText('Found this place');
    // Not styled as a warning/error — the amber tone is reserved for notfound/invalid-link.
    await expect(status).not.toHaveClass(/amber/);
    await expect(page.getByTestId('import-place-name-input')).toHaveValue('Arashiyama Bamboo Grove');
  });
});

test.describe('S285 · place import — resolution failure degrades to a working manual import (never a dead end)', () => {
  test('a 500 from /resolve lands the sheet in manual mode and a hand-typed place still imports', async ({
    page,
  }) => {
    const hits = await stubResolve(page, { ok: false }, 500);
    await page.goto('/share/', { waitUntil: 'load' });
    await expect(page.getByTestId('share-inbox')).toBeVisible();

    await page.getByTestId('share-paste-link').click();
    await expect(page.getByTestId('import-place-sheet')).toBeVisible();
    await page.getByTestId('import-place-url-input').fill(GOOGLE_URL);
    await page.getByTestId('import-place-lookup').click();

    // #9 — this test is the one that most needed the check, because "manual mode" is what a
    // dormant build produces ANYWAY: it used to read "whether the fetch 500'd (wired) or never
    // fired (dormant), the terminal state is manual", i.e. it asserted the degraded state without
    // ever establishing that anything degraded. `hits.count` proves the 500 came off the wire.
    const found = await waitResolveTerminal(page);
    expect(hits.count, NOT_WIRED).toBeGreaterThan(0);
    expect(found).toBe(false);
    await expect(page.getByTestId('import-place-status')).toHaveText(/Couldn't read this link/);

    // The name is empty (nothing to pre-fill) — the user types it and imports anyway.
    await expect(page.getByTestId('import-place-name-input')).toHaveValue('');
    await page.getByTestId('import-place-name-input').fill('Manual Momo Spot');
    await page.getByTestId('import-place-leg-nepal').click();
    await page.getByTestId('import-place-confirm').click();
    await expect(page.getByTestId('import-place-sheet')).toHaveCount(0);

    await page.goto('/nepal/', { waitUntil: 'load' });
    await expect(page.getByTestId('my-places-grid-nepal')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Manual Momo Spot')).toBeVisible();
  });
});

test.describe('S285 · inbox rows — "Import as place" only on Google-host links', () => {
  test('a maps.app.goo.gl row shows the button; a non-Google row does not; import removes the row', async ({
    page,
  }) => {
    const hits = await stubResolve(page, RESOLVE_OK);

    // Receive a Google-host share (the receiver adds one item per navigation).
    await page.goto(`/share/?title=Cool%20place&url=${encodeURIComponent(GOOGLE_URL)}`, { waitUntil: 'load' });
    await expect(page.getByTestId('share-inbox')).toBeVisible();
    await expect(page.locator('li[data-testid^="share-item-"]')).toHaveCount(1);

    // Receive a non-Google share (fresh load → the session-dedupe resets, so this adds a 2nd row).
    await page.goto('/share/?title=Not%20maps&url=https://example.com/somewhere', { waitUntil: 'load' });
    await expect(page.locator('li[data-testid^="share-item-"]')).toHaveCount(2);

    // Exactly ONE import button — on the Google row, not the example row.
    const importButtons = page.locator('[data-testid^="share-item-import-"]');
    await expect(importButtons).toHaveCount(1);
    await expect(page.locator('li', { hasText: 'maps.app.goo.gl' }).locator('[data-testid^="share-item-import-"]')).toHaveCount(1);
    await expect(page.locator('li', { hasText: 'example.com' }).locator('[data-testid^="share-item-import-"]')).toHaveCount(0);

    // Importing from the row: the seeded sheet opens, AUTO-resolves (no "Look up" click — the
    // inbox path fires the resolve itself, which is the wiring this test exists to prove), and on
    // a successful save the SOURCE ROW is removed.
    await importButtons.first().click();
    await expect(page.getByTestId('import-place-sheet')).toBeVisible();
    // The seeded URL is shown read-only (paste mode is off for the inbox path).
    await expect(page.getByTestId('import-place-url-readonly')).toContainText('maps.app.goo.gl');

    // #9 — was `if (!found) fill the name by hand`, so a dormant build silently downgraded this to
    // a manual-import test and the auto-resolve was never exercised.
    await assertResolveWired(page, hits);
    await expect(page.getByTestId('import-place-name-input')).toHaveValue(PLACE_NAME);

    await page.getByTestId('import-place-confirm').click();
    await expect(page.getByTestId('import-place-sheet')).toHaveCount(0);

    // The Google row is gone (removed on successful import); only the non-Google row remains.
    await expect(page.locator('li[data-testid^="share-item-"]')).toHaveCount(1);
    await expect(page.locator('[data-testid^="share-item-import-"]')).toHaveCount(0);
    await expect(page.getByText('Not maps')).toBeVisible();
  });
});

test.describe('S285 · import sheet — keyboard a11y (Esc, Tab-trap, focus return) + no console errors', () => {
  test('Esc closes and returns focus to the opener; Tab stays trapped; the console stays clean', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await page.goto('/share/', { waitUntil: 'load' });
    await expect(page.getByTestId('share-inbox')).toBeVisible();

    // Open via the paste button; it becomes the focus-return target.
    const opener = page.getByTestId('share-paste-link');
    await opener.click();
    await expect(page.getByTestId('import-place-sheet')).toBeVisible();

    // Esc closes at the document level and focus returns to the opener (parent-owned, D-021).
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('import-place-sheet')).toHaveCount(0);
    await expect(opener).toBeFocused();

    // Reopen and prove the Tab-trap keeps focus inside the dialog panel. Wait for the sheet's
    // autofocus to land on the URL input first (else the first Tab would move from <body> out into
    // the page chrome and falsely read as "escaped").
    await opener.click();
    await expect(page.getByTestId('import-place-sheet')).toBeVisible();
    await expect(page.getByTestId('import-place-url-input')).toBeFocused();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(
        () => document.activeElement?.closest('[data-testid="import-place-sheet"]') !== null,
      );
      expect(inside).toBe(true);
    }
    // Shift+Tab wraps the other way and stays inside too.
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Shift+Tab');
      const inside = await page.evaluate(
        () => document.activeElement?.closest('[data-testid="import-place-sheet"]') !== null,
      );
      expect(inside).toBe(true);
    }

    // Close via the cancel button, then assert a clean console for the whole interaction.
    await page.getByTestId('import-place-cancel').click();
    await expect(page.getByTestId('import-place-sheet')).toHaveCount(0);
    expect(consoleErrors, `console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  });
});
