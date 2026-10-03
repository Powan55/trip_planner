import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** #755: one unbroken pasted string must not widen the page past a 393px phone viewport. */

const URL89 = 'https://maps.app.goo.gl/' + 'aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3zA5bC7dE9fG1hJ3kL5mN7pQ9r'.slice(0, 65);
const WORD = 'Supercalifragilisticexpialidocious'.repeat(3);
const TOKEN = '11111111-2222-4333-8444-555566667777';
const DAY = '2026-12-12';

async function seed(page: Page, custom: boolean) {
  await page.addInitScript(
    ({ url, word, token, day, custom }) => {
      const ls = window.localStorage;
      ls.setItem('tripPlannerToken', 'Powan');
      ls.setItem('tripPlannerUserName', 'Powan');
      ls.setItem('nepal_japan_first_run_tour_seen', '1');
      ls.setItem('nepal_japan_install_hint_dismissed', '1');
      ls.setItem(
        'nepal_japan_itinerary',
        JSON.stringify([
          {
            date: day,
            city: 'Kathmandu',
            country: 'nepal',
            items: [{ id: 'lt-1', title: 'Boudhanath', category: 'photography', time: '06:00', duration: url, location: url }],
          },
        ]),
      );
      ls.setItem(
        'nepal_japan_expenses',
        JSON.stringify([
          { id: 'lt-e', leg: 'nepal', category: 'food', amount: 100, note: url, createdAt: '2026-12-10T00:00:00.000Z' },
        ]),
      );
      if (custom) {
        ls.setItem('tripPlannerActiveTrip', token);
        ls.setItem(
          'tripPlannerKnownTrips',
          JSON.stringify([
            {
              id: token,
              name: 'Long Escape',
              joinedAt: Date.now(),
              config: { start: '2027-05-10', end: '2027-05-12', destinations: [word, 'Sampleburg'], vibe: 'beach', updatedAt: Date.now() },
            },
          ]),
        );
      }
    },
    { url: URL89, word: WORD, token: TOKEN, day: DAY, custom },
  );
}

const overflow = async (page: Page) => {
  const r = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const clipped = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (getComputedStyle(p).overflowX !== 'visible') return true;
      }
      return false;
    };
    const wide = [...document.querySelectorAll('body *')]
      .filter((el) => el.getBoundingClientRect().right > vw + 1 && !clipped(el))
      .slice(0, 6)
      .map((el) => `${el.tagName}.${String(el.className).slice(0, 60)} ${el.closest('[data-testid]')?.getAttribute('data-testid') ?? ''} "${(el.textContent ?? '').slice(0, 30)}"`);
    return { over: document.documentElement.scrollWidth - vw, wide };
  });
  if (r.over > 0) console.log('OFFENDERS', JSON.stringify(r.wide));
  return r.over;
};

test.describe('#755 long unbroken text stays inside the viewport', () => {
  test.use({ viewport: { width: 393, height: 852 }, reducedMotion: 'reduce' });

  test('/plan/ with a long location', async ({ page }) => {
    await seed(page, false);
    await page.goto(`/plan/?today=${DAY}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(URL89).first()).toBeAttached();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test('/plan/ expense row wraps a long note', async ({ page }) => {
    await seed(page, false);
    await page.goto(`/plan/?today=${DAY}`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('budget-view-tab-expenses').click();
    await expect(page.getByTestId('expense-item-lt-e-note')).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test('/packing/ with a long custom item', async ({ page }) => {
    await seed(page, false);
    await page.goto('/packing/', { waitUntil: 'domcontentloaded' });
    const input = page.getByTestId('packing-add-input');
    await input.fill(URL89);
    await input.press('Enter');
    await expect(page.getByText(URL89).first()).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test('/ with a long custom-trip destination', async ({ page }) => {
    await seed(page, true);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#hero-heading')).toHaveText('Long Escape');
    await expect(page.getByText(WORD).first()).toBeAttached();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
});
