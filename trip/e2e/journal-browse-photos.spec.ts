import { test, expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * S208 — the `/journal` BROWSE view (`components/journal-browse.tsx`) gains the same read-only
 * per-day photo ride-along `trip-story-recap.tsx` got in S161 (D-159/D-018).
 *
 * Photo BLOB bytes live only in IndexedDB (`BlobStorePort`) — a photo can't be seeded via a raw
 * `localStorage.setItem`. This pack captures a real photo through the exact same `PhotoAttach`
 * UI `journal-card.tsx` already mounts unconditionally (`e2e/journal-browse.spec.ts`'s Edit round
 * trip opens that same `JournalCard` primitive in place of a row) — no new UI, no new route.
 *
 * Proves, on real rendered output against the served static `out/` build (never `next dev`):
 *   1. A day WITH a captured photo shows the strip after a reload (`editingDate` is in-page state,
 *      so the row only reverts to its read-only summary — where the strip lives — on reload; this
 *      doubles as the client-side persistence proof: blob in IndexedDB + meta in key 16 survive).
 *   2. A day with NO photo renders cleanly — no empty strip, no broken layout.
 *   3. The strip is read-only: no delete/add control inside it.
 *   4. axe on `/journal` with the photo strip present: zero serious/critical.
 *   5. No console errors anywhere in the flow.
 */

const JOURNAL_KEY = 'nepal_japan_journal';
const PHOTOS_KEY = 'nepal_japan_photos';
const CAPTURE_DAY = '2026-12-10';
const NO_PHOTO_DAY = '2026-12-15';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

/** Mirrors `e2e/journal-browse.spec.ts`'s `gotoAsTraveler` (a real Trip Token, D-073 SW settle). */
async function gotoAsTraveler(page: Page, path: string, token = 'Powan') {
  await page.addInitScript((t: string) => {
    window.localStorage.setItem('tripPlannerToken', t);
    window.localStorage.setItem('tripPlannerUserName', t);
    window.localStorage.setItem('nepal_japan_first_run_tour_seen', '1'); // S155: keep dormant
    window.localStorage.setItem('nepal_japan_install_hint_dismissed', '1'); // S272: dismiss app-wide install toast (duration:Infinity poisons axe scans)
  }, token);
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
}

/** Seed two journal entries (mirrors `e2e/journal-browse.spec.ts`'s `seedEntries`). */
async function seedEntries(page: Page) {
  await page.evaluate((key: string) => {
    window.localStorage.setItem(
      key,
      JSON.stringify([
        {
          date: '2026-12-10',
          text: 'Boudhanath at dawn, then momos in Thamel.',
          mood: 'good',
          highlight: 'Prayer flags at first light',
          createdAt: '2026-12-10T09:00:00.000Z',
          updatedAt: '2026-12-10T09:00:00.000Z',
        },
        {
          date: '2026-12-15',
          text: 'A quiet free day — laundry and journaling.',
          mood: 'okay',
          createdAt: '2026-12-15T09:00:00.000Z',
          updatedAt: '2026-12-15T09:00:00.000Z',
        },
      ]),
    );
  }, JOURNAL_KEY);
  await page.reload({ waitUntil: 'load' });
}

/** Serious/critical axe assertion (mirrors `journal-browse-a11y.spec.ts`'s shared helper). */
async function expectNoSeriousCritical(page: Page, label: string, testInfo: TestInfo) {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  for (const v of results.violations) {
    testInfo.annotations.push({ type: `axe:${v.impact ?? 'unknown'}`, description: `${v.id}: ${v.help}` });
  }
  // eslint-disable-next-line no-console
  console.log(`axe SUMMARY ${label}: serious/critical=${blocking.length}`);
  expect(
    blocking,
    `serious/critical a11y violations on ${label}: ${blocking.map((v) => `${v.id} × ${v.nodes.length}`).join('; ')}`,
  ).toEqual([]);
}

test.describe('S208 /journal browse — photo ride-along', () => {
  test('capture a journal photo via the row editor, reload, and the browse row shows it read-only; an uncaptured day stays clean', async ({
    page,
  }, testInfo) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    await gotoAsTraveler(page, '/journal/');
    await seedEntries(page);
    await expect(page.getByTestId('journal-browse-row-2026-12-10')).toBeVisible();

    // No strip yet on either row — no photo captured.
    await expect(page.getByTestId('journal-browse-photos-2026-12-10')).toHaveCount(0);
    await expect(page.getByTestId('journal-browse-photos-2026-12-15')).toHaveCount(0);

    // ── Capture a photo on CAPTURE_DAY via the real JournalCard/PhotoAttach UI ────────────────────
    await page.getByTestId('journal-browse-edit-2026-12-10').click();
    await expect(page.getByTestId('journal-card')).toBeVisible();
    await expect(page.getByTestId('photo-attach')).toBeVisible();

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

    // ── Reload: `editingDate` (in-page state) resets, the row reverts to its read-only summary ────
    // — which is where the strip lives — AND this doubles as the persistence proof (blob in
    // IndexedDB + meta in key 16 both survive a full reload, the client-side hard guarantee).
    await page.reload({ waitUntil: 'load' });
    await expect(page.getByTestId('journal-browse-row-2026-12-10')).toBeVisible();

    const strip = page.getByTestId(`journal-browse-photos-${CAPTURE_DAY}`);
    await expect(strip).toBeVisible();
    const thumb = page.getByTestId(`journal-browse-photo-${photoId}`);
    await expect(thumb).toBeVisible();
    await expect(thumb).toHaveAttribute('data-missing', 'false');
    const img = thumb.locator('img');
    await expect(img).toHaveAttribute('alt', 'Prayer flags over Boudhanath stupa');
    // Read-only: no delete/edit control inside the strip itself (that lives only on the journal
    // card's own PhotoAttach, reached via the row's Edit control, not inside the strip).
    await expect(thumb.locator('button')).toHaveCount(0);

    // ── The uncaptured day renders cleanly — no empty strip ────────────────────────────────────────
    await expect(page.getByTestId('journal-browse-row-2026-12-15')).toBeVisible();
    await expect(page.getByTestId(`journal-browse-photos-${NO_PHOTO_DAY}`)).toHaveCount(0);

    // ── axe /journal WITH the photo strip present: zero serious/critical (photos carry alt text) ──
    await expectNoSeriousCritical(page, '/journal (populated, with photo strip)', testInfo);

    // ── No console errors anywhere in this flow ────────────────────────────────────────────────────
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });
});
