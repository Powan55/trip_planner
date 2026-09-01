import { test, expect } from './fixtures';
import type { Locator, Page } from '@playwright/test';

/**
 * The focus-ring guard. axe cannot see this class of defect and neither can
 * `scripts/token-wrappers.mjs`, which is why it shipped: 20 primary buttons kept a
 * `focus-visible:outline-none` utility from before they moved onto the `.btn` recipe, and
 * tailwind emits utilities LAST, so at equal specificity the transparent outline won and
 * every one of those buttons had NO visible keyboard focus ring (WCAG 2.4.7). Nothing in the
 * markup says so — the class strings still read `btn`, and the ring is real in the
 * stylesheet. Only the COMPUTED value tells the truth, so that is what this asserts.
 *
 * It deliberately sweeps EVERY visible `.btn` on the pages it visits rather than a named
 * list: a 21st button is caught without anyone remembering to add it here.
 */

/** A transparent, zero-width or absent outline is not a focus indicator. */
type Ring = {
  outlineStyle: string;
  outlineWidth: string;
  outlineColor: string;
  boxShadow: string;
  className: string;
  label: string;
  focusVisible: boolean;
};

/**
 * Chromium only matches `:focus-visible` on a programmatic `.focus()` when the last user
 * interaction was a keyboard one, so every sweep presses Tab first to arm the heuristic.
 * Without it every element reports `focusVisible: false` and the guard passes vacuously.
 */
async function armKeyboardModality(page: Page) {
  await page.keyboard.press('Tab');
}

async function readRing(el: Locator): Promise<Ring> {
  return el.evaluate((n: HTMLElement) => {
    n.focus();
    const cs = getComputedStyle(n);
    return {
      outlineStyle: cs.outlineStyle,
      outlineWidth: cs.outlineWidth,
      outlineColor: cs.outlineColor,
      boxShadow: cs.boxShadow,
      className: typeof n.className === 'string' ? n.className : '',
      label: (n.textContent || '').trim().slice(0, 40) || n.tagName,
      focusVisible: n.matches(':focus-visible'),
    };
  });
}

/** rgba(...,0) / transparent — the exact shape the outline-none utility paints. */
function isTransparent(color: string): boolean {
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) return color === 'transparent';
  const parts = m[1].split(/[,\s/]+/).filter(Boolean);
  return parts.length > 3 && Number(parts[3]) === 0;
}

function hasVisibleRing(r: Ring): boolean {
  const outlineOk =
    r.outlineStyle !== 'none' &&
    parseFloat(r.outlineWidth) > 0 &&
    !isTransparent(r.outlineColor);
  // A ring drawn as a box-shadow (the shadcn `focus-visible:ring-*` path) counts too.
  const shadowOk = r.boxShadow !== 'none' && !/^rgba?\([^)]*[,/]\s*0\)/.test(r.boxShadow);
  return outlineOk || shadowOk;
}

function fmt(r: Ring): string {
  return `[${r.label}] class="${r.className}" :focus-visible=${r.focusVisible} outline=${r.outlineStyle} ${r.outlineWidth} ${r.outlineColor} box-shadow=${r.boxShadow}`;
}

/** Assert every visible, enabled `.btn` under `root` paints something a keyboard user can see. */
async function expectEveryBtnRinged(page: Page, scope = 'body') {
  await armKeyboardModality(page);
  const btns = page.locator(`${scope} .btn:visible:not([disabled])`);
  const n = await btns.count();
  expect(n, `expected at least one .btn under ${scope}`).toBeGreaterThan(0);

  const bad: string[] = [];
  let judged = 0;
  for (let i = 0; i < n; i++) {
    const ring = await readRing(btns.nth(i));
    // A control that refuses :focus-visible cannot be judged; skip rather than pass it.
    if (!ring.focusVisible) continue;
    judged++;
    if (!hasVisibleRing(ring)) bad.push(fmt(ring));
  }
  // If the modality heuristic stops arming, EVERY element is skipped above and `bad` is empty
  // for the wrong reason. Located-but-never-judged is the vacuous pass this guard exists to
  // prevent, so it is a failure, not a green run.
  expect(judged, `located ${n} .btn under ${scope} but judged none — :focus-visible never armed`).toBeGreaterThan(0);
  expect(bad, `.btn with no visible focus ring:\n${bad.join('\n')}`).toEqual([]);
}

/**
 * The first-run tour, on FRESH storage (the shared fixture pre-seeds the "seen" flag, so this
 * one un-seeds it). Its two buttons — `tour-next`
 * and `tour-back` — are 2 of the 20 originally-affected sites and they are reachable with no
 * setup at all, which makes them the cheapest permanent canary in the pack.
 */
test.describe('focus ring — the .btn recipe', () => {
  test('tour buttons paint a real ring, not a transparent one', async ({ page }) => {
    // Added AFTER the shared fixture's init script, so it runs after and un-seeds the flag.
    await page.addInitScript(() => {
      window.localStorage.removeItem('nepal_japan_first_run_tour_seen');
    });
    await page.goto('/', { waitUntil: 'load' });
    await expect(page.getByTestId('tour-dialog')).toBeVisible({ timeout: 20_000 });

    await armKeyboardModality(page);
    const ring = await readRing(page.getByTestId('tour-next'));

    // The regression, spelled out: this read `rgba(0, 0, 0, 0)` before the fix.
    expect(ring.focusVisible, fmt(ring)).toBe(true);
    expect(isTransparent(ring.outlineColor), fmt(ring)).toBe(false);
    expect(parseFloat(ring.outlineWidth), fmt(ring)).toBeGreaterThanOrEqual(2);
    expect(hasVisibleRing(ring), fmt(ring)).toBe(true);

    await expectEveryBtnRinged(page, '[data-testid="tour-dialog"]');
  });
});

/**
 * NOTE — do NOT add `emulateMedia({ reducedMotion: 'reduce' })` to these. Measured on the
 * pre-fix build: under reduced motion the affected controls fell back to chromium's own UA
 * focus ring (`solid 3px rgb(255, 255, 255)`) and the assertions below passed while the
 * defect was still live; without it the same element read `rgba(0, 0, 0, 0)`. Reduced motion
 * masks this defect, and the unemulated path is both the majority one and the honest one.
 */
test.describe('focus ring — swept across the surfaces that carried the defect', () => {
  /** The Expenses tab is where /plan actually renders a `.btn` (`components/expense-log.tsx`). */
  test('every visible .btn on /plan is ringed', async ({ page }) => {
    await page.goto('/plan', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('budget-panel')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('budget-view-tab-expenses').click();
    await expect(page.getByTestId('expense-log-open')).toBeVisible();
    await expectEveryBtnRinged(page);
  });

  /**
   * `role="tabpanel" tabIndex={0}` with the same inert utility: tabbing off the tablist put
   * focus on a full-width container that painted nothing.
   */
  test('the budget tabpanel is ringed when it takes focus', async ({ page }) => {
    await page.goto('/plan', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('budget-panel')).toBeVisible({ timeout: 20_000 });

    await armKeyboardModality(page);
    const ring = await readRing(page.locator('#budget-view-panel-budget'));

    expect(ring.focusVisible, fmt(ring)).toBe(true);
    expect(isTransparent(ring.outlineColor), fmt(ring)).toBe(false);
    expect(hasVisibleRing(ring), fmt(ring)).toBe(true);
  });
});
