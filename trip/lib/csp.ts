// The app's Content-Security-Policy and referrer policy, in ONE place (issue #180).
//
// WHY A <meta> TAG AND NOT A HEADER: `next.config.js` sets `output: 'export'`, which
// drops `headers()` entirely, and the static host serves no headers of its own. Markup
// is the only lever a static export has. That costs three things a real header gives —
// `frame-ancestors` (ignored in meta by spec, so clickjacking is NOT covered here),
// report-only mode, and `report-uri`. Framing protection needs a host that can set
// headers; it is deliberately out of scope rather than silently assumed.
//
// EVERY ORIGIN BELOW WAS READ OUT OF THE CODE THAT CONTACTS IT, not copied from a
// template. If you add a network call, add its origin here or it fails closed.

import { CONCIERGE_URL } from '@/lib/concierge-config';

/**
 * The concierge Worker's ORIGIN (scheme + host), or '' when the feature is dormant.
 *
 * `CONCIERGE_URL` is a full URL and `connect-src` matches on origin, so the path is
 * dropped. Parsing is guarded because a malformed value must not fail the build — a bad
 * URL simply contributes no origin, and the concierge fetch then fails closed under CSP
 * rather than the whole page failing to render.
 */
function conciergeOrigin(): string {
  if (!CONCIERGE_URL) return '';
  try {
    return new URL(CONCIERGE_URL).origin;
  } catch {
    return '';
  }
}

/**
 * Everything the app actually opens a connection to at runtime:
 *
 * - `https://*.basemaps.cartocdn.com` — CARTO dark-matter raster tiles (lib/map-style.ts
 *   `CARTO_DARK_TILES`, subdomains a-d). MapLibre v5 pulls raster tiles through `fetch`,
 *   so this is the directive that governs them — NOT `img-src`. Verified by removing the
 *   origin from here: all 46 tile requests were blocked and the basemap went blank.
 * - `https://api.open-meteo.com` — forecasts (lib/weather.ts `OPEN_METEO_URL`).
 * - `https://air-quality-api.open-meteo.com` — air quality (lib/weather.ts
 *   `OPEN_METEO_AQ_URL`). Same operator, same keyless/no-account free tier as the forecast
 *   host above, but a genuinely different origin — it does not fall under that entry.
 * - `https://api.frankfurter.dev` — FX rates (lib/currency-rate.ts `FRANKFURTER_URL`).
 * - `https://nominatim.openstreetmap.org` — place search (lib/world-search.ts).
 * - `https://firestore.googleapis.com` — Firestore. Its WebChannel transport is HTTPS
 *   long-polling; the bundle contains no `wss://` and no `WebSocket`, so no `wss:` here.
 * - `https://identitytoolkit.googleapis.com` / `https://securetoken.googleapis.com` —
 *   Firebase Anonymous Auth and its token refresh (`DefaultConfig.API_HOST` /
 *   `TOKEN_API_HOST` in @firebase/auth).
 *
 * `'self'` covers the self-hosted MapLibre SDF glyphs under `public/font/` (issue #8),
 * the precached shell, and the fonts `next/font` emits into `_next/static/media/`.
 *
 * NOT included, deliberately: `https://www.google.com` (the SDK's `recaptchaV2Script`
 * is phone-auth only and this app has no phone auth) and `https://upload.wikimedia.org`
 * (a BUILD-time source for scripts/fetch-images.mjs — the images ship self-hosted).
 */
const CONNECT_SRC = [
  "'self'",
  'https://*.basemaps.cartocdn.com',
  'https://api.open-meteo.com',
  'https://air-quality-api.open-meteo.com',
  'https://api.frankfurter.dev',
  'https://nominatim.openstreetmap.org',
  'https://firestore.googleapis.com',
  'https://identitytoolkit.googleapis.com',
  'https://securetoken.googleapis.com',
];

/**
 * The policy, assembled at build time (this module is imported by the Server Component
 * root layout, so the string is baked into every exported page).
 */
export function buildCsp(): string {
  const connect = [...CONNECT_SRC, conciergeOrigin()].filter(Boolean).join(' ');

  // `next dev` compiles through webpack, whose HMR runtime evaluates every module as a
  // string. Without `'unsafe-eval'` the dev server hydrates NOTHING — the page renders the
  // SSR shell (the skip link and nothing else) and the console carries one violation. The
  // exported production bundle never evals, so the token is added here and only here; the
  // shipped policy is unchanged. `buildCsp()` runs in the Server Component root layout, so
  // this reads Node's real `NODE_ENV` at build/dev time.
  const devEval = process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : '';

  return [
    "default-src 'self'",

    // 🔴 `'unsafe-inline'` IS STRUCTURAL HERE — it is not laziness, and swapping it for
    // hashes without also adding a post-build step will break every page. Next's App
    // Router serializes its RSC payload into inline `self.__next_f.push(...)` tags, and
    // `next-themes` emits a blocking inline theme script. A real build of this app emits
    // 615 inline script tags across 21 pages, 127 of them byte-unique, and the set
    // changes on every build because chunk names are content-hashed. A meta CSP is one
    // shared string for all 21 pages, so it cannot carry per-page hashes, and `output:
    // 'export'` means there is no server to mint a per-request nonce. Note also that a
    // hash or nonce would not merely add to this — CSP3 makes browsers IGNORE
    // `'unsafe-inline'` once either is present, so a half-migration fails closed.
    // UPGRADE PATH: a post-build pass (the shape scripts/gen-sw.mjs already uses) that
    // rewrites each page's meta tag with that page's own hashes.
    // What this still buys, even with `'unsafe-inline'`: an injected
    // `<script src="//evil.example/x.js">` is blocked, because no third-party origin is
    // allowed here except Google's auth script.
    // `https://apis.google.com` — @firebase/auth injects `js/api.js` (its `gapiScript`)
    // to run the popup/redirect iframe transport used by Google account linking.
    // No `'unsafe-eval'` in production: neither maplibre-gl nor the Firebase SDKs call
    // `eval`/`new Function`. It is added for `next dev` only — see `devEval` above.
    `script-src 'self' 'unsafe-inline'${devEval} https://apis.google.com`,

    // React writes `style` attributes (30 components use `style={{…}}`) and MapLibre
    // styles its canvas, controls and popups inline. Both need `'unsafe-inline'`;
    // there is no nonce path for a style ATTRIBUTE at all.
    `style-src 'self' 'unsafe-inline'`,

    // Self-hosted woff2 from `next/font` — the build output references only
    // `/_next/static/media/*.woff2`, never fonts.gstatic.com.
    "font-src 'self'",

    // `blob:` — photo object URLs (hooks/use-photo-object-url.ts).
    // `data:` — photos inlined into a vault backup (core/vault/backup.ts blobToDataUrl).
    // NO carto origin here, and the reason is a runtime OPTION, not a missing code path.
    // maplibre-gl 5.24 does ship an `Image()` decoder (`getImageUsingHtmlImage` in
    // util/image_request.ts), but it is reached only when `supportImageRefresh === false`,
    // and raster_tile_source.ts feeds that from the Map's `refreshExpiredTiles` option,
    // which defaults to `true` (ui/map.ts). This app never passes it, so every tile goes
    // through `fetch` and is governed by `connect-src` ONLY. Verified in Chromium: without
    // the tile origin in `img-src`, all 24 tiles still load with zero violations.
    // TRIPWIRE: if the app ever constructs the Map with `refreshExpiredTiles: false`, tiles
    // switch to `<img>` and the carto origin has to be added to this line.
    "img-src 'self' data: blob:",

    // 🔴 `blob:` IS LOAD-BEARING, AND ITS FAILURE MODE IS SILENT. maplibre-gl builds its
    // worker bundle as a string, wraps it in `new Blob([workerBundleString…])` and spawns
    // `new Worker(URL.createObjectURL(…))`.
    // MEASURED with `worker-src 'self'` (blob: removed) against this build: the basemap,
    // the zoom/locate controls and the CARTO attribution ALL still render, so the page
    // looks like a working map — but every GeoJSON cluster and place marker disappears,
    // because clustering runs in that worker. A glance at the page does not catch it; the
    // only signal is one console error ("Creating a worker from 'blob:…' violates the
    // following Content Security Policy directive").
    // `'self'` additionally covers the service worker at `/sw.js`.
    "worker-src 'self' blob:",

    `connect-src ${connect}`,

    // Firebase Auth hosts its OAuth iframe (`__/auth/iframe`) and popup handler
    // (`__/auth/handler`) on the project's `authDomain`, which is a `*.firebaseapp.com`
    // origin distinct from this one. Needed by Google account linking.
    'frame-src https://*.firebaseapp.com',

    // No <object>/<embed> anywhere in the app, and no <iframe> of our own.
    "object-src 'none'",
    // Stops an injected <base> from re-pointing every relative URL on the page.
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

/**
 * Referrer policy.
 *
 * This is NOT a default-value shrug. A shared trip link carries the trip's CAPABILITY
 * TOKEN in the query string (`?trip=<token>` — see lib/firebase-config.ts `getTripId`,
 * where the pack id IS the token, and components/trip-join-handshake.tsx). The app links
 * out to Google Maps, Rome2Rio, Flightradar24 and others, so a policy that sends the full
 * URL cross-origin would hand that token to every one of those third parties in a
 * `Referer` header. `strict-origin-when-cross-origin` sends only the bare origin
 * cross-origin — no path, no query — so the token cannot leak this way, while same-origin
 * navigation keeps the full URL.
 */
export const REFERRER_POLICY = 'strict-origin-when-cross-origin';
