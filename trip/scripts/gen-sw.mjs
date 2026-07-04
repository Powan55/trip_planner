// scripts/gen-sw.mjs — runs at BUILD time, AFTER `next build` (see package.json
// "build" script). Walks the exported out/ directory, computes the precache
// file list, and emits:
//
//   out/manifest.webmanifest   the web app manifest (basePath-correct per build)
//   out/sw.js                  a hand-rolled, dependency-free service worker
//
// WHY hand-rolled: the app uses output:'export' + trailingSlash:true + a GitHub
// Pages basePath + a CUSTOM webpack output.filename =
// 'static/chunks/[name]-[contenthash:8].js' in next.config.js. next-pwa
// (unmaintained) and @serwist/next (webpack-injection collision with that custom
// filename) were both rejected. So we emit the SW ourselves as a plain literal
// string, no runtime dependency, ~150 lines, auditable.
//
// basePath (single prefix): out/ file paths are basePath-agnostic on disk, but
// the BROWSER requests URLs under the basePath. This script is the SINGLE prefix
// source at build time: read NEXT_PUBLIC_BASE_PATH once and prefix every emitted
// URL EXACTLY once (precache entries, manifest start_url/scope/icon src). Never
// double-prefix.

import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep, posix } from 'node:path';
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'out');

// ---- single basePath source --------------------------------------------
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';
// Prefix a root-relative "/x" path with the basePath EXACTLY once. No-op when
// BASE_PATH is empty, so local dev never gets a stray prefix.
const withBase = (p) => `${BASE_PATH}${p}`;

// The navy-900 the app's <body> actually paints (Tailwind token `navy-900`,
// tailwind.config.ts; body className bg-navy-900 in app/layout.tsx). Same hex
// as gen-icons.mjs so installed app + splash + address bar all agree.
const THEME_COLOR = '#0a0e27';

// The five real route HTMLs (trailingSlash:true => nested index.html) + the
// export's 404 fallback. These MUST all be precached so navigations resolve
// offline.
const ROUTE_HTML = [
  'index.html',
  'plan/index.html',
  'nepal/index.html',
  'japan/index.html',
  'map/index.html',
  '404.html',
];

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

// Build the precache list:
//   - every route HTML (5 routes + 404.html)
//   - ALL of _next/static/**
//   - manifest.webmanifest
//   - icons/**  and  favicon.svg
//   - EXCLUDE public/images/** (~10 MB AVIF/WebP) — runtime-cached instead.
async function buildPrecacheList(allFiles) {
  const set = new Set();

  for (const rel of ROUTE_HTML) {
    // 404.html always exists; guard the rest but they're expected.
    set.add(rel);
  }

  for (const rel of allFiles) {
    if (rel.startsWith('_next/static/')) set.add(rel);
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
// behaviour we want to avoid. First install is unaffected: with no existing
// controller the new worker activates immediately regardless, so there is no
// reload loop on a clean profile.
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE);
      // addAll is atomic-ish; if any single request fails the whole install
      // rejects. Use individual puts so one stray 404 can't brick the install.
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            const res = await fetch(url, { cache: 'no-cache' });
            if (res && (res.ok || res.type === 'opaque')) {
              await cache.put(url, res.clone());
            }
          } catch (_) {
            /* ignore individual precache misses (offline-first is best-effort) */
          }
        })
      );
    })()
  );
});

// --- activate: drop stale precaches, take control ------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('trip-precache-') && k !== PRECACHE)
          .map((k) => caches.delete(k))
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

// --- fetch routing -------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // FIRST LINE: cross-origin -> return untouched. This protects Firebase
  // (firestore/identitytoolkit), gstatic, font hosts — the SW must never
  // intercept their traffic, so their offline degradation stays intact.
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
          // <img onError> fallback art handles the missing image).
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

  // 1) Emit the manifest FIRST so it lands on disk before we hash the file list
  //    (the manifest is itself a precache entry).
  const manifestJson = await buildManifest();
  await writeFile(join(OUT_DIR, 'manifest.webmanifest'), manifestJson, 'utf8');
  console.log('gen-sw: wrote out/manifest.webmanifest');

  // 2) Walk out/, build the precache file list + browser URLs.
  const allFiles = await walk(OUT_DIR);
  const precacheFiles = await buildPrecacheList(allFiles);
  const precacheUrls = precacheFiles.map(toPrecacheUrl);

  // 3) Hash the URL list -> cache name. Any change to the shell (new chunk
  //    hashes, new route, changed manifest) changes this, driving the update
  //    flow in the registrar.
  const precacheHash = createHash('sha256')
    .update(precacheUrls.join('\n'))
    .digest('hex')
    .slice(0, 12);

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
