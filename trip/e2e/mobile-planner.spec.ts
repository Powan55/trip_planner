import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * S131 — mobile ItemEditor bottom-sheet + swipe-to-delete E2E pack (dormant `out/` build).
 *
 * Two additive mobile ergonomics, proven on a real run:
 *   1. Bottom-sheet: on `<lg` the ItemEditor opens ANCHORED TO THE BOTTOM (slide-up sheet),
 *      stays a focus-trapped `role=dialog` portaled to <body> (open → focus in → Esc →
 *      focus restored); on `lg+` it stays the CENTERED panel.
 *   2. Swipe-to-delete: a horizontal left-swipe on a row body routes through the EXISTING
 *      delete→undo handler (S127) — deleted → Undo toast → Undo restores → reload persists.
 *      The visible Delete button still deletes (the non-gesture a11y path), and the swipe is
 *      gated so it never hijacks the grip's dnd drag or native vertical scroll (keyboard
 *      reorder still swaps order; a vertical gesture on the body does NOT delete).
 *
 * Settle discipline mirrors persistence.spec.ts / quick-add-duplicate.spec.ts: navigate to
 * `domcontentloaded`, then block on the lazy island's `calendar-day-*` grid — never
 * `networkidle` (the production SW precaches ~112 entries, so the network never goes quiet).
 */

const ITINERARY_KEY = 'nepal_japan_itinerary';
const FIXTURE_DAY = '2026-12-20';
const PHONE = { width: 390, height: 844 } as const; // iPhone 12/13/14 logical size (< lg 1024)
const DESKTOP = { width: 1280, height: 900 } as const; // > lg

async function waitForPlannerReady(page: Page) {
  // Island-mounted signal = the `calendar-day-*` grid exists (replaces the skeleton).
  // Wait for ATTACHED, not visible: on `<lg` the month grid is collapsed behind the
  // day-strip so the cells are hidden-but-present — visible would time out on mobile.
  await page.locator('[data-testid^="calendar-day-"]').first().waitFor({ state: 'attached' });
}
async function gotoPlan(page: Page) {
  await page.goto('/plan/', { waitUntil: 'domcontentloaded' });
  await waitForPlannerReady(page);
}
async function reloadPlan(page: Page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForPlannerReady(page);
}

/** Seed one controlled DayPlan on FIXTURE_DAY (bypassing the 32-day sample) and reload. */
async function seedFixture(page: Page, items: Array<{ id: string; title: string }>) {
  await page.evaluate(
    ({ key, date, items }: { key: string; date: string; items: Array<{ id: string; title: string }> }) => {
      const dayPlan = {
        date,
        city: 'Tokyo',
        country: 'japan',
        items: items.map((i) => ({ id: i.id, title: i.title, category: 'sightseeing' })),
      };
      window.localStorage.setItem(key, JSON.stringify([dayPlan]));
    },
    { key: ITINERARY_KEY, date: FIXTURE_DAY, items },
  );
  await reloadPlan(page);
}

/** The rendered rows' item ids, in DOM order (one `calendar-row-swipe-*` node per row). */
async function rowIds(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid^="calendar-row-swipe-"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.replace('calendar-row-swipe-', '')));
}

/**
 * Drive a TOUCH pointer gesture on a row body by dispatching real PointerEvents (Playwright's
 * `page.mouse` is pointerType:'mouse', which the handler ignores by design — the Delete button
 * is the pointer path). `dy` lets us fire a VERTICAL gesture too (should be released to scroll,
 * NOT treated as a swipe).
 */
async function swipe(page: Page, testId: string, dx: number, dy = 0) {
  const el = page.getByTestId(testId);
  const box = await el.boundingBox();
  if (!box) throw new Error(`no bounding box for ${testId}`);
  const startX = box.x + box.width - 16;
  const startY = box.y + box.height / 2;
  const at = (fx: number, fy: number) => ({
    pointerType: 'touch',
    pointerId: 1,
    isPrimary: true,
    button: 0,
    clientX: startX + fx,
    clientY: startY + fy,
    bubbles: true,
    cancelable: true,
  });
  await el.dispatchEvent('pointerdown', at(0, 0));
  await el.dispatchEvent('pointermove', at(Math.sign(dx) * 12, Math.sign(dy) * 12));
  await el.dispatchEvent('pointermove', at(dx / 2, dy / 2));
  await el.dispatchEvent('pointermove', at(dx, dy));
  await el.dispatchEvent('pointerup', at(dx, dy));
}

test.describe('S131 · ItemEditor bottom-sheet', () => {
  test('mobile (<lg): opens bottom-anchored, focus-trapped dialog, portal-to-body, Esc restores focus', async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await gotoPlan(page);

    const addBtn = page.getByTestId('calendar-add-item');
    await addBtn.scrollIntoViewIfNeeded();
    await addBtn.click();

    const editor = page.getByTestId('calendar-editor');
    await expect(editor).toBeVisible();

    // role=dialog + aria-modal contract intact.
    await expect(editor).toHaveAttribute('role', 'dialog');
    await expect(editor).toHaveAttribute('aria-modal', 'true');

    // Portal-to-body (D-069/FU-11): the panel is NOT inside the itinerary section.
    const insideSection = await editor.evaluate((el) => el.closest('#itinerary') !== null);
    expect(insideSection).toBe(false);

    // Bottom-anchored: the panel's bottom edge is flush with the viewport bottom (a
    // centered modal would leave an equal gap below). The tall editor content fills most
    // of the height (max-h-90vh), so "flush bottom" — not "empty top half" — is the signal.
    const box = (await editor.boundingBox())!;
    expect(box.y + box.height).toBeGreaterThan(PHONE.height - 4); // flush to the bottom
    // Rounded TOP corners (sheet), not the all-round centered panel.
    const topRadius = await editor.evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
    expect(parseFloat(topRadius)).toBeGreaterThan(0);

    // Focus moved INTO the dialog (title input autofocus).
    await expect(page.getByTestId('calendar-editor-title-input')).toBeFocused();

    // Esc closes and focus returns to the trigger.
    await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);
    await expect(addBtn).toBeFocused();
  });

  test('desktop (lg+): opens as the centered panel (not bottom-anchored)', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await gotoPlan(page);

    await page.getByTestId('calendar-add-item').click();
    const editor = page.getByTestId('calendar-editor');
    await expect(editor).toBeVisible();

    const box = (await editor.boundingBox())!;
    const centerY = box.y + box.height / 2;
    // Centered: its vertical mid-point is near the viewport centre and it is NOT flush to
    // the bottom edge (which the bottom-sheet variant would be).
    expect(Math.abs(centerY - DESKTOP.height / 2)).toBeLessThan(DESKTOP.height * 0.2);
    expect(box.y + box.height).toBeLessThan(DESKTOP.height - 20);
  });
});

test.describe('S357B · the quick-add time hint is legible at 390px', () => {
  /**
   * S357A cut the "try 7pm dinner" hint out of the composer placeholder because at 390px it
   * truncated MID-WORD, and moved it into the accessible name — which left the syntax with no
   * visible affordance at all on the mobile-first surface whose whole value is that syntax.
   * S357B put it back as its own line under the input.
   *
   * 🔴 This is measured as GEOMETRY, deliberately. A text assertion (`toContainText`) cannot
   * see a CSS ellipsis: `innerText`/`textContent` return the full string whether or not a
   * single pixel of it reached the user. `scrollWidth > clientWidth` is the condition under
   * which content is clipped, so asserting the negation is the check that a text assertion
   * cannot fake.
   */
  test('the hint fits the 390px viewport without clipping (scrollWidth vs clientWidth)', async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await gotoPlan(page);

    const hint = page.getByTestId('calendar-quick-add-hint');
    await expect(hint).toBeVisible();

    const geo = await hint.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        left: r.left,
        right: r.right,
        textOverflow: cs.textOverflow,
        whiteSpace: cs.whiteSpace,
        fontSize: cs.fontSize,
      };
    });

    // Not clipped horizontally or vertically: every glyph is inside the box that renders it.
    expect(geo.scrollWidth).toBeLessThanOrEqual(geo.clientWidth);
    expect(geo.scrollHeight).toBeLessThanOrEqual(geo.clientHeight);
    // And the box itself is inside the phone viewport (no horizontal overflow of the page).
    expect(geo.left).toBeGreaterThanOrEqual(0);
    expect(geo.right).toBeLessThanOrEqual(PHONE.width);
    // No ellipsis machinery is in play at all — if wrapping were ever traded for `truncate`,
    // the two size checks above would still pass while a real phone showed "…".
    expect(geo.textOverflow).toBe('clip');
    expect(geo.whiteSpace).not.toBe('nowrap');
    // The syntax it advertises is actually named.
    await expect(hint).toContainText('7pm dinner');
  });

  test('the composer row itself does not overflow 390px', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await gotoPlan(page);

    const input = page.getByTestId('calendar-quick-add');
    const details = page.getByTestId('calendar-add-item');
    for (const el of [input, details]) {
      const box = (await el.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width);
    }
    // The document never scrolls sideways at this width (D-022 min-w-0 discipline).
    const docScroll = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(docScroll.scrollWidth).toBeLessThanOrEqual(docScroll.clientWidth);
  });
});

test.describe('S131 · swipe-to-delete (routes through the S127 delete→undo handler)', () => {
  test('horizontal swipe deletes → Undo toast restores → reload persists', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await gotoPlan(page);
    await seedFixture(page, [
      { id: 's131-a', title: 'Swipe Alpha' },
      { id: 's131-b', title: 'Swipe Bravo' },
    ]);
    await page.getByTestId(`day-strip-${FIXTURE_DAY}`).click();
    await expect(page.getByTestId('calendar-item-s131-a')).toBeVisible();

    // Left-swipe past the 96px threshold → delete.
    await swipe(page, 'calendar-row-swipe-s131-a', -170);
    await expect(page.getByTestId('calendar-item-s131-a')).toHaveCount(0);

    // Same delete→undo as the Delete button (S127): a sonner "Undo" toast restores it.
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByTestId('calendar-item-s131-a')).toBeVisible();

    // Reload — the restore persisted (dormant `out/` = same-id re-add, D-038).
    await reloadPlan(page);
    await page.getByTestId(`day-strip-${FIXTURE_DAY}`).click();
    await expect(page.getByTestId('calendar-item-s131-a')).toBeVisible();
  });

  test('a short/vertical gesture does NOT delete (scroll + drag not hijacked)', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await gotoPlan(page);
    await seedFixture(page, [
      { id: 's131-a', title: 'Swipe Alpha' },
      { id: 's131-b', title: 'Swipe Bravo' },
    ]);
    await page.getByTestId(`day-strip-${FIXTURE_DAY}`).click();
    await expect(page.getByTestId('calendar-item-s131-a')).toBeVisible();

    // A VERTICAL gesture (the scroll case) must be released to the browser, not swiped.
    await swipe(page, 'calendar-row-swipe-s131-a', -8, -120);
    await expect(page.getByTestId('calendar-item-s131-a')).toBeVisible();

    // A short horizontal nudge (below threshold) snaps back, no delete.
    await swipe(page, 'calendar-row-swipe-s131-a', -40);
    await expect(page.getByTestId('calendar-item-s131-a')).toBeVisible();
  });

  test('the visible Delete button still deletes (non-gesture a11y/keyboard path)', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await gotoPlan(page);
    await seedFixture(page, [{ id: 's131-a', title: 'Swipe Alpha' }]);
    await page.getByTestId(`day-strip-${FIXTURE_DAY}`).click();
    await expect(page.getByTestId('calendar-item-s131-a')).toBeVisible();

    await page.getByTestId('calendar-item-delete-s131-a').click();
    await expect(page.getByTestId('calendar-item-s131-a')).toHaveCount(0);
  });

  test('keyboard reorder still works (dnd drag not hijacked by the swipe)', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await gotoPlan(page);
    await seedFixture(page, [
      { id: 's131-a', title: 'Swipe Alpha' },
      { id: 's131-b', title: 'Swipe Bravo' },
    ]);
    await page.getByTestId(`calendar-day-${FIXTURE_DAY}`).click();
    expect(await rowIds(page)).toEqual(['s131-a', 's131-b']);

    // Keyboard dnd (dnd-kit KeyboardSensor): focus the grip, Space to pick up, ArrowDown to
    // move past the next item, Space to drop. Order must swap — proving the grip still owns
    // drag and the row-body swipe never intercepted it.
    await page.getByRole('button', { name: 'Reorder Swipe Alpha' }).focus();
    await page.keyboard.press('Space'); // pick up (dnd-kit announces + measures droppables)
    await page.waitForTimeout(150);
    await page.keyboard.press('ArrowDown'); // move past the next item
    await page.waitForTimeout(150);
    await page.keyboard.press('Space'); // drop

    await expect.poll(() => rowIds(page), { timeout: 8000 }).toEqual(['s131-b', 's131-a']);
  });
});
