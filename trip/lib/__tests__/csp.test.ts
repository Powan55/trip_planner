// Issue #180. These assertions exist because every one of them protects a directive whose
// removal breaks something SILENTLY — a blank map canvas, a dead sync, or a leaked
// capability token — rather than throwing something a run would surface.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildCsp, REFERRER_POLICY } from '@/lib/csp';

// The shipped policy is the production one, and vitest runs with NODE_ENV=test, so pin it.
// Otherwise every assertion below would be describing a string no browser ever receives.
beforeEach(() => vi.stubEnv('NODE_ENV', 'production'));
afterEach(() => vi.unstubAllEnvs());

/** Pull one directive's source list out of the assembled policy. */
function directive(name: string): string {
  const csp = buildCsp();
  const found = csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `));
  expect(found, `directive "${name}" missing from: ${csp}`).toBeDefined();
  return found!;
}

describe('CSP policy', () => {
  it('locks the default down to same-origin', () => {
    expect(directive('default-src')).toBe("default-src 'self'");
  });

  // The one most likely to be "tidied" by someone who does not know maplibre builds its
  // worker from a Blob, and its failure is a SILENT PARTIAL one. Measured with blob:
  // removed: the basemap, all 24 tiles, the controls and the attribution still render, so
  // the map looks fine — only the clustered place markers vanish, and the sole signal is
  // one console violation. Nothing about the page looks broken enough to investigate.
  it('allows the blob: worker maplibre-gl spawns', () => {
    expect(directive('worker-src')).toContain('blob:');
  });

  it('allows photo object URLs and backup data URIs as images', () => {
    const img = directive('img-src');
    expect(img).toContain('blob:');
    expect(img).toContain('data:');
  });

  it.each([
    ['https://*.basemaps.cartocdn.com', 'CARTO raster tiles'],
    ['https://api.open-meteo.com', 'weather'],
    ['https://air-quality-api.open-meteo.com', 'air quality'],
    ['https://api.frankfurter.dev', 'FX rates'],
    ['https://nominatim.openstreetmap.org', 'place search'],
    ['https://firestore.googleapis.com', 'Firestore sync'],
    ['https://identitytoolkit.googleapis.com', 'anonymous auth'],
    ['https://securetoken.googleapis.com', 'auth token refresh'],
  ])('permits connecting to %s (%s)', (origin) => {
    expect(directive('connect-src')).toContain(origin);
  });

  it('governs map tiles via connect-src, and does not carry them in img-src', () => {
    // maplibre 5.24 DOES have a `new Image()` decoder, but it is gated on
    // `supportImageRefresh === false`, fed by the Map's `refreshExpiredTiles` option, which
    // defaults to true and which this app never sets. So tiles go through fetch and
    // img-src never sees the tile origin. Measured in Chromium: dropping it from img-src
    // still loads every tile. Keep img-src free of it unless the app starts passing
    // `refreshExpiredTiles: false`.
    expect(directive('connect-src')).toContain('basemaps.cartocdn.com');
    expect(directive('img-src')).not.toContain('cartocdn.com');
  });

  it('allows the Firebase auth script and its authDomain iframe', () => {
    expect(directive('script-src')).toContain('https://apis.google.com');
    expect(directive('frame-src')).toContain('https://*.firebaseapp.com');
  });

  it('keeps the hardening directives that cost nothing here', () => {
    expect(directive('object-src')).toBe("object-src 'none'");
    expect(directive('base-uri')).toBe("base-uri 'self'");
    expect(directive('form-action')).toBe("form-action 'self'");
  });

  // No dependency in the SHIPPED app calls eval; if one starts to, that is a decision to
  // make explicitly rather than something to discover as a loosened policy.
  it('never permits eval in the production policy', () => {
    expect(buildCsp()).not.toContain("'unsafe-eval'");
  });

  // ...but `next dev` serves webpack's HMR runtime, which evaluates modules as strings.
  // Blocking it there does not fail loudly: the dev server returns its SSR shell, nothing
  // hydrates, and the only clue is a console violation. This pair is the whole gate — the
  // token has to be present in dev and absent in the export.
  it('permits eval under next dev, and nowhere else', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(directive('script-src')).toContain("'unsafe-eval'");
  });

  // Inline SCRIPT is a known, documented ceiling (Next serializes its RSC payload into
  // inline tags and a static export has no nonce). Inline STYLE is required by React
  // style attributes. Both are asserted so that a future nonce/hash migration has to
  // update this test deliberately.
  it('documents the inline-script and inline-style ceiling', () => {
    expect(directive('script-src')).toContain("'unsafe-inline'");
    expect(directive('style-src')).toContain("'unsafe-inline'");
  });

  it('does not include build-time-only or unused origins', () => {
    const csp = buildCsp();
    // Images are downloaded at build time by scripts/fetch-images.mjs and ship self-hosted.
    expect(csp).not.toContain('upload.wikimedia.org');
    // recaptchaV2Script is phone-auth only; this app has none.
    expect(csp).not.toContain('https://www.google.com');
  });

  it('never emits a wildcard source', () => {
    // `https://*.host` is a subdomain wildcard and fine; a bare `*` or `https:` is not.
    for (const d of buildCsp().split(';')) {
      expect(d.trim().split(/\s+/).slice(1), d).not.toContain('*');
      expect(d.trim().split(/\s+/).slice(1), d).not.toContain('https:');
    }
  });
});

describe('referrer policy', () => {
  // A shared trip link carries the trip capability token as `?trip=<token>`, and the app
  // links out to Google Maps / Rome2Rio / Flightradar24. Anything that sends the full URL
  // cross-origin hands those third parties the token in a Referer header.
  it('never sends path or query cross-origin', () => {
    expect(REFERRER_POLICY).toBe('strict-origin-when-cross-origin');
    expect(['unsafe-url', 'no-referrer-when-downgrade', 'origin-when-cross-origin']).not.toContain(
      REFERRER_POLICY,
    );
  });
});
