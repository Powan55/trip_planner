import { test, expect } from './fixtures';

// Focus behavior is independent of offline caching. Avoid a newly installed SW
// racing the static island's first load across successive browser contexts.
test.use({ serviceWorkers: 'block' });

const day = '2026-12-09';
const existingItem = { id: 'focus-trap-item', title: 'Museum visit', category: 'sightseeing' };

for (const [name, width] of [['phone', 360], ['desktop', 1280]] as const) {
  for (const mode of ['add', 'edit'] as const) {
    test(`${mode} item dialog traps Tab at ${name} width`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/plan/', { waitUntil: 'domcontentloaded' });
      await page.locator('[data-testid^="calendar-day-"]').first().waitFor({ state: 'attached' });

      if (mode === 'edit') {
        await page.evaluate(({ day, item }) => {
          localStorage.setItem('nepal_japan_itinerary', JSON.stringify([
            { date: day, city: 'Kathmandu', country: 'nepal', items: [item] },
          ]));
        }, { day, item: existingItem });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('[data-testid^="calendar-day-"]').first().waitFor({ state: 'attached' });
        await page.getByTestId(`calendar-item-edit-${existingItem.id}`).click();
      } else {
        await page.getByTestId('calendar-add-item').click();
      }

      const editor = page.getByTestId('calendar-editor');
      const close = editor.getByTestId('calendar-editor-cancel');
      const title = editor.getByTestId('calendar-editor-title-input');
      const more = editor.getByTestId('calendar-editor-more-toggle');
      const details = editor.getByTestId('calendar-editor-more');
      const save = editor.getByTestId('calendar-editor-save');

      await expect(editor).toBeVisible();
      await title.fill('');
      await expect(save).toBeEnabled();
      await expect(details).not.toHaveAttribute('open');

      // Closed disclosure descendants must not become phantom last Tab stops.
      await more.focus();
      await page.keyboard.press('Tab');
      await expect(save).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(close).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Shift+Tab');
      await expect(more).toBeFocused();

      // Opening the disclosure adds its fields to the same cycle.
      await more.press('Enter');
      await expect(details).toHaveAttribute('open');
      await page.keyboard.press('Tab');
      await expect(editor.getByTestId('calendar-editor-duration-input')).toBeFocused();
      await close.focus();
      await page.keyboard.press('Shift+Tab');
      await expect(save).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(editor.getByTestId('calendar-editor-notes-input')).toBeFocused();

      await title.fill('Updated visit');
      await save.focus();
      await page.keyboard.press('Tab');
      await expect(close).toBeFocused();
    });
  }
}

test('Save with an empty title explains itself and focuses the field', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/plan/', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid^="calendar-day-"]').first().waitFor({ state: 'attached' });
  await page.getByTestId('calendar-add-item').click();
  const editor = page.getByTestId('calendar-editor');
  const title = editor.getByTestId('calendar-editor-title-input');
  await title.fill('');
  await editor.getByTestId('calendar-editor-save').click();
  await expect(editor.getByTestId('calendar-editor-clash-error')).toHaveText('Add a title to save');
  await expect(title).toBeFocused();
  await expect(editor).toBeVisible();
  await title.fill('x');
  await expect(editor.getByTestId('calendar-editor-clash-error')).toHaveText('');
});
