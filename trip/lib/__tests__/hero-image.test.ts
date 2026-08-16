import { describe, it, expect } from 'vitest';
import { heroImageForLeg, HERO_DEFAULT, HERO_JAPAN } from '@/lib/hero-image';
import imageManifest from '@/lib/image-manifest.json';

describe('heroImageForLeg — leg to hero photograph', () => {
  it('japan leg -> the Tokyo hero', () => {
    expect(heroImageForLeg('japan')).toBe(HERO_JAPAN);
  });

  it('nepal leg -> the Himalaya hero', () => {
    expect(heroImageForLeg('nepal')).toBe(HERO_DEFAULT);
  });

  it('outside the trip window (null/undefined) -> the Himalaya hero, never blank', () => {
    expect(heroImageForLeg(null)).toBe(HERO_DEFAULT);
    expect(heroImageForLeg(undefined)).toBe(HERO_DEFAULT);
  });

  it("an unrecognised leg id still paints a photograph (custom pack's 'main')", () => {
    expect(heroImageForLeg('main')).toBe(HERO_DEFAULT);
    expect(heroImageForLeg('')).toBe(HERO_DEFAULT);
  });

  it('the two heroes are different files', () => {
    expect(HERO_DEFAULT).not.toBe(HERO_JAPAN);
  });

  // Every assertion above compares the function against its OWN exported constants, so a
  // typo in one of them ('hero-japn.jpg') passes all five and the defect ships. What it
  // costs is silent: OptimizedImage falls off its manifest path to a plain <img> — no
  // AVIF, no WebP, no responsive srcset, no LQIP — and the hero, the app's single LCP
  // image, quietly starts serving a 533 KiB JPEG at every width. It also drops out of the
  // service worker's hero precache (scripts/gen-sw.mjs), which is the offline guarantee
  // for the leg swap.
  //
  // Same idiom as "every inspiration image is a real bundled asset" in
  // content-validation.test.ts: assert against the build-time manifest OptimizedImage
  // itself keys off, because that is the thing that has to agree.
  it('both hero paths are real bundled assets (lib/image-manifest.json keys)', () => {
    const known = new Set(Object.keys(imageManifest));
    for (const path of [HERO_DEFAULT, HERO_JAPAN]) {
      expect(known.has(path), `${path} is not a bundled image`).toBe(true);
    }
  });
});
