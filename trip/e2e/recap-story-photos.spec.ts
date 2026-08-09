import { test, expect } from './fixtures';
import type { Page, TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * S161 — the POST-TRIP STORY (`/recap`, S156) gains per-day journal photos (D-159/D-018).
 *
 * Photo BLOB bytes live only in IndexedDB (`BlobStorePort`) — unlike the itinerary/journal/expense
 * seeds elsewhere in this pack, a photo can't be seeded via a raw `localStorage.setItem`. This pack
 * REUSES the S160 photo-seeding approach (`e2e/photos.spec.ts`): capture a real photo through the
 * journal card's `PhotoAttach` UI on an IN-TRIP day, then navigate to `/recap` with a POST-TRIP
 * `?today=` clock (same browser context ⇒ the same IndexedDB + localStorage key 16) and assert the
 * captured day's story block renders the thumbnail strip — read-only, correct `alt`, and that it
 * survives a reload. A second, uncaptured day proves the "renders cleanly WITHOUT photos" half of
 * the S161 DoD (no empty strip, no console error).
 *
 * Settle discipline mirrors `recap-story.spec.ts` / `photos.spec.ts`: `domcontentloaded` nav
 * (D-093), `emulateMedia({reducedMotion:'reduce'})`, a firm island-ready wait before assertions.
 */

const PHOTOS_KEY = 'nepal_japan_photos';
const CAPTURE_DAY = '2026-12-14'; // in-trip day the photo is captured on
const NO_PHOTO_DAY = '2026-12-09'; // a different trip day, never given a photo
const POST_TRIP_DAY = '2027-01-15';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

async function gotoHomeWithClock(page: Page, todayParam: string) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/?today=${todayParam}`, { waitUntil: 'domcontentloaded' });
}
async function gotoRecapWithClock(page: Page, todayParam: string) {
  await page.goto(`/recap/?today=${todayParam}`, { waitUntil: 'domcontentloaded' });
}
async function settleJournal(page: Page) {
  await expect(page.getByTestId('today-panel')).toBeVisible();
  await expect(page.getByTestId('journal-card')).toBeVisible();
  await expect(page.getByTestId('photo-attach')).toBeVisible();
}
async function settleStory(page: Page) {
  await expect(page.getByTestId('trip-story-recap')).toBeVisible();
}

/** Serious/critical axe assertion (mirrors a11y-intrip.spec.ts's shared helper). */
async function expectNoSeriousCritical(page: Page, label: string, testInfo: TestInfo) {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const advisory = results.violations.filter((v) => v.impact !== 'serious' && v.impact !== 'critical');
  for (const v of results.violations) {
    testInfo.annotations.push({ type: `axe:${v.impact ?? 'unknown'}`, description: `${v.id}: ${v.help}` });
  }
  // eslint-disable-next-line no-console
  console.log(`axe SUMMARY ${label}: serious/critical=${blocking.length}, moderate/minor=${advisory.length}`);
  expect(
    blocking,
    `serious/critical a11y violations on ${label}: ${blocking.map((v) => `${v.id} × ${v.nodes.length}`).join('; ')}`,
  ).toEqual([]);
}

test.describe('S161 story-mode photos — a captured day shows them, an uncaptured day stays clean', () => {
  test('capture a journal photo in-trip, then /recap post-trip renders it read-only and survives a reload', async ({
    page,
  }, testInfo) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    // ── Capture a photo on CAPTURE_DAY via the real S160 UI flow ──────────────────────────────────
    await gotoHomeWithClock(page, CAPTURE_DAY);
    await settleJournal(page);

    await page.getByTestId('photo-file-input').setInputFiles({
      name: 'boudhanath.png',
      mimeType: 'image/png',
      buffer: PNG_1PX,
    });
    await page.getByTestId('photo-alt-input').fill('Prayer flags over Boudhanath stupa');
    await page.getByTestId('photo-save').click();
    await expect(page.getByTestId(/^photo-img-/).first()).toBeVisible();

    const stored = await page.evaluate((key) => {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as Array<{ id: string; altText: string }>) : null;
    }, PHOTOS_KEY);
    expect(stored).toHaveLength(1);
    const photoId = stored![0].id;

    // ── /recap, post-trip: the captured day shows the photo, read-only ────────────────────────────
    await gotoRecapWithClock(page, POST_TRIP_DAY);
    await settleStory(page);
    await expect(page.getByTestId('trip-story-locked')).toHaveCount(0);

    const strip = page.getByTestId(`story-photos-${CAPTURE_DAY}`);
    await expect(strip).toBeVisible();
    const thumb = page.getByTestId(`story-photo-${photoId}`);
    await expect(thumb).toBeVisible();
    await expect(thumb).toHaveAttribute('data-missing', 'false');
    const img = thumb.locator('img');
    await expect(img).toHaveAttribute('alt', 'Prayer flags over Boudhanath stupa');
    // Read-only: no delete/edit control on the story surface (that lives only on the journal card).
    await expect(thumb.locator('button')).toHaveCount(0);

    // ── A day with NO captured photo: the story renders cleanly, no empty strip ───────────────────
    await expect(page.getByTestId(`story-day-${NO_PHOTO_DAY}`)).toBeVisible();
    await expect(page.getByTestId(`story-photos-${NO_PHOTO_DAY}`)).toHaveCount(0);

    // ── Survives a reload (blob in IndexedDB, meta in key 16 — same client-side hard guarantee) ───
    await page.reload({ waitUntil: 'domcontentloaded' });
    await settleStory(page);
    await expect(page.getByTestId(`story-photo-${photoId}`).locator('img')).toHaveAttribute(
      'alt',
      'Prayer flags over Boudhanath stupa',
    );

    // ── axe /recap WITH the photo strip present: zero serious/critical (photos carry alt text) ────
    await expectNoSeriousCritical(page, '/recap (post-trip, with photo strip)', testInfo);

    // ── No console errors anywhere in this flow ────────────────────────────────────────────────────
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });
});
