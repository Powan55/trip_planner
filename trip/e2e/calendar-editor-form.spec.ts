import { test, expect } from './fixtures';

test.use({ serviceWorkers: 'block' });

async function openEditor(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/plan/', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid^="calendar-day-"]').first().waitFor({ state: 'attached' });
  await page.getByTestId('calendar-add-item').click();
  const editor = page.getByTestId('calendar-editor');
  await expect(editor).toBeVisible();
  return editor;
}

async function savedItems(page: import('@playwright/test').Page, title: string) {
  return page.evaluate((t) => {
    const env = JSON.parse(localStorage.getItem('nepal_japan_itinerary') ?? '{"payload":[]}') as {
      payload: { items: { title: string; durationMinutes?: number }[] }[];
    };
    return env.payload.flatMap((d) => d.items).filter((i) => i.title === t);
  }, title);
}

test('Enter in Title saves the item', async ({ page }) => {
  const editor = await openEditor(page);
  await editor.getByTestId('calendar-editor-title-input').fill('Enter dinner');
  await page.keyboard.press('Enter');
  await expect(editor).toBeHidden();
  await expect(page.getByText('Enter dinner').first()).toBeVisible();
});

test('Enter in Duration saves; Enter in Notes is a newline', async ({ page }) => {
  const editor = await openEditor(page);
  await editor.getByTestId('calendar-editor-title-input').fill('Notes first');
  await editor.getByTestId('calendar-editor-more-toggle').click();
  const notes = editor.getByTestId('calendar-editor-notes-input');
  await notes.fill('a');
  await notes.press('Enter');
  await expect(editor).toBeVisible();
  await expect(notes).toHaveValue('a\n');
  await editor.getByTestId('calendar-editor-duration-input').fill('30');
  await page.keyboard.press('Enter');
  await expect(editor).toBeHidden();
  await expect.poll(async () => (await savedItems(page, 'Notes first')).map((i) => i.durationMinutes)).toEqual([30]);
});

test('Enter with an empty Title does not save', async ({ page }) => {
  const editor = await openEditor(page);
  await editor.getByTestId('calendar-editor-title-input').press('Enter');
  await expect(editor).toBeVisible();
});

test('Enter on a category chip does not submit', async ({ page }) => {
  const editor = await openEditor(page);
  await editor.getByTestId('calendar-editor-title-input').fill('Chip item');
  await editor.getByTestId('calendar-editor-category-food').press('Enter');
  await expect(editor).toBeVisible();
  expect(await savedItems(page, 'Chip item')).toHaveLength(0);
});

test('a double Enter creates exactly one item', async ({ page }) => {
  const editor = await openEditor(page);
  await editor.getByTestId('calendar-editor-title-input').fill('Once only');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(editor).toBeHidden();
  await expect.poll(async () => (await savedItems(page, 'Once only')).length).toBe(1);
});

test('Save is on screen at 360x640 without scrolling', async ({ page }) => {
  const editor = await openEditor(page);
  const save = editor.getByTestId('calendar-editor-save');
  await expect
    .poll(async () => {
      const box = await save.boundingBox();
      return box ? box.y + box.height : Infinity;
    })
    .toBeLessThanOrEqual(640);
});

test('scrim tap closes a pristine editor but keeps typed input', async ({ page }) => {
  const editor = await openEditor(page);
  const title = editor.getByTestId('calendar-editor-title-input');
  await title.fill('Test dinner');
  await page.mouse.click(5, 5);
  await expect(editor).toBeVisible();
  await expect(title).toHaveValue('Test dinner');

  await title.fill('');
  await page.mouse.click(5, 5);
  await expect(editor).toBeHidden();
});

test('a drag from a field onto the scrim does not close the editor', async ({ page }) => {
  const editor = await openEditor(page);
  const box = (await editor.getByTestId('calendar-editor-title-input').boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(5, 5);
  await page.mouse.up();
  await expect(editor).toBeVisible();
});
