// scripts/gen-sw.mjs — runs at BUILD time, AFTER `next build` (see package.json
// "build" script). Walks the exported out/ directory, computes the precache
// file list, and emits:
//
// out/manifest.webmanifest the web app manifest (basePath-correct per build)
// out/sw.js a hand-rolled, dependency-free service worker
//
// WHY hand-rolled: the app uses output:'export' +
// trailingSlash:true + a GitHub Pages basePath + a CUSTOM webpack
// output.filename = 'static/chunks/[name]-[contenthash:8].js' in next.config.js.
// next-pwa (unmaintained) and @serwist/next (webpack-injection collision with
// that custom filename) were REJECTED. So we emit the SW ourselves as a plain
// literal string, no runtime dependency, ~150 lines, auditable.
//
// basePath: out/ file paths are basePath-
// agnostic on disk, but the BROWSER requests URLs under the basePath. This
// script is the SINGLE prefix source at build time: read
// NEXT_PUBLIC_BASE_PATH once and prefix every emitted URL EXACTLY once
// (precache entries, manifest start_url/scope/icon src). Never double-prefix.
//
// TD-07 / (behavior change): this script also deletes Next's nomodule
// polyfill chunk (out/_next/static/chunks/polyfills-*.js, ~112KB) and strips
// its <script... nomodule> tag from every route HTML post-build. This DROPS
// support for pre-ES-module (legacy, nomodule-only) browsers — support the app
// never really had, since any Service-Worker-capable browser is already a
// module browser and never executes a nomodule script. Net: 112KB less shipped
// and precached per installed client. See stripPolyfills() below.

import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep, posix } from 'node:path';
import { readdir, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'out');

// ---- single basePath source ------------------------------------
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';
// Prefix a root-relative "/x" path with the basePath EXACTLY once. No-op when
// BASE_PATH is empty, so local dev never gets a stray prefix.
const withBase = (p) => `${BASE_PATH}${p}`;

// The navy-900 the app's <body> actually paints (Tailwind token `navy-900`,
// tailwind.config.ts; body className bg-navy-900 in app/layout.tsx). Same hex
// as gen-icons.mjs so installed app + splash + address bar all agree.
const THEME_COLOR = '#0a0e27';

// -------------------------------------------------------------------------
// Recursively list every file under a directory as out/-relative POSIX paths.
async function walk(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (entry.isFile()) {
      out.push(relative(OUT_DIR, full).split(sep).join(posix.sep));
    }
  }
  return out;
}

// Build the precache list per the contract:
// - every route HTML (trailingSlash:true => <route>/index.html) + 404.html
// - ALL of _next/static/**
// - manifest.webmanifest
// - icons/** and favicon.svg
// - EXCLUDE public/images/** (~10 MB AVIF/WebP) — runtime-cached instead.
//
// TD-04: route HTML is DISCOVERED by walking out/ (below), not a hand-kept
// literal. Every route MUST be precached so navigations resolve offline; the
// old ROUTE_HTML array silently dropped any new route someone forgot to add
// Discovery removes that footgun.
async function buildPrecacheList(allFiles) {
  const set = new Set();

  for (const rel of allFiles) {
    // Route HTML: top-level index.html + every nested <route>/index.html, plus
    // the export's 404.html fallback. EXCLUDE 404/index.html: Next emits BOTH
    // 404.html (the canonical fallback the nav handler serves — see
    // NAV_FALLBACK/404 logic) and a redundant 404/index.html route dir;
    // precaching the fallback alone matches historical behavior and avoids a
    // duplicate /404/ precache entry.
    if (rel === 'index.html' || rel === '404.html') set.add(rel);
    else if (rel.endsWith('/index.html') && rel !== '404/index.html') set.add(rel);
    else if (rel.startsWith('_next/static/')) set.add(rel);
    else if (rel.startsWith('icons/')) set.add(rel);
    else if (rel === 'favicon.svg') set.add(rel);
    else if (rel === 'manifest.webmanifest') set.add(rel);
    // NOTE: images/** deliberately excluded (runtime cache).
  }

  // Deterministic order so the hash is stable across identical builds.
  return [...set].sort();
}

// Turn an out/-relative path into the URL the browser will request. Route
// index.html files are precached under their DIRECTORY url (trailingSlash:true)
// so a navigation to /plan/ hits the cached entry; everything else keeps its
// literal path.
function toPrecacheUrl(rel) {
  if (rel === 'index.html') return withBase('/');
  if (rel === '404.html') return withBase('/404.html');
  if (rel.endsWith('/index.html')) {
    return withBase('/' + rel.slice(0, -'index.html'.length)); // -> /plan/
  }
  return withBase('/' + rel);
}

// -------------------------------------------------------------------------
async function buildManifest() {
  const manifest = {
    name: 'Nepal × Japan Journey',
    short_name: 'Nepal×Japan',
    description:
      'Premium offline-capable travel planner for an epic Nepal and Japan adventure.',
    start_url: withBase('/'),
    scope: withBase('/'),
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: THEME_COLOR,
    theme_color: THEME_COLOR,
    icons: [
      {
        src: withBase('/icons/icon-192.png'),
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: withBase('/icons/icon-512.png'),
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: withBase('/icons/icon-maskable-512.png'),
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    // long-press/right-click app-icon shortcuts (W3C manifest `shortcuts`
    // member) to 3 high-value, already-existing routes. Icons are optional per
    // spec and deliberately omitted here (keeps this hand-maintained list free
    // of another icon-path to keep in sync — pattern of staying simple).
    shortcuts: [
      {
        name: "Today's Itinerary",
        short_name: 'Itinerary',
        url: withBase('/plan/'),
      },
      {
        name: 'Trip Budget',
        short_name: 'Budget',
        url: withBase('/plan/#budget-panel-title'),
      },
      {
        name: 'Countdown',
        short_name: 'Countdown',
        url: withBase('/#dashboard'),
      },
    ],
    // register as an OS share target so the installed PWA appears in the
    // system Share sheet. GET is the ONLY method a static export (output:'export', no
    // server) can serve — the shared title/text/url arrive as query params on a plain
    // navigation to /share/, where the ssr:false island captures + persists them (gateway
    // key 23) then strips the query. Trailing-slash `action` matches how every other static
    // route resolves (trailingSlash:true). `share/index.html` is added to ROUTE_HTML above
    // so the receiving surface is precached and resolves offline like every other route.
    share_target: {
      action: withBase('/share/'),
      method: 'GET',
      params: {
        title: 'title',
        text: 'text',
        url: 'url',
      },
    },
  };
  return JSON.stringify(manifest, null, 2);
}

// -------------------------------------------------------------------------
// Emit the service worker as a literal string. Kept dependency-free and
// auditable. The precache URL list and cache name (hashed from that list) are
// baked in at build time; everything else is static SW logic.
function buildServiceWorker({ precacheUrls, precacheHash }) {
  const PRECACHE = `trip-precache-${precacheHash}`;
  const IMAGES_CACHE = 'trip-images-v1';
  const IMAGE_CACHE_LIMIT = 80;
  // The navigation fallback: the cached shell for the app root.
  const NAV_FALLBACK = withBase('/');

  return `/* AUTO-GENERATED by scripts/gen-sw.mjs — do not edit by hand.
 * Hand-rolled, dependency-free service worker. Precache is content-
 * hashed (${PRECACHE}); a new build with a changed file list yields a new
 * cache name and drives the update-available flow in the registrar.
 */
const PRECACHE = ${JSON.stringify(PRECACHE)};
const IMAGES_CACHE = ${JSON.stringify(IMAGES_CACHE)};
const IMAGE_CACHE_LIMIT = ${IMAGE_CACHE_LIMIT};
const NAV_FALLBACK = ${JSON.stringify(NAV_FALLBACK)};
const PRECACHE_URLS = ${JSON.stringify(precacheUrls, null, 2)};

// --- install: precache the app shell -------------------------------------
// NOTE: NO self.skipWaiting() here. An updated worker MUST stay
// in the waiting state while the old one still controls, so the registrar can
// surface the "New version available" toast and only activate on a Refresh
// click (via the SKIP_WAITING message handler below). An unconditional
// skipWaiting would make every update a silent auto-reload -- the exact
// behaviour forbids. First install is unaffected: with no existing
// controller the new worker activates immediately regardless, so there is no
// reload loop on a clean profile.
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE);
      // ATOMIC install (P3, R5.2): every precache URL is same-origin, so a
      // healthy build MUST fetch each one OK. If ANY entry fails to fetch OK,
      // THROW so this waitUntil rejects -- the worker then never reaches the
      // activate handler, so the previous good precache (deleted ONLY in
      // activate, below) stays fully intact and the last good build keeps
      // serving. This is the torn-state guard: GitHub Pages deploys are not
      // atomic, so a client can fetch a manifest from build N and an asset still
      // on build N+1; we refuse to commit a half-populated shell rather than
      // silently cache a miss (the classic SW bug that permanently serves the
      // wrong shell). No opaque special-case: precache URLs are never opaque.
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          const res = await fetch(url, { cache: 'no-cache' });
          if (!res || !res.ok) {
            throw new Error(
              'precache fetch failed: ' + url + ' -> ' + (res ? res.status : 'no response')
            );
          }
          await cache.put(url, res.clone());
        })
      );
    })()
  );
});

// --- activate: drop every non-allowlisted cache, take control ------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // ALLOWLIST cleanup (R5.3): delete ANY cache key not in the current set —
      // the active precache PLUS the two runtime caches. This drops the previous
      // build's trip-precache-* (atomic activation) AND garbage-collects renamed
      // runtime caches (e.g. a bumped trip-images-v1 -> v2, or a retired
      // frankfurter cache) that the old prefix-only filter would have leaked
      // forever. FRANKFURTER_CACHE is declared lower in this file; it is only
      // read here at activate time (well after module eval), so no TDZ issue.
      const allowlist = new Set([PRECACHE, IMAGES_CACHE, FRANKFURTER_CACHE]);
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => !allowlist.has(k)).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// --- skip-waiting handshake (registrar posts this on "Refresh") ----------
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// --- helpers -------------------------------------------------------------
// Normalize a same-origin URL to its trailingSlash form so /plan and /plan/
// both hit the cached /plan/ entry.
function normalizePath(url) {
  let pathname = url.pathname;
  if (!pathname.endsWith('/') && !pathname.includes('.')) {
    pathname = pathname + '/';
  }
  return pathname;
}

function isImageRequest(request, url) {
  if (request.destination === 'image') return true;
  return /\\.(?:png|jpe?g|gif|webp|avif|svg|ico)$/i.test(url.pathname);
}

// LRU-ish cap on the runtime image cache: evict oldest (insertion order) on
// overflow. Cache API keys() returns entries in insertion order.
async function trimImageCache() {
  const cache = await caches.open(IMAGES_CACHE);
  const keys = await cache.keys();
  if (keys.length <= IMAGE_CACHE_LIMIT) return;
  const overflow = keys.length - IMAGE_CACHE_LIMIT;
  for (let i = 0; i < overflow; i++) {
    await cache.delete(keys[i]);
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res && res.ok && res.type === 'basic') {
    const cache = await caches.open(cacheName);
    cache.put(request, res.clone());
  }
  return res;
}

// stale-while-revalidate for Frankfurter (api.frankfurter.dev, the Travel Mode Essentials
// currency rate, lib/currency-rate.ts) — ONE deliberate, hand-added exception (: gen-sw.mjs
// is hand-maintained) to the cross-origin passthrough just below. Serves the cached response
// immediately when present (instant, offline-safe) while refreshing it in the background;
// falls through to a plain network fetch on a cold cache. This is a network-layer NICETY only —
// \`lib/currency-rate.ts\`'s own localStorage cache is the dormant-safe guarantee
// (an offline "as of <date>" line even with this SW cache empty); this just avoids a redundant
// round-trip when a good one is already sitting in the Cache API. No other cross-origin host is
// touched here — Firebase/gstatic/font hosts still hit the untouched-passthrough line below.
const FRANKFURTER_CACHE = 'trip-frankfurter-v1';
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => undefined);
  return cached || (await network) || Response.error();
}

// --- fetch routing -------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method === 'GET' && url.hostname === 'api.frankfurter.dev') {
    event.respondWith(staleWhileRevalidate(request, FRANKFURTER_CACHE));
    return;
  }

  // FIRST LINE: cross-origin -> return untouched. This protects
  // Firebase (firestore/identitytoolkit), gstatic, font hosts — the SW must
  // never intercept their traffic, so their offline degradation stays intact.
  if (url.origin !== self.location.origin) {
    return;
  }

  // Only GET is cacheable; let the rest hit the network.
  if (request.method !== 'GET') {
    return;
  }

  // Runtime image cache (cache-first, LRU-capped, separate cache).
  if (isImageRequest(request, url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request, { cacheName: IMAGES_CACHE });
        if (cached) return cached;
        try {
          const res = await fetch(request);
          if (res && res.ok && res.type === 'basic') {
            const cache = await caches.open(IMAGES_CACHE);
            await cache.put(request, res.clone());
            trimImageCache();
          }
          return res;
        } catch (err) {
          // Offline and uncached — fall through to a network error (the app's
          // <img onError> fallback art handles the missing image,).
          return caches.match(request) || Response.error();
        }
      })()
    );
    return;
  }

  // Same-origin navigations: cache-first on the normalized pathname, falling
  // back to the cached app-root shell on a miss (SPA-style offline nav).
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const normalized = normalizePath(url);
        const cached = await caches.match(normalized);
        if (cached) return cached;
        try {
          const res = await fetch(request);
          // Nav backfill (P3): a route missed at install (or added between
          // builds) is cached under its normalized path on first successful
          // online visit, so it resolves offline next time instead of falling
          // back to the app-root shell. Only OK, same-origin ('basic')
          // responses — never backfill an error/opaque/redirect response into
          // the precache. Fire-and-forget (mirrors cacheFirst) so it never
          // delays the navigation response.
          if (res && res.ok && res.type === 'basic') {
            const copy = res.clone(); // clone NOW, before the browser locks the body
            caches.open(PRECACHE).then((cache) => cache.put(normalized, copy));
          }
          return res;
        } catch (err) {
          const shell = await caches.match(NAV_FALLBACK);
          if (shell) return shell;
          const fallback = await caches.match(${JSON.stringify(withBase('/404.html'))});
          return fallback || Response.error();
        }
      })()
    );
    return;
  }

  // Same-origin static assets: cache-first.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        return await cacheFirst(request, PRECACHE);
      } catch (err) {
        return Response.error();
      }
    })()
  );
});
`;
}

// -------------------------------------------------------------------------
// TD-07 /: delete the nomodule polyfill chunk and strip its <script>
// tag from every HTML file under out/. Runs BEFORE the precache walk so the
// deleted chunk falls out of the precache list automatically (TD-04 walk).
// Fail-soft: 0 deletions is not an error, but WARN so a future Next filename
// change (polyfill glob matches nothing) stays visible.
async function stripPolyfills() {
  const chunksDir = join(OUT_DIR, '_next', 'static', 'chunks');
  let deleted = 0;
  try {
    for (const name of await readdir(chunksDir)) {
      if (/^polyfills-.*\.js$/.test(name)) {
        await rm(join(chunksDir, name));
        deleted++;
      }
    }
  } catch {
    /* chunks dir absent (unexpected) — nothing to delete */
  }

  // Strip any <script...polyfills-*...></script> tag from every HTML file. The
  // src is basePath-prefixed in prod, so match on the filename, not a full URL.
  const htmlFiles = (await walk(OUT_DIR)).filter((r) => r.endsWith('.html'));
  let stripped = 0;
  for (const rel of htmlFiles) {
    const p = join(OUT_DIR, rel);
    const html = await readFile(p, 'utf8');
    const next = html.replace(/<script\b[^>]*polyfills-[^>]*><\/script>/gi, '');
    if (next !== html) {
      await writeFile(p, next, 'utf8');
      stripped++;
    }
  }

  if (deleted === 0) {
    console.warn(
      'gen-sw: WARN (TD-07) matched NO polyfills-*.js chunk — Next may have renamed the polyfill pattern; verify the glob so the strip does not silently no-op.'
    );
  }
  console.log(
    `gen-sw: TD-07 dropped nomodule polyfill — deleted ${deleted} chunk(s), stripped tag from ${stripped} HTML file(s)`
  );
}

// -------------------------------------------------------------------------
async function main() {
  try {
    await stat(OUT_DIR);
  } catch {
    console.error(
      `gen-sw: out/ not found at ${OUT_DIR}. Run \`next build\` first.`
    );
    process.exit(1);
  }

  console.log(`gen-sw: basePath = ${BASE_PATH === '' ? '(empty)' : BASE_PATH}`);

  // 0) TD-07: strip the nomodule polyfill (chunk + HTML tags) BEFORE the walk
  // so it never enters the precache list.
  await stripPolyfills();

  // 1) Emit the manifest FIRST so it lands on disk before we hash the file list
  // (the manifest is itself a precache entry).
  const manifestJson = await buildManifest();
  await writeFile(join(OUT_DIR, 'manifest.webmanifest'), manifestJson, 'utf8');
  console.log('gen-sw: wrote out/manifest.webmanifest');

  // 2) Walk out/, build the precache file list + browser URLs.
  const allFiles = await walk(OUT_DIR);
  const precacheFiles = await buildPrecacheList(allFiles);
  const precacheUrls = precacheFiles.map(toPrecacheUrl);

  // 3) Hash the precached files' CONTENTS (rel path + '\0' + bytes, over the
  // already-sorted list) -> cache name. Hashing only the URL list (the old
  // scheme) missed builds where a stable-URL file's BYTES changed — e.g.
  // route HTML at /, /plan/, … changes every build without changing the
  // chunk set — leaving the cache-first nav handler serving a stale shell.
  // Any byte change anywhere in the precache set now yields a new cache
  // name, driving the update flow in the registrar.
  const h = createHash('sha256');
  for (const rel of precacheFiles) {
    h.update(rel).update('\0').update(await readFile(join(OUT_DIR, rel)));
  }
  const precacheHash = h.digest('hex').slice(0, 12);

  // 4) Emit the SW.
  const sw = buildServiceWorker({ precacheUrls, precacheHash });
  await writeFile(join(OUT_DIR, 'sw.js'), sw, 'utf8');
  console.log(
    `gen-sw: wrote out/sw.js (cache trip-precache-${precacheHash}, ${precacheUrls.length} precache entries)`
  );

  // 5) Log a few sample URLs for the single-prefix proof.
  console.log('gen-sw: manifest start_url/scope =', withBase('/'));
  console.log('gen-sw: sample precache URLs:');
  for (const u of precacheUrls.slice(0, 4)) console.log('   ', u);
}

main().catch((err) => {
  console.error('gen-sw FAILED:', err);
  process.exit(1);
});
