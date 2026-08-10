import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * AM/PM time-picker E2E pack (slice S125, D-141/D-138) — the picker's own centerpiece
 * proof: add a time via the hand-rolled picker -> reload -> it renders AM/PM + the
 * day-country badge and survives; a clear -> reload -> the item is untimed. Mirrors
 * persistence.spec.ts's harness conventions exactly (same signed-in fixture,
 * `domcontentloaded` + `waitForPlannerReady` navigation — never `networkidle`, D-093).
 */

const ITINERARY_KEY = 'nepal_japan_itinerary';

// A real trip date inside NEPAL_START..NEPAL_END (matches persistence.spec.ts's
// KNOWN_DAY), so the day-country badge asserted below is deterministically "NPT".
const KNOWN_DAY = '2026-12-11';

async function waitForPlannerReady(page: Page) {
  await page.locator('[data-testid^="calendar-day-"]').first().waitFor({ state: 'visible' });
}

async function gotoSettled(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await waitForPlannerReady(page);
}

async function reloadSettled(page: Page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForPlannerReady(page);
}

async function typeEditorTitle(page: Page, title: string) {
  const input = page.getByTestId('calendar-editor-title-input');
  await input.pressSequentially(title, { delay: 10 });
  await page.mouse.wheel(0, -5000);
}

test.describe('S125 — AM/PM time picker: set + reload', () => {
  test('adding a time via the picker renders AM/PM + the NPT badge and survives reload', async ({ page }) => {
    const uniqueTitle = `S125 picker-set ${Date.now()}`;

    await gotoSettled(page, '/plan/');
    await page.getByTestId(`calendar-day-${KNOWN_DAY}`).click();
    await page.getByTestId('calendar-add-item').click();
    await expect(page.getByTestId('calendar-editor')).toBeVisible();
    await typeEditorTitle(page, uniqueTitle);

    // Open the picker — no native input[type=time] anywhere (D-141).
    await expect(page.locator('input[type="time"]')).toHaveCount(0);
    const trigger = page.getByTestId('calendar-editor-time-input');
    await expect(trigger).toHaveText('Add time');
    await trigger.click();
    const panel = page.getByTestId('time-picker-panel');
    await expect(panel).toBeVisible();

    // D-021 focus-in: focus lands inside the panel on open (the Hour column's
    // currently-selected option, the picker's default 9:00 AM position).
    await expect(panel.locator(':focus')).toHaveCount(1);

    // Pick 3:15 PM — full 00-59 minute selectable (D-141: no 5-min grid).
    await page.getByTestId('time-picker-hour-3').click();
    await page.getByTestId('time-picker-minute-15').click();
    await page.getByTestId('time-picker-period-PM').click();
    await expect(trigger).toHaveText('3:15 PM');

    await page.getByTestId('time-picker-done').click();
    await expect(panel).toHaveCount(0);
    // D-021 focus-out: focus returns to the trigger once the picker's exit
    // animation completes.
    await expect(trigger).toBeFocused();

    await page.getByTestId('calendar-editor-save').click();
    await expect(page.getByTestId('calendar-editor')).toHaveCount(0);

    const card = page.locator('[data-testid^="calendar-item-"]').filter({ hasText: uniqueTitle });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('3:15 PM');
    const idSuffix = (await card.getAttribute('data-testid'))!.replace('calendar-item-', '');
    await expect(page.getByTestId(`calendar-item-time-badge-${idSuffix}`)).toHaveText('NPT');

    // The D-138 dual-write: both fields land on disk, not just one.
    const stored = await page.evaluate((key) => window.localStorage.getItem(key), ITINERARY_KEY);
    const parsed = JSON.parse(stored as string);
    const dayPlan = parsed.payload.find((p: { date: string }) => p.date === KNOWN_DAY);
    const item = (dayPlan.items ?? []).find((i: { id: string }) => i.id === idSuffix);
    expect(item.time).toBe('15:15');
    expect(item.startMinutes).toBe(915); // 3:15 PM = 15*60+15

    await reloadSettled(page);
    await page.getByTestId(`calendar-day-${KNOWN_DAY}`).click();
    const cardAfterReload = page.locator(`[data-testid="calendar-item-${idSuffix}"]`);
    await expect(cardAfterReload).toContainText('3:15 PM');
    await expect(page.getByTestId(`calendar-item-time-badge-${idSuffix}`)).toHaveText('NPT');
  });

  test('clearing a time via the picker survives reload as untimed', async ({ page }) => {
    const uniqueTitle = `S125 picker-clear ${Date.now()}`;

    await gotoSettled(page, '/plan/');
    await page.getByTestId(`calendar-day-${KNOWN_DAY}`).click();
    await page.getByTestId('calendar-add-item').click();
    await typeEditorTitle(page, uniqueTitle);

    await page.getByTestId('calendar-editor-time-input').click();
    await page.getByTestId('time-picker-hour-9').click();
    await page.getByTestId('time-picker-minute-30').click();
    await page.getByTestId('time-picker-period-AM').click();
    await page.getByTestId('time-picker-done').click();
    await page.getByTestId('calendar-editor-save').click();
    await expect(page.getByTestId('calendar-editor')).toHaveCount(0);

    let card = page.locator('[data-testid^="calendar-item-"]').filter({ hasText: uniqueTitle });
    await expect(card).toContainText('9:30 AM');
    const idSuffix = (await card.getAttribute('data-testid'))!.replace('calendar-item-', '');

    // Re-open and clear.
    await page.mouse.wheel(0, -5000);
    await page.getByTestId(`calendar-item-edit-${idSuffix}`).click();
    await expect(page.getByTestId('calendar-editor')).toBeVisible();
    const trigger = page.getByTestId('calendar-editor-time-input');
    await expect(trigger).toHaveText('9:30 AM');
    await trigger.click();
    await expect(page.getByTestId('time-picker-panel')).toBeVisible();
    await page.getByTestId('time-picker-clear').click();
    await expect(page.getByTestId('time-picker-panel')).toHaveCount(0);
    await expect(trigger).toHaveText('Add time');

    await page.getByTestId('calendar-editor-save').click();
    await expect(page.getByTestId('calendar-editor')).toHaveCount(0);

    card = page.locator(`[data-testid="calendar-item-${idSuffix}"]`);
    await expect(card).not.toContainText('9:30 AM');
    await expect(page.getByTestId(`calendar-item-time-badge-${idSuffix}`)).toHaveCount(0);

    const stored = await page.evaluate((key) => window.localStorage.getItem(key), ITINERARY_KEY);
    const parsed = JSON.parse(stored as string);
    const dayPlan = parsed.payload.find((p: { date: string }) => p.date === KNOWN_DAY);
    const item = (dayPlan.items ?? []).find((i: { id: string }) => i.id === idSuffix);
    expect(item.time).toBeUndefined();
    expect(item.startMinutes).toBeUndefined();

    await reloadSettled(page);
    await page.getByTestId(`calendar-day-${KNOWN_DAY}`).click();
    const cardAfterReload = page.locator(`[data-testid="calendar-item-${idSuffix}"]`);
    await expect(cardAfterReload).toBeVisible();
    await expect(cardAfterReload).not.toContainText('9:30 AM');
    await expect(page.getByTestId(`calendar-item-time-badge-${idSuffix}`)).toHaveCount(0);
  });

  test('the open picker keyboard: arrow keys move within a column, Escape closes only the picker', async ({ page }) => {
    await gotoSettled(page, '/plan/');
    await page.getByTestId(`calendar-day-${KNOWN_DAY}`).click();
    await page.getByTestId('calendar-add-item').click();
    await expect(page.getByTestId('calendar-editor')).toBeVisible();

    await page.getByTestId('calendar-editor-time-input').click();
    const panel = page.getByTestId('time-picker-panel');
    await expect(panel).toBeVisible();

    // Default position is 9:00 AM — Hour column's selected option (9) has focus.
    const hour9 = page.getByTestId('time-picker-hour-9');
    await expect(hour9).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('time-picker-hour-10')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(page.getByTestId('time-picker-hour-1')).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.getByTestId('time-picker-hour-12')).toBeFocused();

    // Escape closes ONLY the picker — the parent editor stays open (the picker's
    // Esc handler stops propagation before it reaches the editor's own document-
    // level Esc listener, D-021).
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(page.getByTestId('calendar-editor')).toBeVisible();
  });

  test('the picker panel is itself axe-clean (0 serious/critical)', async ({ page }) => {
    await gotoSettled(page, '/plan/');
    await page.getByTestId(`calendar-day-${KNOWN_DAY}`).click();
    await page.getByTestId('calendar-add-item').click();
    await page.getByTestId('calendar-editor-time-input').click();
    const panel = page.getByTestId('time-picker-panel');
    await expect(panel).toBeVisible();
    // Wait for the open FADE to fully settle before scanning: axe samples COMPUTED colors,
    // and the selected option mid-opacity-fade composites to a lower-contrast blend over the
    // dark backdrop (a false serious color-contrast hit — same mid-animation sampling class as
    // the hero CTA flake). S353B: the selected option moved off gold-500 onto the chrome accent
    // (`bg-primary text-primary-foreground`); at rest that measures rgb(61,217,245) on
    // rgb(11,12,14) = 11.59:1 (browser-measured), so the at-rest state
    // has MORE headroom than the ~8:1 gold it replaced — the wait is still about the fade.
    await expect(panel).toHaveCSS('opacity', '1');

    const results = await new AxeBuilder({ page })
      .include('[data-testid="time-picker-panel"]')
      .analyze();
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });

  test('duration entry dual-writes durationMinutes + a canonical text, and survives reload', async ({ page }) => {
    const uniqueTitle = `S125 duration-set ${Date.now()}`;

    await gotoSettled(page, '/plan/');
    await page.getByTestId(`calendar-day-${KNOWN_DAY}`).click();
    await page.getByTestId('calendar-add-item').click();
    await typeEditorTitle(page, uniqueTitle);

    // S357A: Duration moved behind the editor's "More details" disclosure — Title, Category
    // and Time are the only fields open on load. Time itself is unaffected (it stays visible).
    await page.getByTestId('calendar-editor-more-toggle').click();
    const durationInput = page.getByTestId('calendar-editor-duration-input');
    await durationInput.fill('90');
    await page.getByTestId('calendar-editor-save').click();
    await expect(page.getByTestId('calendar-editor')).toHaveCount(0);

    const card = page.locator('[data-testid^="calendar-item-"]').filter({ hasText: uniqueTitle });
    await expect(card).toContainText('1h 30m');
    const idSuffix = (await card.getAttribute('data-testid'))!.replace('calendar-item-', '');

    const stored = await page.evaluate((key) => window.localStorage.getItem(key), ITINERARY_KEY);
    const parsed = JSON.parse(stored as string);
    const dayPlan = parsed.payload.find((p: { date: string }) => p.date === KNOWN_DAY);
    const item = (dayPlan.items ?? []).find((i: { id: string }) => i.id === idSuffix);
    expect(item.duration).toBe('1h 30m');
    expect(item.durationMinutes).toBe(90);

    await reloadSettled(page);
    await page.getByTestId(`calendar-day-${KNOWN_DAY}`).click();
    await expect(page.locator(`[data-testid="calendar-item-${idSuffix}"]`)).toContainText('1h 30m');
  });
});
