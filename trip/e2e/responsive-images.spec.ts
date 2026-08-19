import { test, expect } from './fixtures';

/**
 * S225 — responsive image pipeline (multi-width srcset/sizes).
 *
 * gen-images.mjs now emits 640w/1024w sub-native derivatives alongside the native
 * resolution (recorded as `variants` in lib/image-manifest.json); OptimizedImage builds
 * a multi-entry `srcset` from them whenever a caller already passes `sizes` (several
 * call sites already did, pre-S225 — no call-site changes were needed).
 *
 * This proves it on the REAL served static `out/` build (not just a component-level
 * check): /nepal renders `recommendation-section.tsx` cards, which already pass
 * `sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"` — the built,
 * hydrated DOM must contain a real multi-entry `srcset` on the AVIF <source>, no
 * broken images, and no console errors.
 *
 * V6-13 — the WebP tier is gone (AVIF + the original raster only), so the same spec
 * also asserts NO <source type="image/webp"> is rendered. That inversion is what stops
 * a WebP tier from being reintroduced, or the delete from being reverted, silently.
 */

test('nepal — recommendation cards render a real multi-width AVIF srcset and no WebP tier, no broken images, no console errors', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));

  await page.goto('/nepal/');

  // recommendation-section.tsx is a dynamic ssr:false island — wait for a real card photo
  // (the OptimizedImage <img> itself; its <picture> wrapper is a zero-box non-rendered
  // element once the img is absolutely positioned via `fill`, so we assert on the <img>).
  await expect(page.getByTestId('guide-card-na8')).toBeVisible();

  // The WebP tier is deleted: not one <source> may advertise it anywhere on the page.
  await expect(page.locator('picture source[type="image/webp"]')).toHaveCount(0);

  // ...and no srcset may still point at a .webp file (the LQIP is a `data:image/webp`
  // URI on a plain <img>, which this deliberately does not match).
  const webpUrls = await page.evaluate(() =>
    Array.from(document.querySelectorAll('picture source'))
      .map((s) => s.getAttribute('srcset') || '')
      .filter((s) => /\.webp(\s|,|$)/.test(s)),
  );
  expect(webpUrls, `srcsets still referencing .webp: ${webpUrls.join(' | ')}`).toEqual([]);

  // Real multi-entry srcset in the RENDERED (hydrated) DOM, sourced from the manifest's
  // `variants` — not a hand-authored fixture. Now read off the AVIF source, the only
  // <source> tier that remains.
  const sources = page.locator('picture source[type="image/avif"]');
  const count = await sources.count();
  expect(count).toBeGreaterThan(0);

  let sawMultiWidth = false;
  for (let i = 0; i < count; i++) {
    const srcset = await sources.nth(i).getAttribute('srcset');
    if (srcset && (srcset.match(/\d+w/g) || []).length > 1) {
      sawMultiWidth = true;
      // e.g. ".../na1-640w.avif 640w, .../na1-1024w.avif 1024w, .../na1.avif 1200w"
      expect(srcset).toMatch(/640w/);
      expect(srcset).toMatch(/\.avif\s+640w/);
      break;
    }
  }
  expect(sawMultiWidth, 'expected at least one AVIF <source> with a real multi-entry srcset').toBe(
    true,
  );

  // No broken <img> — every decoded image has non-zero natural dimensions.
  const broken = await page.evaluate(() =>
    Array.from(document.images)
      .filter((img) => img.complete && img.naturalWidth === 0)
      .map((img) => img.src),
  );
  expect(broken, `broken images: ${broken.join(', ')}`).toEqual([]);

  expect(consoleErrors, `console errors: ${consoleErrors.join('\n')}`).toEqual([]);
});

test('japan — hero image (priority, single-URL fallback path) still renders with no console errors', async ({
  page,
}) => {
  // hero-section.tsx passes sizes="100vw" AND priority — confirms the responsive path
  // and the untouched LCP/priority path coexist without regression.
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));

  await page.goto('/japan/');
  await expect(page.locator('h1').first()).toBeVisible();

  // Same V6-13 inversion on the single-URL (no-`variants`) path. The AVIF assertion is the
  // anti-vacuity half: a bare `toHaveCount(0)` on the webp source also passes on a route that
  // rendered no `<picture>` at all, which is the failure this negative is least able to see.
  await expect(page.locator('picture source[type="image/avif"]').first()).toBeAttached();
  await expect(page.locator('picture source[type="image/webp"]')).toHaveCount(0);

  const broken = await page.evaluate(() =>
    Array.from(document.images)
      .filter((img) => img.complete && img.naturalWidth === 0)
      .map((img) => img.src),
  );
  expect(broken, `broken images: ${broken.join(', ')}`).toEqual([]);
  expect(consoleErrors, `console errors: ${consoleErrors.join('\n')}`).toEqual([]);
});
