import { test, expect } from './fixtures';
import type { Page, Request } from '@playwright/test';

/**
 * S160 — photo capture E2E + the (b) EGRESS network-intercept proof (D-159 zero-egress).
 *
 * The PhotoAttach surface mounts inside the in-trip Today journal card (`components/journal-card.tsx`
 * → owner `{kind:'journal',date}`), reached via the `?today=` override (D-075). This pack proves, on a
 * real browser against the served static `out/` build:
 *   1. CAPTURE → RENDER → RELOAD PERSISTS: pick an image, give it alt text, save → a thumbnail renders,
 *      the meta lands in localStorage key 16, and it survives a reload (blob in IndexedDB).
 *   2. EGRESS: while capturing, EVERY network request is recorded; none carries the photo id, a
 *      base64/blob body, or leaves the app origin. The dormant build makes zero non-allowlisted calls
 *      — the photo bytes and refs never leave the device (the client-side hard guarantee for photos).
 *
 * Settle discipline mirrors journal.spec.ts (the journal card is a dynamic ssr:false island).
 */

const ITINERARY_KEY = 'nepal_japan_itinerary';
const PHOTOS_KEY = 'nepal_japan_photos';
const IN_TRIP_DAY = '2026-12-14';

// A real, decodable 1×1 PNG (createImageBitmap needs a valid image; downscale re-encodes to JPEG).
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

async function gotoHomeWithClock(page: Page, todayParam: string) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/?today=${todayParam}`, { waitUntil: 'domcontentloaded' });
}
async function reloadSettled(page: Page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
}
async function settleJournal(page: Page) {
  await expect(page.getByTestId('today-panel')).toBeVisible();
  await expect(page.getByTestId('journal-card')).toBeVisible();
  await expect(page.getByTestId('photo-attach')).toBeVisible();
}
async function seedEmptyItinerary(page: Page) {
  await page.evaluate((key) => window.localStorage.setItem(key, '[]'), ITINERARY_KEY);
}

test.describe('S160 photo capture — render, persist, and zero egress', () => {
  test('capture a day photo: it renders, persists across reload, and never leaves the device', async ({
    page,
  }) => {
    await gotoHomeWithClock(page, IN_TRIP_DAY);
    await seedEmptyItinerary(page);
    await reloadSettled(page);
    await settleJournal(page);

    // ── Start recording ALL requests for the egress proof, capturing method/url/body ─────────────
    const origin = new URL(page.url()).host;
    const captured: { url: string; method: string; body: string }[] = [];
    const onReq = (req: Request) => {
      captured.push({ url: req.url(), method: req.method(), body: req.postData() ?? '' });
    };
    page.on('request', onReq);

    // ── Capture: pick the image, fill the REQUIRED alt text + a caption, save ────────────────────
    await page.getByTestId('photo-empty').waitFor();
    await page.getByTestId('photo-file-input').setInputFiles({
      name: 'kathmandu.png',
      mimeType: 'image/png',
      buffer: PNG_1PX,
    });
    await expect(page.getByTestId('photo-prompt')).toBeVisible();
    // Save is disabled until alt text is present (a11y requirement).
    await expect(page.getByTestId('photo-save')).toBeDisabled();
    await page.getByTestId('photo-alt-input').fill('Sunset over Boudhanath');
    await page.getByTestId('photo-caption-input').fill('golden hour');
    await expect(page.getByTestId('photo-save')).toBeEnabled();
    await page.getByTestId('photo-save').click();

    // The thumbnail renders with the alt text; the prompt closes.
    const img = page.getByTestId(/^photo-img-/);
    await expect(img.first()).toBeVisible();
    await expect(img.first()).toHaveAttribute('alt', 'Sunset over Boudhanath');
    await expect(page.getByTestId('photo-prompt')).toHaveCount(0);

    // The meta persisted to key 16, and its id is what we assert the network never carried.
    const stored = await page.evaluate((key) => {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as Array<{ id: string; altText: string }>) : null;
    }, PHOTOS_KEY);
    expect(stored).not.toBeNull();
    expect(stored).toHaveLength(1);
    expect(stored![0].altText).toBe('Sunset over Boudhanath');
    const photoId = stored![0].id;

    // Give any (non-existent) async network a beat, then stop recording.
    await page.waitForTimeout(300);
    page.off('request', onReq);

    // ── EGRESS PROOF (D-159): nothing about the photo left the device ────────────────────────────
    for (const r of captured) {
      // `blob:`/`data:` URLs are inherently device-local (they never touch the network) — the
      // thumbnail loading from a `blob:` object URL is itself the proof the bytes stay local. Only
      // real network (http/https) requests must be checked for leaving the origin.
      const scheme = r.url.split(':', 1)[0];
      if (scheme === 'http' || scheme === 'https') {
        // No network request leaves the app origin during capture (dormant build: no Firebase, no remote).
        expect(new URL(r.url).host, `request left origin: ${r.method} ${r.url}`).toBe(origin);
      }
      // No request URL or body carries the photo id, its index, or an inline image payload.
      expect(r.url).not.toContain(photoId);
      expect(r.url).not.toContain('nepal_japan_photos');
      expect(r.body).not.toContain(photoId);
      expect(r.body).not.toContain('data:image');
      expect(r.body).not.toContain('nepal_japan_photos');
    }

    // ── RELOAD — the photo survives (blob in IndexedDB, meta in key 16) ──────────────────────────
    await reloadSettled(page);
    await settleJournal(page);
    await expect(page.getByTestId(/^photo-img-/).first()).toBeVisible();
    const afterReload = await page.evaluate((key) => {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw).length : 0;
    }, PHOTOS_KEY);
    expect(afterReload).toBe(1);
  });

  test('delete a captured photo: the thumbnail and its meta are gone', async ({ page }) => {
    await gotoHomeWithClock(page, IN_TRIP_DAY);
    await seedEmptyItinerary(page);
    await reloadSettled(page);
    await settleJournal(page);

    await page.getByTestId('photo-file-input').setInputFiles({
      name: 'p.png',
      mimeType: 'image/png',
      buffer: PNG_1PX,
    });
    await page.getByTestId('photo-alt-input').fill('A stall');
    await page.getByTestId('photo-save').click();
    await expect(page.getByTestId(/^photo-img-/).first()).toBeVisible();

    await page.getByTestId(/^photo-delete-/).first().click();
    await expect(page.getByTestId(/^photo-thumb-/)).toHaveCount(0);
    await expect(page.getByTestId('photo-empty')).toBeVisible();

    const remaining = await page.evaluate((key) => {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw).length : 0;
    }, PHOTOS_KEY);
    expect(remaining).toBe(0);
  });
});
