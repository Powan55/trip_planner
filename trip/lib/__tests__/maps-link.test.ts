import { describe, it, expect } from 'vitest';
import { buildMapsSearchUrl, buildMapsDirectionsUrl, buildMapsPlaceUrl } from '@/lib/maps-link';

// S151 — buildMapsDirectionsUrl (D-074: a plain URL, not an API). Byte-exact
// assertions against the exact decided URL scheme, plus a re-assertion of the
// pre-existing buildMapsSearchUrl (regression guard against a shared-file slip).

describe('buildMapsDirectionsUrl', () => {
  it('returns the exact destination-only URL for a known lat/lng (Boudhanath Stupa)', () => {
    expect(buildMapsDirectionsUrl(27.7215, 85.362)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=27.7215,85.362',
    );
  });

  it('handles negative coordinates with no extra encoding artifacts', () => {
    expect(buildMapsDirectionsUrl(-33.8688, 151.2093)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=-33.8688,151.2093',
    );
  });

  it('never injects an origin — destination-only, per D-074', () => {
    const href = buildMapsDirectionsUrl(35.7148, 139.7967);
    expect(href).not.toContain('origin=');
    expect(href).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=35.7148,139.7967',
    );
  });
});

describe('buildMapsSearchUrl (regression guard — shared file with buildMapsDirectionsUrl)', () => {
  it('still returns the exact search URL for a title only', () => {
    expect(buildMapsSearchUrl('Blue Bottle Coffee')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Blue%20Bottle%20Coffee',
    );
  });

  it('still returns the exact search URL for title + location', () => {
    expect(buildMapsSearchUrl('Ramen Nagi', 'Shinjuku')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Ramen%20Nagi%20Shinjuku',
    );
  });

  it('still returns null for an empty/whitespace title', () => {
    expect(buildMapsSearchUrl('   ')).toBeNull();
  });
});

// S349 — coordinate-first link-out. A pasted/resolved link's coords (or a manually dropped pin)
// beat a text-search guess, which is unreliable for small or non-Latin venues; every existing
// call site still degrades to buildMapsSearchUrl byte-identically when no pin is known.
describe('buildMapsPlaceUrl (S349) — coordinate-first, falls back to text search', () => {
  it('returns the coordinate query form when both lat/lng are finite', () => {
    expect(buildMapsPlaceUrl('Fushimi Inari Shrine', 34.9671, 135.7727)).toBe(
      'https://www.google.com/maps/search/?api=1&query=34.9671,135.7727',
    );
  });

  it('handles negative coordinates with no extra encoding artifacts', () => {
    expect(buildMapsPlaceUrl('Somewhere South', -33.8688, 151.2093)).toBe(
      'https://www.google.com/maps/search/?api=1&query=-33.8688,151.2093',
    );
  });

  it('falls back to the exact existing text-search URL when either coordinate is missing', () => {
    expect(buildMapsPlaceUrl('Ramen Nagi', undefined, undefined, 'Shinjuku')).toBe(
      buildMapsSearchUrl('Ramen Nagi', 'Shinjuku'),
    );
    expect(buildMapsPlaceUrl('Ramen Nagi', 35.1, undefined, 'Shinjuku')).toBe(
      buildMapsSearchUrl('Ramen Nagi', 'Shinjuku'),
    );
    expect(buildMapsPlaceUrl('Ramen Nagi', undefined, 139.7, 'Shinjuku')).toBe(
      buildMapsSearchUrl('Ramen Nagi', 'Shinjuku'),
    );
  });

  it('treats non-finite coordinates (NaN/Infinity) as missing, not a crash', () => {
    expect(buildMapsPlaceUrl('Spot', NaN, 12)).toBe(buildMapsSearchUrl('Spot'));
    expect(buildMapsPlaceUrl('Spot', 12, Infinity)).toBe(buildMapsSearchUrl('Spot'));
  });

  it('returns null for an empty/whitespace title with no coordinates (same as buildMapsSearchUrl)', () => {
    expect(buildMapsPlaceUrl('   ')).toBeNull();
  });
});
