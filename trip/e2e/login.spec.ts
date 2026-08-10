import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * S355 — the marketing landing + the "your key" show-once gate, on the served static `out/` build.
 *
 * D-244 (LOCKED): the landing renders inside `TokenGate`'s logged-out branch at `/` — no new route,
 * no root-layout split. So everything here is scoped to the wall's `[role="dialog"]` panel, which
 * is what a logged-out visitor actually sees.
 *
 * 🔴 SCOPE NOTE, so this pack cannot be misread as proving more than it does: with no guest mode
 * (D-241) the wall is a full-viewport OVERLAY, and `app/layout.tsx` still mounts `{children}`
 * underneath it. "The landing shows no trip data" is therefore a claim about the WALL, not about
 * the document — see the last test, which measures the page behind the wall and reports it rather
 * than asserting a guarantee this slice does not make.
 *
 * Proves:
 *   1. A logged-out visit opens on the LANDING (H1 + CTAs), not the auth form, and the wall carries
 *      no trip name / departure date / countdown / itinerary text.
 *   2. Each CTA opens the auth card on the right path, and the D-021 focus trap still holds.
 *   3. The create flow cannot reach [Continue] until "I've saved my key" is ticked.
 *   4. axe: zero serious/critical at 390px and 1440px, and no horizontal overflow at 390.
 *   5. The three S356 screenshot slots exist, named and sized.
 */

const TOUR_SEEN = 'nepal_japan_first_run_tour_seen';
const INSTALL_HINT = 'nepal_japan_install_hint_dismissed';

/** Fresh logged-out visitor — no identity, no key. The wall opens on the landing. */
async function gotoLoggedOut(page: Page, path = '/') {
  await page.addInitScript(
    ({ tour, hint }: { tour: string; hint: string }) => {
      window.localStorage.setItem(tour, '1');
      // S272: the app-wide install toast is `duration: Infinity` and poisons every axe scan.
      window.localStorage.setItem(hint, '1');
    },
    { tour: TOUR_SEEN, hint: INSTALL_HINT },
  );
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
  await expect(page.getByTestId('landing-page')).toBeVisible({ timeout: 15_000 });
}

test.describe('S355 — the logged-out landing', () => {
  test('opens on the landing with the H1 and the three CTAs, not the auth form', async ({
    page,
  }) => {
    await gotoLoggedOut(page);

    // Scoped to the wall ON PURPOSE. `/` has TWO <h1> for a logged-out visitor: this one, and the
    // home hero's "Nepal × Japan" mounted in the DOM behind the overlay (D-241 — the wall covers
    // the viewport, it does not unmount `{children}`). See the FINDING test at the bottom.
    await expect(page.locator('[role="dialog"] h1')).toHaveText(
      'Every day of the trip, in one place.',
    );
    await expect(page.getByTestId('landing-cta-create')).toBeVisible();
    await expect(page.getByTestId('landing-cta-login')).toBeVisible();
    await expect(page.getByTestId('landing-cta-join')).toBeVisible();
    // The auth card is a SECOND view, reached from a CTA — it is not on screen yet.
    await expect(page.getByTestId('token-gate-submit')).toHaveCount(0);
    await expect(page.getByTestId('token-gate-user-token')).toHaveCount(0);
    // The split band and the S356 slots are part of the shipped page, not a later add.
    await expect(page.getByTestId('landing-split-band')).toBeVisible();
  });

  test('the wall carries NO live trip data — no trip name, date, countdown or itinerary text', async ({
    page,
  }) => {
    await gotoLoggedOut(page);
    const wall = page.locator('[role="dialog"]');
    await expect(wall).toHaveCount(1);

    // The boarding-pass header (trip title + live countdown) belongs to the AUTH view only.
    await expect(wall).not.toContainText('Nepal × Japan Journey');
    await expect(wall).not.toContainText('Boarding Pass');
    // No departure date, in any of the shapes the app renders one.
    await expect(wall).not.toContainText('Dec 9');
    await expect(wall).not.toContainText('9 Dec');
    await expect(wall).not.toContainText('December 9');
    // No countdown: the compact countdown's unit labels are absent, and so is any HH:MM:SS run.
    await expect(wall.locator('[role="status"]')).toHaveCount(0);
    expect(await wall.innerText()).not.toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  test('each CTA opens the auth card on the right path', async ({ page }) => {
    await gotoLoggedOut(page);

    await page.getByTestId('landing-cta-login').click();
    await expect(page.getByTestId('token-gate-mode-login')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByTestId('token-gate-user-token')).toBeVisible();
    await expect(page.getByTestId('landing-page')).toHaveCount(0);
  });

  /**
   * S382 (INTAKE-03) — THE MEASURED DEFECT, IN A REAL BROWSER.
   *
   * The deployed site was measured with `localStorage` at 0 keys and found
   * `document.activeElement` = "Create an account". That is the assertion here, inverted.
   *
   * 🔴 Why `activeElement` and nothing weaker: "landing-cta-login is visible" passes on the broken
   * build (it was always visible), and a `bg-primary` class assertion passes on markup no keyboard
   * user ever reaches. Only where focus actually LANDS separates the two builds.
   *
   * Honest note on "0 keys": `gotoLoggedOut` seeds exactly two dismissal flags (the first-run tour
   * and the install toast — the latter is `duration: Infinity` and poisons axe). Neither is read by
   * the front door. The condition that matters — no User Token, no identity — is asserted below
   * rather than assumed, so this cannot silently become a test of a returning device.
   */
  test('S382: a fresh visitor with no User Token gets FOCUS on the log-in CTA', async ({ page }) => {
    await gotoLoggedOut(page);

    const slots = await page.evaluate(() => ({
      syncCode: window.localStorage.getItem('tripPlannerSyncCode'),
      token: window.localStorage.getItem('tripPlannerToken'),
      name: window.localStorage.getItem('tripPlannerUserName'),
    }));
    expect(slots, 'this must be a never-synced device or the test proves nothing').toEqual({
      syncCode: null,
      token: null,
      name: null,
    });

    await expect
      .poll(
        () => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null),
        { message: 'entry focus must land on the log-in CTA', timeout: 10_000 },
      )
      .toBe('landing-cta-login');

    // ...and the very first Enter on arrival therefore opens LOG IN, not signup.
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('token-gate-mode-login')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('token-gate-user-token')).toBeVisible();
  });

  test('S382: signup is still one click away and does not trap a genuinely new user', async ({
    page,
  }) => {
    await gotoLoggedOut(page);
    // One click from the landing.
    await page.getByTestId('landing-cta-create').click();
    await expect(page.getByTestId('token-gate-mode-create')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByTestId('token-gate-name')).toBeVisible();
  });

  test('S382: the shared-trip CTA opens the auth card on log in', async ({ page }) => {
    await gotoLoggedOut(page);
    await page.getByTestId('landing-cta-join').click();
    await expect(page.getByTestId('token-gate-mode-login')).toHaveAttribute('aria-pressed', 'true');
    // ...and create is one click from there too.
    await page.getByTestId('token-gate-mode-create').click();
    await expect(page.getByTestId('token-gate-name')).toBeVisible();
  });

  test('the create CTA opens the auth card on "Create an account"', async ({ page }) => {
    await gotoLoggedOut(page);

    await page.getByTestId('landing-cta-create').click();
    await expect(page.getByTestId('token-gate-mode-create')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByTestId('token-gate-name')).toBeVisible();
  });

  test('the D-021 focus trap still holds on the landing (Tab never escapes the wall)', async ({
    page,
  }) => {
    await gotoLoggedOut(page);
    // Walk a generous number of tabs; every stop must land inside the dialog panel.
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(
        () => document.querySelector('[role="dialog"]')?.contains(document.activeElement) ?? false,
      );
      expect(inside, `Tab #${i + 1} escaped the wall`).toBe(true);
    }
  });

  test('the three S356 screenshot slots are present, named and sized', async ({ page }) => {
    await gotoLoggedOut(page);
    for (const id of ['landing-shot-1', 'landing-shot-2', 'landing-shot-3']) {
      const figure = page.getByTestId(id);
      await expect(figure).toBeVisible();
      // A non-zero, phone-shaped box — so dropping the real screenshot in cannot shift the layout.
      const box = await page.getByTestId(`${id}-slot`).boundingBox();
      expect(box, `${id} has no slot box`).not.toBeNull();
      expect(box!.width).toBeGreaterThan(0);
      expect(box!.height).toBeGreaterThan(box!.width);
      // The caption S356 moves into the image's `alt` is already written and visible.
      await expect(figure.locator('figcaption')).not.toBeEmpty();
    }
  });

  /**
   * S356 — ADDED, not edited. The three assertions above measure the SLOT BOX and were left
   * untouched (rewriting a check to fit new markup is how a check stops meaning anything); this
   * is a separate test for the thing that only became checkable once real rasters landed.
   *
   * What it proves: the <img> inside each slot actually DECODED in the served `out/` build
   * (`naturalWidth > 0`), and it carries a non-empty `alt` that is NOT a copy of the visible
   * <figcaption>. That catches a broken/renamed asset, a basePath mistake (D-024), the known
   * `scripts/serve-out.mjs` gap where `.avif` has no MIME entry — all failures that leave the slot
   * looking like a plain empty box — and the regression of "just reuse the caption as the alt",
   * which axe flags as `image-redundant-alt` at MINOR, i.e. below this pack's blocking threshold.
   *
   * 🔴 WHAT IT CANNOT PROVE, stated so nobody reads a green run as coverage it does not give:
   * that the CONTENT of those images is safe to publish. A raster is opaque to every assertion
   * in this repo — the "no live trip data" test above passes on any string baked into a PNG.
   * The images are safe only because `e2e/landing-shots.spec.ts` seeds a fictional trip, and
   * only a human looking at the pixels can confirm that stayed true.
   */
  test('the three S356 screenshots decode, with alt text that is not the caption', async ({
    page,
  }) => {
    await gotoLoggedOut(page);
    for (const id of ['landing-shot-1', 'landing-shot-2', 'landing-shot-3']) {
      const figure = page.getByTestId(id);
      const caption = ((await figure.locator('figcaption').textContent()) ?? '').trim();
      expect(caption.length).toBeGreaterThan(0);
      // The LQIP blur-up backdrop is aria-hidden; the real image is the other one.
      const img = page.getByTestId(`${id}-slot`).locator('img:not([aria-hidden="true"])');
      await expect(img).toHaveCount(1);
      const alt = ((await img.getAttribute('alt')) ?? '').trim();
      expect(alt.length, `${id} has no alt`).toBeGreaterThan(0);
      // Not a copy of the caption right underneath it — that is axe's `image-redundant-alt`,
      // which is MINOR and therefore invisible to this pack's serious/critical/moderate gate.
      expect(alt, `${id} alt duplicates its figcaption`).not.toBe(caption);
      await img.scrollIntoViewIfNeeded(); // they are loading="lazy"
      await expect(async () => {
        const shot = await img.evaluate((el) => {
          const i = el as HTMLImageElement;
          return { w: i.naturalWidth, h: i.naturalHeight, src: i.currentSrc };
        });
        expect(shot.w, `${id} did not decode`).toBeGreaterThan(0);
        console.log(`  ${id}: ${shot.w}x${shot.h} served from ${shot.src}`);
      }).toPass({ timeout: 15_000 });
    }
  });
});

test.describe('S355 — the show-once save gate', () => {
  test('[Continue] is unreachable until "I\'ve saved my key" is ticked', async ({ page }) => {
    await gotoLoggedOut(page);
    await page.getByTestId('landing-cta-create').click();

    await expect(async () => {
      await page.getByTestId('token-gate-name').fill('Genghis');
      await expect(page.getByTestId('token-gate-submit')).toBeEnabled();
      await page.getByTestId('token-gate-submit').click();
      await expect(page.getByTestId('user-token-show-once')).toBeVisible();
    }).toPass();

    const confirm = page.getByTestId('user-token-show-once-confirm');
    const ack = page.getByTestId('user-token-show-once-ack');

    // The gate: disabled, and a click does nothing (still on the wall, still no navigation).
    await expect(ack).not.toBeChecked();
    await expect(confirm).toBeDisabled();
    await confirm.click({ force: true });
    await expect(page.getByTestId('user-token-show-once')).toBeVisible();
    expect(new URL(page.url()).pathname.replace(/\/$/, '')).toBe('');

    // Tick it → the way forward opens.
    await ack.check();
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await page.waitForURL(/\/trips\/$/, { timeout: 15_000 });
  });

  test('the key is shown in readable groups WITHOUT altering a character of it', async ({
    page,
  }) => {
    await gotoLoggedOut(page);
    await page.getByTestId('landing-cta-create').click();
    await expect(async () => {
      await page.getByTestId('token-gate-name').fill('Genghis');
      await expect(page.getByTestId('token-gate-submit')).toBeEnabled();
      await page.getByTestId('token-gate-submit').click();
      await expect(page.getByTestId('user-token-show-once')).toBeVisible();
    }).toPass();

    // The grouping is CSS gaps between spans, never inserted whitespace: what the user selects and
    // copies by hand has to be a usable key, and token-only auth has no recovery from a broken one.
    const stored = await page.evaluate(() => window.localStorage.getItem('tripPlannerSyncCode'));
    expect(stored).toMatch(/^[0-9a-f-]{36}$/);
    const rendered = await page
      .getByTestId('user-token-show-once-value')
      .evaluate((el) => el.textContent);
    expect(rendered).toBe(stored);
  });
});

test.describe('S355 — landing a11y + responsive', () => {
  for (const width of [390, 1440]) {
    test(`axe: the landing has zero serious/critical/moderate violations at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await gotoLoggedOut(page);

      const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
      // The minimum floor is serious/critical; this pack gates on MODERATE too, matching the house
      // contract in `e2e/a11y.spec.ts` (S157 widened every route to moderate: "fix it or revert —
      // do NOT lower this threshold to go green"). The landing meets the stricter bar, so it is
      // pinned at the stricter bar.
      const blocking = results.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical' || v.impact === 'moderate',
      );
      for (const v of results.violations) {
        const line = `[${v.impact ?? 'n/a'}] ${v.id}: ${v.help} (${v.nodes.length} nodes)`;
        testInfo.annotations.push({ type: `axe:${v.impact ?? 'unknown'}`, description: line });
        console.log(`  axe landing@${width} ${line}`);
      }
      console.log(`axe SUMMARY landing@${width}: serious/critical/moderate=${blocking.length}`);
      expect(
        blocking,
        blocking.map((v) => `${v.id} [${v.impact}] × ${v.nodes.length}`).join('; '),
      ).toEqual([]);
    });
  }

  test('no horizontal overflow at 390 (D-022)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoLoggedOut(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

/**
 * 🔴 OPEN FINDING, recorded so the green pack above cannot be misread as closing it.
 *
 * "A logged-out stranger must not be able to read the trip" is the stated point of the landing, and
 * this slice does NOT achieve it. D-241's wall is a full-viewport OVERLAY and `app/layout.tsx`
 * mounts `{children}` underneath it regardless of identity, so the home dashboard — including an
 * `<h1>` carrying the trip name — is still in the DOM behind the landing and readable via
 * view-source or devtools. That is PRE-EXISTING (it is how the wall has always worked) and unchanged
 * by S355, which is why nothing here asserts a guarantee. It is logged, not asserted: pinning the
 * leak with an assertion would codify it as correct.
 *
 * Closing it needs an architectural call (render `{children}` only when identified, or move the app
 * home off `/`) — out of scope for S355 and squarely against D-244's "no root-layout split".
 */
test('FINDING (log-only) — the DOM behind the wall still carries trip data for a logged-out visitor', async ({
  page,
}) => {
  await gotoLoggedOut(page);
  const behind = await page.evaluate(() => {
    const wall = document.querySelector('[role="dialog"]')?.closest('.fixed');
    const outside = (el: Element) => !wall?.contains(el);
    return {
      headings: Array.from(document.querySelectorAll('h1'))
        .filter(outside)
        .map((el) => (el as HTMLElement).innerText?.trim().slice(0, 80)),
      sample: Array.from(document.querySelectorAll('main, [data-testid]'))
        .filter(outside)
        .map((el) => (el as HTMLElement).innerText?.trim().slice(0, 100))
        .filter(Boolean)
        .slice(0, 8),
    };
  });
  console.log('BEHIND-THE-WALL (pre-existing, not fixed by S355):', JSON.stringify(behind, null, 2));
  expect(behind).toBeTruthy();
});
