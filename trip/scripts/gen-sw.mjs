// Runs after `next build`. Walks out/, computes the precache list, and writes
// out/manifest.webmanifest and out/sw.js, a hand-rolled service worker.
//
// Hand-rolled because next-pwa is unmaintained and @serwist/next collides with the custom
// chunk filenames in next.config.js.
//
// This is the only place URLs get the basePath prefix: read NEXT_PUBLIC_BASE_PATH once and
// prefix every emitted URL exactly once.
//
// Also deletes Next's nomodule polyfill chunk (~112KB) and its script tag. Any browser that
// can run a service worker is a module browser and never ran it.

import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative, resolve, sep, posix } from 'node:path';
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

// --background. Keep in step with gen-icons.mjs and themeColor in app/layout.tsx.
const THEME_COLOR = '#0A0818';

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

// The _next/static files referenced by any route HTML, plus the fonts their CSS url()s.
// out/-relative with no leading slash, so matching ignores basePath. Lazy per-route chunks
// (maplibre among them) fall out and are cached on first online use.
// Every route's HTML, not just index.html: without its own page chunk a precached route
// renders the error boundary offline.
// This can't see ssr:false islands, which is how the root layout's chrome is declared;
// islandAssets() covers those.
async function eagerStaticAssets(htmlFiles, baseDir = OUT_DIR) {
  const REF = /_next\/static\/[A-Za-z0-9._\/-]+/g;
  const set = new Set();
  for (const rel of htmlFiles) {
    const html = await readFile(join(baseDir, rel), 'utf8');
    const refs = html.match(REF) ?? [];
    // Per route, not aggregate: every route HTML must yield at least one ref.
    if (refs.length === 0) {
      throw new Error(
        `gen-sw: route HTML ${rel} scraped zero _next/static reference(s); the ` +
          '_next/static reference shape may have changed.'
      );
    }
    for (const ref of refs) set.add(ref);
  }
  for (const rel of [...set]) {
    if (!rel.endsWith('.css')) continue;
    const css = await readFile(join(baseDir, rel), 'utf8');
    for (const ref of css.match(REF) ?? []) set.add(ref);
  }
  return set;
}

// Chunks for ssr:false islands, which never appear in HTML. Without them a cold-offline
// install crashes on every route: the root layout's chrome is all islands, and a layout
// ChunkLoadError lands in global-error.
//
// Source of truth is .next/react-loadable-manifest.json ("<file> -> <specifier>" to chunks).
// The seed is derived, never hand-listed (a hand list once missed an island):
// 1. walk the static import graph of app/layout.tsx and every app/**/page.tsx;
// 2. keep the manifest call sites found in that graph;
// 3. follow only specifiers that resolve under components/, transitively.
// Step 3 keeps lazily imported libraries (firebase via lib/presence, ~600 KB) out: those
// only reject a promise, while a missing component chunk throws during render.
//
// maplibre is withheld (D-274): ~363 KB gzipped for /map, which isn't promised offline.
// isMaplibreChunk() drops its small shared chunk, and the engine is never a candidate because
// its bare specifier doesn't resolve locally. It's cached on the first online /map visit.
// Map islands therefore need an error boundary; assertMapIslandsWrapped() enforces it.
//
// Returned entries not on disk are harmless: buildPrecacheList only tests membership.
const NEXT_DIR = join(ROOT, '.next'); // next.config.js: distDir = '.next'
const APP_DIR = 'app';
const ROOT_LAYOUT = 'app/layout.tsx';
const SOURCE_EXTS = ['.tsx', '.ts', '.jsx', '.js'];

// Every app/**/page.tsx, found by walking. Each imports its ./sections module, so the static
// walk reaches every route's islands.
async function routeEntryFiles() {
  const found = [];
  const walkDir = async (rel) => {
    let entries;
    try {
      entries = await readdir(join(ROOT, rel), { withFileTypes: true });
    } catch {
      return; // app/ missing is caught by the zero-call-sites floor below
    }
    for (const entry of entries) {
      const child = posix.join(rel, entry.name);
      if (entry.isDirectory()) await walkDir(child);
      else if (entry.name === 'page.tsx') found.push(child);
    }
  };
  await walkDir(APP_DIR);
  return found;
}

// Does this chunk carry maplibre? Decides both what's withheld and which call sites need the
// boundary. By content, since async chunk names are bare hashes (next.config.js).
// .js only: the app's own CSS also contains `maplibregl`, and withholding it would ship an
// unstyled offline app.
const MAPLIBRE_MARKER = 'maplibregl';
async function isMaplibreChunk(file) {
  if (!file.endsWith('.js')) return false;
  try {
    const source = await readFile(join(OUT_DIR, '_next', file), 'utf8');
    return source.includes(MAPLIBRE_MARKER);
  } catch {
    return false; // not on disk => cannot be precached anyway
  }
}
// `import x from 'y'` / `import 'y'` / `import type … from 'y'`. Deliberately a
// regex and not a TS parse: we only need local module EDGES, and every import in
// this codebase is a plain static one at the top of the file.
const STATIC_IMPORT_RE = /(?:^|\n)\s*import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;

async function islandAssets() {
  const onDisk = async (rel) => {
    try {
      await stat(join(ROOT, rel));
      return true;
    } catch {
      return false;
    }
  };
  // Resolve a local specifier to a repo-relative source file. '@/x' is the tsconfig
  // path alias for './x' (tsconfig.json `paths`). A BARE package specifier
  // (maplibre-gl, firebase/app, next/dynamic) returns null and ends the walk.
  const resolveLocal = async (fromFile, specifier) => {
    let base;
    if (specifier.startsWith('@/')) base = specifier.slice(2);
    else if (specifier.startsWith('./') || specifier.startsWith('../')) {
      base = posix.normalize(posix.join(posix.dirname(fromFile), specifier));
    } else return null;
    for (const ext of SOURCE_EXTS) if (await onDisk(base + ext)) return base + ext;
    for (const ext of SOURCE_EXTS) if (await onDisk(`${base}/index${ext}`)) return `${base}/index${ext}`;
    return null;
  };

  // 1) Static import graph of the root layout and every route entry.
  const seeds = [ROOT_LAYOUT, ...(await routeEntryFiles())];
  const sourceGraph = new Set();
  const graphQueue = [...seeds];
  while (graphQueue.length) {
    const file = graphQueue.shift();
    if (sourceGraph.has(file)) continue;
    sourceGraph.add(file);
    let source;
    try {
      source = await readFile(join(ROOT, file), 'utf8');
    } catch {
      continue;
    }
    for (const match of source.matchAll(STATIC_IMPORT_RE)) {
      const resolved = await resolveLocal(file, match[1]);
      if (resolved && !sourceGraph.has(resolved)) graphQueue.push(resolved);
    }
  }

  // 2) Next's own call-site → chunk-files map. Keys are "<source> -> <specifier>",
  // and the source half uses the HOST separator (backslashes on Windows,
  // forward on CI) — normalize before matching.
  let manifest;
  try {
    manifest = JSON.parse(
      await readFile(join(NEXT_DIR, 'react-loadable-manifest.json'), 'utf8')
    );
  } catch (err) {
    // was console.warn + return empty. Now a THROW — see the zero-call-sites
    // floor below for the reasoning (a silent zero here ships an app that crashes on
    // every route cold-offline, under a green build).
    throw new Error(
      'gen-sw — could not read .next/react-loadable-manifest.json, so the app\'s ' +
        'ssr:false islands (Navbar/Footer/BottomTabBar/TravelModeMounts/every route section) ' +
        'CANNOT be precached and a cold-offline install would crash on EVERY route. Next may ' +
        `have renamed or dropped this manifest; find its replacement before shipping. (${err})`
    );
  }
  const bySource = new Map();
  for (const [key, entry] of Object.entries(manifest)) {
    const normalized = key.split('\\').join('/');
    const at = normalized.indexOf(' -> ');
    if (at === -1) continue;
    const source = normalized.slice(0, at);
    if (!bySource.has(source)) bySource.set(source, []);
    bySource.get(source).push({
      specifier: normalized.slice(at + 4),
      files: entry.files ?? [],
    });
  }

  // 3) Walk those modules → their dynamic COMPONENT islands, transitively.
  const files = new Set();
  const visited = new Set();
  const queue = [...sourceGraph].filter((f) => bySource.has(f));
  const sites = [];
  // Call sites that lost maplibre chunks, i.e. the ones that can throw at render and need
  // components/map-island-boundary.tsx. Derived, so new map islands are caught.
  const mapSites = [];
  while (queue.length) {
    const source = queue.shift();
    if (visited.has(source)) continue;
    visited.add(source);
    for (const { specifier, files: chunkFiles } of bySource.get(source) ?? []) {
      const target = await resolveLocal(source, specifier);
      if (!target || !target.startsWith('components/')) continue; // render path only
      sites.push(`${source} -> ${specifier}`);
      let mapChunks = 0;
      for (const file of chunkFiles) {
        // WITHHELD again. See the maplibre note in this function's
        // docblock. The count is kept because it identifies the call sites that
        // render a MAP island, i.e. exactly the ones that need the error boundary.
        if (await isMaplibreChunk(file)) {
          mapChunks++;
          continue;
        }
        files.add(`_next/${file}`);
      }
      if (mapChunks > 0) mapSites.push({ site: `${source} -> ${specifier}`, mapChunks });
      if (bySource.has(target)) queue.push(target);
    }
  }

  // The engine is only measured and reported here, never added; this feeds the floor below.
  const manifestChunks = new Set();
  for (const entries of bySource.values()) {
    for (const { files: chunkFiles } of entries) for (const file of chunkFiles) manifestChunks.add(file);
  }
  let maplibreBytes = 0;
  const maplibreWithheld = [];
  for (const file of manifestChunks) {
    if (!(await isMaplibreChunk(file))) continue;
    maplibreWithheld.push(file);
    try {
      maplibreBytes += (await stat(join(OUT_DIR, '_next', file))).size;
    } catch {
      /* not on disk => nothing to withhold */
    }
  }

  // Throw, not warn: zero call sites means the derivation broke and the build would crash
  // every route cold-offline while staying green.
  if (sites.length === 0) {
    throw new Error(
      `gen-sw — derived ZERO dynamic islands from ${seeds.length} seed(s) ` +
        `(${ROOT_LAYOUT} + every app/**/page.tsx; static graph: ${sourceGraph.size} module(s)). ` +
        "The app's ssr:false chrome and route sections would NOT be precached, so a " +
        'cold-offline install would crash on EVERY route. Check ROOT_LAYOUT/APP_DIR and the ' +
        '.next/react-loadable-manifest.json key shape.'
    );
  }
  console.log(
    `gen-sw: render-path islands — ${seeds.length} seed(s) (root layout + app/**/page.tsx), ` +
      `${sourceGraph.size} module(s) in the static graph, ${sites.length} dynamic island call site(s), ` +
      `${files.size} chunk file(s)`
  );
  for (const site of sites) console.log(`    island ${site}`);

  // If MAPLIBRE_MARKER stops matching, the boundary gate would inspect nothing and pass.
  if (maplibreWithheld.length === 0 || mapSites.length === 0) {
    throw new Error(
      `gen-sw — found ${maplibreWithheld.length} maplibre chunk(s) across ` +
        `${manifestChunks.size} manifest chunk file(s) and ${mapSites.length} maplibre call site(s); ` +
        'both must be non-zero. Zero means the content probe lost its grip (maplibre renamed the ' +
        `\`${MAPLIBRE_MARKER}\` marker, or the map islands were removed/restructured), which would ` +
        'BOTH let the map engine drift back INTO the precache unnoticed AND turn ' +
        'assertMapIslandsWrapped into a check that inspects nothing while still passing. If the ' +
        'map really was removed, delete this floor deliberately along with it.'
    );
  }

  // report: the engine is withheld, and the number is the point of the report.
  console.log(
    `gen-sw: maplibre WITHHELD from the precache — ${maplibreWithheld.length} chunk(s), ` +
      `${maplibreBytes} B (${(maplibreBytes / 1048576).toFixed(2)} MiB); ` +
      'runtime-cached on the first online /map visit (cacheFirst, see the SW body)'
  );
  for (const file of maplibreWithheld) console.log(`    maplibre ${file}`);

  // These render a map island and need the boundary.
  console.log(
    `gen-sw: ${mapSites.length} maplibre island call site(s) — each MUST be wrapped in ` +
      'components/map-island-boundary.tsx or a missing chunk crashes its whole route:'
  );
  for (const { site, mapChunks } of mapSites) {
    console.log(`    map-island ${site}  (${mapChunks} maplibre chunk(s))`);
  }
  // and the report is ENFORCED, not just printed (see assertMapIslandsWrapped).
  await assertMapIslandsWrapped(mapSites);
  return files;
}

// Fail the build unless every maplibre island call site is wrapped in MapIslandBoundary.
// Input is "call sites that render a map island", not "call sites we withheld from", so the
// gate can't go empty if the precache policy changes.
//
// Fails closed. A string search for MapIslandBoundary would pass on a wrap around the wrong
// island or a leftover import, so this resolves the island's local name and requires every
// JSX use to sit inside a boundary. Each failure mode throws:
// - boundary not imported
// - island declaration not found
// - zero JSX uses (createElement or re-export; can't prove the wrap)
// - a JSX use outside a boundary
// - nested boundaries (naive pairing gives a shorter region)
//
// KNOWN CEILING: lexical and single-file, so an island wrapped in another file fails the
// build. Switch to the TS compiler if that pattern becomes real.
const MAP_BOUNDARY_MODULE = '@/components/map-island-boundary';

// Blank comments in place (same length, newlines kept) so offsets stay exact and comments
// that mention a component don't match. Only block and whole-line // comments; a trailing
// `// <Foo />` still matches and fails the build, so reword it.
const blankComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^([ \t]*)\/\/[^\n]*/gm, (m, indent) => indent + ' '.repeat(m.length - indent.length));

async function assertMapIslandsWrapped(mapSites) {
  for (const { site } of mapSites) {
    const [source, specifier] = site.split(' -> ');
    const fix =
      `FIX: in ${source}, import ${MAP_BOUNDARY_MODULE} and wrap every render of the ` +
      `${specifier} island in <MapIslandBoundary label="…">…</MapIslandBoundary>. ` +
      'See app/map/sections.tsx for the shape.';
    const why =
      `${specifier} renders a maplibre island, and its chunk is deliberately NOT ` +
      'precached (V6-14): on any cold-offline render — and after a storage eviction — ' +
      'React.lazy THROWS at this call site and app/error.tsx replaces the ENTIRE route.';

    let src;
    try {
      src = blankComments(await readFile(join(ROOT, source), 'utf8'));
    } catch {
      throw new Error(
        `gen-sw — ${site} is a maplibre island but ${source} could not be read, ` +
          `so the island error boundary CANNOT be verified. ${why} ${fix}`
      );
    }

    // 1) The boundary's LOCAL name in this file (a rename still verifies).
    const boundary = src.match(
      new RegExp(`import\\s+(\\w+)\\s+from\\s+['"]${MAP_BOUNDARY_MODULE}['"]`)
    )?.[1];
    if (!boundary) {
      throw new Error(
        `gen-sw — ${site} is a maplibre island but ${source} does not import ` +
          `${MAP_BOUNDARY_MODULE}. ${why} ${fix}`
      );
    }

    // 2) The island's LOCAL identifier, resolved from its own dynamic() declaration
    // rather than guessed, so this checks THE island and not merely "some island".
    const island = src.match(
      new RegExp(
        `(?:const|let|var)\\s+(\\w+)\\s*=\\s*dynamic\\s*\\(\\s*\\(\\s*\\)\\s*=>\\s*import\\s*\\(\\s*['"]${specifier}['"]`
      )
    )?.[1];
    if (!island) {
      throw new Error(
        `gen-sw — ${site} is a maplibre island but its \`const X = dynamic(() => ` +
          `import('${specifier}'))\` declaration was not found in ${source}, so the boundary ` +
          `CANNOT be verified. ${why} ${fix}`
      );
    }

    // 3) Boundary regions: pair each open with the next close. Nesting yields a shorter
    // region, which fails rather than passes.
    const regions = [];
    for (let i = src.indexOf(`<${boundary}`); i !== -1; i = src.indexOf(`<${boundary}`, i + 1)) {
      const close = src.indexOf(`</${boundary}>`, i);
      if (close === -1) break;
      regions.push([i, close]);
    }

    // 4) Every JSX use of the island must sit inside one — and there must BE one.
    const uses = [];
    for (let i = src.indexOf(`<${island}`); i !== -1; i = src.indexOf(`<${island}`, i + 1)) {
      // `<Foo` must not match `<FooBar`.
      if (!/[\s/>]/.test(src[i + island.length + 1] ?? '')) continue;
      uses.push(i);
    }
    const naked = uses.filter((at) => !regions.some(([a, b]) => at > a && at < b));
    if (uses.length === 0 || naked.length > 0) {
      const lineOf = (at) => src.slice(0, at).split('\n').length;
      const detail =
        uses.length === 0
          ? `no JSX <${island} …> render was found in ${source}`
          : `<${island} …> is rendered OUTSIDE <${boundary}> at ${source}:` +
            naked.map(lineOf).join(', ');
      throw new Error(
        `gen-sw — ${site} is a maplibre island and UNPROTECTED: ${detail}. ${why} ${fix}`
      );
    }
    console.log(`    map-guard OK  ${site}  (<${island}> inside <${boundary}>)`);
  }
}

// Precache contents:
// - every route HTML (found by walking out/) + 404.html
// - the _next/static files those routes reference, plus the ssr:false island chunks
// - manifest.webmanifest, icons/**, favicon.svg
// - not font/** (map glyphs) or images/**, which are runtime-cached, except the hero
//   AVIFs below
// Route HTML is always precached in full (D-073).

// Hero AVIFs are the one image exception (D-335 amends D-073/D-086; read it first). The
// Japan-leg hero is never requested before that leg starts, and the image cache evicts by
// insertion order, so the default hero gets evicted early too.
// A path prefix, because images/hero/ holds only hero frames and their variants.
// AVIF only: browsers without AVIF get the .jpg, which isn't precached, so they see the SVG
// fallback offline (accepted in D-335). All three widths, since sizes="100vw" picks by DPR.
const HERO_PRECACHE = /^images\/hero\/[^/]+\.avif$/;

// Next 16 prefetches segment payloads (names from flatten-segment-payloads.mjs), so they
// must be precached or Link prefetches fail offline. _full.txt is skipped: large, and only
// used when the segment cache misses.
const SEGMENT_PAYLOAD = /(^|\/)__next\.(?!_full\.txt$)[^/]*\.txt$/;

// The root layout's payload is emitted identically under every route. Only the root copy is
// precached; the SW's cacheKey() maps the others onto it.
const ROOT_INDEX_PAYLOAD = '__next._index.txt';

// Byte-identical copies of 404.html; only 404.html is precached.
const NOT_FOUND_DUPLICATES = new Set(['404/index.html', '_not-found/index.html']);

// Pure predicate pulled out of buildPrecacheList so #417's dedup is testable without a
// real `.next`/`out` build (islandAssets() below needs both).
function isDedupedSegmentPayload(rel) {
  return SEGMENT_PAYLOAD.test(rel) && !rel.endsWith('/' + ROOT_INDEX_PAYLOAD);
}

// Pages and RSC payloads embed the build id, so they are never carried over from an old cache.
function precacheRevision(rel, bytes) {
  if (/\.(html|txt)$/.test(rel)) return null;
  return createHash('sha256').update(bytes).digest('hex').slice(0, 32);
}

async function buildPrecacheList(allFiles) {
  const set = new Set();
  const eager = await eagerStaticAssets(allFiles.filter((r) => r.endsWith('.html')));
  // UNION in the root layout's ssr:false island chunks, which the HTML scrape
  // above cannot see by construction (see islandAssets). A Set union, so an
  // asset both arms name is precached exactly once.
  for (const rel of await islandAssets()) eager.add(rel);

  for (const rel of allFiles) {
    // Route HTML and 404.html, minus the 404 duplicates.
    if (rel === 'index.html' || rel === '404.html') set.add(rel);
    else if (rel.endsWith('/index.html') && !NOT_FOUND_DUPLICATES.has(rel)) set.add(rel);
    // Whole-route RSC payloads. Next 16 wasn't seen requesting them, but its runtime still has
    // the code path, so they stay.
    else if (rel === 'index.txt' || rel.endsWith('/index.txt')) set.add(rel);
    // The 19 non-root copies are omitted; cacheKey() rewrites their URLs onto the root entry.
    else if (isDedupedSegmentPayload(rel)) set.add(rel);
    else if (rel.startsWith('_next/static/') && eager.has(rel)) set.add(rel);
    else if (rel.startsWith('icons/')) set.add(rel);
    // font/** (map glyphs, 154 KiB) is not precached: /map only, like the engine. Being
    // same-origin, it's cached on the first online map visit.
    else if (rel === 'favicon.svg') set.add(rel);
    else if (rel === 'manifest.webmanifest') set.add(rel);
    // Images are runtime-cached except the hero AVIFs. Matched against files that exist, so a
    // missing variant can't 404 the atomic install.
    else if (HERO_PRECACHE.test(rel)) set.add(rel);
  }

  // Deterministic order so the hash is stable across identical builds.
  return [...set].sort();
}

// Route index.html files are keyed by their directory URL (trailingSlash), so /plan/ matches.
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
    name: 'Trip Journey',
    short_name: 'Trip Journey',
    description:
      'Offline-ready trip planner: itinerary, map, bookings and a shared plan for your whole group.',
    start_url: withBase('/'),
    scope: withBase('/'),
    display: 'standalone',
    // WCAG 2.1 SC 1.3.4 (#248): nothing here is orientation-essential — no viewfinder, no
    // signature pad — so the installed app must not refuse landscape. Stated rather than
    // omitted; `any` IS the spec default, but naming it stops `portrait-primary` drifting back.
    orientation: 'any',
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
    // App-icon shortcuts. No icons, to avoid another path to keep in sync.
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
    // OS share target. GET, since a static export has no server; /share/ reads the query
    // params, stores them and strips the query.
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

// The service worker as a literal string. The precache list and cache name (sha256 of each
// file's path and bytes, see main()) are baked in at build time.
function buildServiceWorker({ precacheUrls, precacheHash, precacheRevisions, buildId, runtimeUrls, runtimeHash }) {
  const PRECACHE = `trip-precache-${precacheHash}`;
  const RUNTIME_CACHE_NAME = `trip-runtime-${runtimeHash}`;
  const IMAGES_CACHE = 'trip-images-v1';
  const IMAGE_CACHE_LIMIT = 80;
  // The navigation fallback: the cached shell for the app root.
  const NAV_FALLBACK = withBase('/');

  return `/* AUTO-GENERATED by scripts/gen-sw.mjs — do not edit by hand.
 * Hand-rolled, dependency-free service worker. Precache is content-
 * hashed (${PRECACHE}) over every precached file's path and bytes; any byte
 * change yields a new cache name and drives the update-available flow in the
 * registrar.
 */
const PRECACHE = ${JSON.stringify(PRECACHE)};
const IMAGES_CACHE = ${JSON.stringify(IMAGES_CACHE)};
const IMAGE_CACHE_LIMIT = ${IMAGE_CACHE_LIMIT};
const NAV_FALLBACK = ${JSON.stringify(NAV_FALLBACK)};
const PRECACHE_URLS = ${JSON.stringify(precacheUrls, null, 2)};
const BUILD_ID = ${JSON.stringify(buildId)};
// sha256 prefix per precached file, minus pages and payloads. Install copies a byte-identical
// entry from an older trip-precache-* instead of downloading it again (#979).
const PRECACHE_REVISIONS = ${JSON.stringify(precacheRevisions)};
const PARTIAL_CACHE = 'trip-install-partial';
// Same-origin files this build ships but does not precache (lazy chunks, the map engine, its
// worker, the glyphs). They are runtime-cached here instead of in PRECACHE so an update does
// not wipe them. The name hashes the unhashed ones (maplibre worker, glyphs), so a maplibre
// bump drops the cache whole; activate prunes it to this list, so it never outgrows one build.
const RUNTIME_CACHE = ${JSON.stringify(RUNTIME_CACHE_NAME)};
const RUNTIME_URLS = new Set(${JSON.stringify(runtimeUrls)});
// Written last by install: lib/preflight.ts compares the cache against it to tell a complete
// shell from a partial one.
const PRECACHE_LIST = ${JSON.stringify(withBase('/__precache-urls.json'))};

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
      // ATOMIC install: every precache URL is same-origin, so a
      // healthy build MUST fetch each one OK. If ANY entry fails to fetch OK,
      // THROW so this waitUntil rejects -- the worker then never reaches the
      // activate handler, so the previous good precache (deleted ONLY in
      // activate, below) stays fully intact and the last good build keeps
      // serving. This is the torn-state guard: GitHub Pages deploys are not
      // atomic, so a client can fetch a manifest from build N and an asset still
      // on build N+1; we refuse to commit a half-populated shell rather than
      // silently cache a miss (the classic SW bug that permanently serves the
      // wrong shell). No opaque special-case: precache URLs are never opaque.
      //
      // res.ok is NOT enough (#136): a captive portal answers every request with
      // its login page and a 200, which passes the atomicity guard above and gets
      // committed to a DURABLE cache -- worse than the runtime case, since the
      // poison then survives restarts and the image fallback below would hand
      // that HTML back as the "cached image". isExpectedPrecacheBody rejects it.
      //
      // Pages and RSC payloads must also carry this build's id (#944): an edge still serving
      // the previous build's HTML next to the new sw.js would otherwise pin route HTML whose
      // chunk hashes no longer exist. Throwing keeps the old build serving; the next update
      // check retries.
      //
      // A failed install deletes the cache it was filling (#945), or the preflight check
      // and caches.match() would read the partial cache. Only one this install created: a
      // byte-identical rebuild reuses the active worker's cache name. Its reusable entries
      // move to PARTIAL_CACHE first, so a retry on a flaky link resumes instead of
      // starting over (#979); activate sweeps that cache like any other stale trip-* one.
      const names = await caches.keys();
      const fresh = !names.includes(PRECACHE);
      const previous = names.filter(
        (k) => (k.startsWith('trip-precache-') && k !== PRECACHE) || k === PARTIAL_CACHE
      );
      const cache = await caches.open(PRECACHE);
      const results = await Promise.allSettled(
        PRECACHE_URLS.map(async (url) => {
          const kept = await reusablePrecacheEntry(url, previous);
          if (kept) {
            try {
              return await cache.put(url, kept);
            } catch (err) {}
          }
          const res = await fetch(url, { cache: 'no-cache' });
          if (!res || !res.ok) {
            throw new Error(
              'precache fetch failed: ' + url + ' -> ' + (res ? res.status : 'no response')
            );
          }
          if (!isExpectedPrecacheBody(url, res)) {
            throw new Error(
              'precache body rejected: ' + url + ' -> ' + (contentTypeOf(res) || 'no content type')
            );
          }
          if (carriesBuildId(url) && !(await res.clone().text()).includes(BUILD_ID)) {
            throw new Error('precache body from another build: ' + url);
          }
          await cache.put(url, res.clone());
        })
      );
      const failed = results.find((r) => r.status === 'rejected');
      if (failed) {
        if (fresh) {
          await keepPartial(cache).catch(() => {});
          await caches.delete(PRECACHE).catch(() => {});
        }
        throw failed.reason;
      }
      await cache.put(PRECACHE_LIST, precacheListResponse());
      await caches.delete(PARTIAL_CACHE).catch(() => {});
    })()
  );
});

// --- activate: drop every non-allowlisted cache, take control ------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // ALLOWLIST cleanup, scoped to OUR caches: delete any cache key of ours
      // that is not in the current set — the active precache PLUS the two runtime
      // caches. This drops the previous build's trip-precache-* (atomic activation)
      // AND garbage-collects renamed runtime caches (e.g. a bumped trip-images-v1 ->
      // v2, or the retired trip-frankfurter-v1) that a prefix-only filter would have
      // leaked forever.
      //
      // The OWNERSHIP predicate is load-bearing and is not a duplicate of the
      // allowlist: caches.keys() is scoped to the ORIGIN, not to this worker's
      // scope, and the live app is a GitHub Pages PROJECT page — powan55.github.io
      // is shared with every other Pages project on the account. Without the
      // prefix, accepting an update here wipes a sibling app's Cache Storage, and
      // that sibling only repopulates on ITS own next version bump.
      const allowlist = new Set([PRECACHE, RUNTIME_CACHE, IMAGES_CACHE]);
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('trip-') && !allowlist.has(k))
          .map((k) => caches.delete(k))
      );
      try {
        const runtime = await caches.open(RUNTIME_CACHE);
        for (const req of await runtime.keys()) {
          if (!RUNTIME_URLS.has(new URL(req.url).pathname)) await runtime.delete(req);
        }
      } catch (err) {}
      await self.clients.claim();
    })()
  );
});

// --- skip-waiting handshake (registrar posts this on "Refresh") ----------
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (event.data && event.data.type === 'REPAIR') {
    const done = repairPrecache();
    if (event.waitUntil) event.waitUntil(done);
  }
});

// --- repair: refill a precache emptied under a live registration (D-672) --
// install is the only thing that fills PRECACHE, so a cleared Cache Storage with the
// registration intact stayed empty until the next deploy. The registrar posts REPAIR
// once per online page load. Unlike install this is NOT atomic and never throws: each
// missing entry is fetched on its own, a failure just leaves that entry missing, and
// nothing is ever deleted. Only the current PRECACHE is touched (the origin is shared).
async function repairPrecache() {
  try {
    const reg = self.registration;
    // A newer worker means the server may already be on the next build, and its bytes
    // must not land in this build's cache. That worker's own install fills its cache.
    await reg.update().catch(() => {});
    if (reg.installing || reg.waiting) return;
    const cache = await caches.open(PRECACHE);
    const have = new Set((await cache.keys()).map((req) => new URL(req.url).pathname));
    if (!have.has(PRECACHE_LIST)) await cache.put(PRECACHE_LIST, precacheListResponse());
    const missing = PRECACHE_URLS.filter((url) => !have.has(url));
    if (missing.length === 0) return;
    await Promise.all(
      missing.map(async (url) => {
        try {
          const res = await fetch(url, { cache: 'no-cache' });
          if (!res || !res.ok || !isExpectedPrecacheBody(url, res)) return;
          // Pages and RSC payloads carry the build id. A portal page has none, and one
          // from a newer deploy carries that deploy's (hashed chunks can be shared, ids not).
          if (carriesBuildId(url) && !(await res.clone().text()).includes(BUILD_ID)) return;
          await cache.put(url, res);
        } catch (err) {}
      })
    );
  } catch (err) {}
}

// --- helpers -------------------------------------------------------------
// Normalize a same-origin URL to its trailingSlash form so /plan and /plan/
// both hit the cached /plan/ entry.
function normalizePath(url) {
  let pathname = url.pathname;
  // Strip the RSC payload suffix FIRST. Next fetches a route's payload from
  // <route>/index.txt (trailingSlash:true; <route>.txt otherwise) and, when that
  // fetch fails — i.e. offline — falls back to a BROWSER NAVIGATION to the .txt URL
  // itself. Nothing precached matches it, so the nav handler used to answer with the
  // app-root shell: tap "Plan" offline and Home renders at /plan/index.txt, from
  // which every further tap repeats it. Only navigations reach here; the RSC fetch
  // itself is not mode:'navigate' and takes the static branch.
  if (pathname.endsWith('/index.txt')) pathname = pathname.slice(0, -'index.txt'.length);
  else if (pathname.endsWith('.txt')) pathname = pathname.slice(0, -'.txt'.length);
  if (!pathname.endsWith('/') && !pathname.includes('.')) {
    pathname = pathname + '/';
  }
  return pathname;
}

function isImageRequest(request, url) {
  if (request.destination === 'image') return true;
  return /\\.(?:png|jpe?g|gif|webp|avif|svg|ico)$/i.test(url.pathname);
}

// Degrades to '' instead of throwing on a response with no usable \`headers\`: this is read
// inside the ATOMIC install, where any exception rejects the install and drops offline.
function contentTypeOf(res) {
  return (res.headers?.get?.('Content-Type') || '').toLowerCase();
}

// A 200 is not proof the body is the image: a captive portal answers every request with
// its login page (#136). An ABSENT content type is trusted rather than rejected — some
// hosts omit it, and an opaque response exposes no headers at all.
function isImageResponse(res) {
  const type = contentTypeOf(res);
  return type === '' || type.startsWith('image/');
}

// Does an INSTALL-time precache response plausibly carry the asset we asked for?
// Only two shapes of precache entry exist (buildPrecacheList): route URLs -- a
// directory url or /404.html -- which ARE html, and files (js, css, icons, the
// webmanifest, the hero rasters). For a file, an html body is the portal, not our
// asset; an html login page cached as a JS chunk breaks the shell exactly as one
// cached as an image does. Images are held to that SAME html-only rule, NOT the
// runtime's stricter image/* one: a runtime miss degrades to a cache lookup, but an
// install rejection is atomic and kills offline outright, so this path buys safety by
// being LESS strict -- a host that labels a hero application/octet-stream must not brick
// the shell. Route entries stay unverifiable from headers alone (the portal's html and
// ours are both text/html) -- res.redirected catches the redirecting portals, which is
// the common flavour, and a same-origin build URL should never redirect anyway.
function isExpectedPrecacheBody(url, res) {
  if (res.redirected) return false;
  if (url.endsWith('/') || url.endsWith('.html')) return true;
  return !contentTypeOf(res).startsWith('text/html');
}

// Route pages and RSC payloads embed the build id; gen-sw checks every precached one does.
function carriesBuildId(url) {
  return url.endsWith('/') || url.endsWith('.html') || url.endsWith('.txt');
}

// The stored bytes are hashed rather than the path trusted: icons, heroes and the manifest
// keep their URL when their bytes change. Any miss or error just means a normal fetch.
async function reusablePrecacheEntry(url, cacheNames) {
  const revision = PRECACHE_REVISIONS[url];
  if (!revision || carriesBuildId(url)) return undefined;
  for (const cacheName of cacheNames) {
    try {
      const hit = await caches.match(url, { cacheName });
      if (!hit || !hit.ok || hit.redirected || !isExpectedPrecacheBody(url, hit)) continue;
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await hit.clone().arrayBuffer()));
      const hex = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
      if (hex.startsWith(revision)) return hit;
    } catch (err) {}
  }
  return undefined;
}

// Only entries reusablePrecacheEntry would accept, and it re-hashes them on the way back.
async function keepPartial(cache) {
  await caches.delete(PARTIAL_CACHE);
  const partial = await caches.open(PARTIAL_CACHE);
  for (const req of await cache.keys()) {
    const path = new URL(req.url).pathname;
    if (!PRECACHE_REVISIONS[path] || carriesBuildId(path)) continue;
    const res = await cache.match(req);
    if (res) await partial.put(req, res);
  }
}

function precacheListResponse() {
  return new Response(JSON.stringify(PRECACHE_URLS), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// LRU-ish cap on the runtime image cache: evict oldest (insertion order) on
// overflow. Cache API keys() returns entries in insertion order. Runs one at a time:
// overlapping trims each read their own key snapshot and evicted more than the overflow.
let imageTrim = Promise.resolve();
function trimImageCache() {
  imageTrim = imageTrim
    .then(async () => {
      const cache = await caches.open(IMAGES_CACHE);
      const keys = await cache.keys();
      const overflow = keys.length - IMAGE_CACHE_LIMIT;
      for (let i = 0; i < overflow; i++) {
        await cache.delete(keys[i]);
      }
    })
    .catch(() => {});
  return imageTrim;
}

// Runtime-cached images are served as-is until this old, then refreshed in the background.
const IMAGE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
function isStaleImage(res) {
  const stored = Date.parse(res.headers?.get?.('Date'));
  return !(Date.now() - stored < IMAGE_MAX_AGE_MS);
}

async function refreshImage(request) {
  try {
    const res = await fetch(request, { cache: 'no-cache' });
    if (res && res.ok && res.type === 'basic' && isImageResponse(res)) {
      const cache = await caches.open(IMAGES_CACHE);
      await cache.put(request, res.clone());
      await trimImageCache();
    }
  } catch (err) {
    // Offline: keep the cached copy.
  }
}

// caches.match() can REJECT — a corrupted store, an eviction racing the read, iOS
// storage reclamation. Every lookup in this file wants "nothing cached" out of that,
// never a throw: an exception inside respondWith rejects the response and the browser
// paints its network-error page for a route the precache is holding. Guarding the one
// shared helper is what keeps every branch degrading instead of failing.
async function cacheMatch(request, options) {
  try {
    return await caches.match(request, options);
  } catch (err) {
    return undefined;
  }
}

// Next appends a cache-busting _rsc=<digest> to every RSC request, and the digest is
// computed from the CURRENT router state tree — so one target route yields a different
// URL per source route and again for prefetch vs navigation. Keyed literally, each of
// those becomes its own permanent entry in a precache that has no size cap and no
// eviction. Collapse them to one entry per route.
//
// For a .txt payload the WHOLE search string goes, not just _rsc. Next mutates only
// the PATHNAME when it derives the payload URL, so command-palette.tsx's
// router.push('/plan/?focus=<id>') is fetched as /plan/index.txt?focus=<id>&_rsc=<digest>
// — deleting _rsc alone leaves ?focus=<id> in the key and misses the precached
// /plan/index.txt, which is the only entry that exists. travel-date-picker already had
// to route AROUND this: TM-11 replaced its router.replace with history.replaceState
// precisely because the ?date= payload fetch died offline.
//
// Scoped to .txt DELIBERATELY: this is only sound because a static export's payload
// is prerendered per ROUTE and cannot vary by query. For any other asset a param can
// select the bytes, so dropping the search globally would be wrong.
//
// A route's __next._index.txt is the ROOT-LAYOUT segment, and there is one root layout, so
// all 20 the export emits are the same bytes. Only the root copy is precached; every other
// route's URL is rewritten onto it here rather than storing 19 more copies of it. Issue #417.
const ROOT_INDEX_PAYLOAD_PATH = ${JSON.stringify(withBase('/__next._index.txt'))};
function cacheKey(request) {
  const url = new URL(request.url);
  if (url.pathname.endsWith('.txt')) {
    if (url.pathname.endsWith('/__next._index.txt')) {
      url.pathname = ROOT_INDEX_PAYLOAD_PATH;
      url.search = '';
      return url.href;
    }
    if (!url.search) return request;
    url.search = '';
    return url.href;
  }
  if (!url.searchParams.has('_rsc')) return request;
  url.searchParams.delete('_rsc');
  return url.href;
}

async function cacheFirst(request, cacheName) {
  const key = cacheKey(request);
  const cached = await cacheMatch(key);
  if (cached) return cached;
  const res = await fetch(request);
  if (res && res.ok && res.type === 'basic' && isExpectedPrecacheBody(request.url, res)) {
    const cache = await caches.open(cacheName);
    cache.put(key, res.clone());
  }
  return res;
}

// --- fetch routing -------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

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
        // PRECACHE FIRST, runtime cache second. The precache name is content-hashed
        // and rolls with every deploy; IMAGES_CACHE is 'trip-images-v1' forever and is
        // allowlisted through every activate, while /images/** filenames are NOT
        // content-hashed. Consulting the durable runtime copy first meant a re-encoded
        // image stayed stale on a returning client for good — with the fresh bytes
        // sitting unread in the new precache — and meant the precached hero rasters
        // (D-335, 30% of the gzipped install) were never served from cache on a first
        // online paint, because anything not already in IMAGES_CACHE went to the
        // network. Checking the precache first fixes both, and keeps the precached
        // heroes from also burning one of the 80 FIFO slots.
        const fresh = await cacheMatch(request, { cacheName: PRECACHE });
        if (fresh) return fresh;
        const cached = await cacheMatch(request, { cacheName: IMAGES_CACHE });
        if (cached) {
          if (isStaleImage(cached)) event.waitUntil(refreshImage(request));
          return cached;
        }
        let res;
        try {
          res = await fetch(request);
          if (res && res.ok && res.type === 'basic' && isImageResponse(res)) {
            const cache = await caches.open(IMAGES_CACHE);
            await cache.put(request, res.clone());
            trimImageCache();
          }
        } catch (err) {
          // Hard offline: the fetch REJECTED. Falls through to the cache lookup below.
        }
        if (res && res.ok && isImageResponse(res)) return res;
        // A REJECTED fetch is not the only offline (issue #109). A captive portal
        // answers with a RESPONSE: a 511, a redirect to a portal, or an opaque
        // result whose status is 0. Those three RESOLVE, so
        // the catch above never runs, and the hero used to break with the correct
        // bytes sitting in the precache. Non-ok is therefore treated exactly like
        // offline: consult the cache first, and only hand back the real error
        // response when nothing is cached, so a genuine 404 still reads as a 404.
        // A 200 carrying the portal's login page instead of the image takes that same
        // path (#136): res.ok is true for it, so the content type is the only thing that
        // separates a photo from an HTML sign-in form.
        //
        // Fall back to ANY cache, not IMAGES_CACHE — the hero rasters' offline
        // guarantee lives in the PRECACHE (D-335), which the two cacheName-scoped
        // lookups at the top of this handler now cover directly; this stays as the
        // unscoped backstop for a cache populated after they ran.
        //
        // The \`await\` is load-bearing and was once missing: \`caches.match()\` returns
        // a Promise, which is always truthy, so \`||\` could never reach the fallback
        // and a genuine miss resolved to \`undefined\` instead of a network error.
        return (await cacheMatch(request)) || res || Response.error();
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
        const cached = await cacheMatch(normalized);
        if (cached) return cached;
        try {
          const res = await fetch(request);
          // Nav backfill: a route missed at install (or added between
          // builds) is cached under its normalized path on first successful
          // online visit, so it resolves offline next time instead of falling
          // back to the app-root shell. Only OK, same-origin ('basic')
          // responses — never backfill an error/opaque/redirect response into
          // the precache. Fire-and-forget (mirrors cacheFirst) so it never
          // delays the navigation response.
          // Same body check repairPrecache applies: a rewriting network's 200 page
          // (no build id) or a redirected one must not become the route shell.
          if (res && res.ok && res.type === 'basic' && !res.redirected) {
            const copy = res.clone(); // clone NOW, before the browser locks the body
            copy
              .clone()
              .text()
              .then((text) => (text.includes(BUILD_ID) ? caches.open(PRECACHE).then((cache) => cache.put(normalized, copy)) : undefined))
              .catch(() => {});
          }
          return res;
        } catch (err) {
          // A route this build ships but whose entry was evicted still gets the Home
          // shell (a plain 404 would be wrong for it). A path the build never shipped
          // gets the 404 page instead of Home (#807).
          if (PRECACHE_URLS.includes(normalized)) {
            const shell = await cacheMatch(NAV_FALLBACK);
            if (shell) return shell;
          }
          const fallback = await cacheMatch(${JSON.stringify(withBase('/404.html'))});
          return fallback || Response.error();
        }
      })()
    );
    return;
  }

  // Same-origin static assets: cache-first. The lookup lives inside cacheFirst —
  // an identical caches.match(request) sat here too, outside the try, so a rejecting
  // Cache Storage took down an asset the precache was holding, and the unnormalized
  // key missed every _rsc request that cacheFirst then had to look up again.
  // Anything not on RUNTIME_URLS (RSC payloads, unknown paths) is build-specific and
  // stays in PRECACHE, which the next activate drops.
  const target = RUNTIME_URLS.has(url.pathname) ? RUNTIME_CACHE : PRECACHE;
  event.respondWith(
    (async () => {
      try {
        return await cacheFirst(request, target);
      } catch (err) {
        return Response.error();
      }
    })()
  );
});
`;
}

// -------------------------------------------------------------------------
// Delete the nomodule polyfill chunk and strip its <script>
// tag from every HTML file under out/. Runs BEFORE the precache walk so the
// deleted chunk falls out of the precache list automatically (the route walk).
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
      'gen-sw: WARN: matched NO polyfills-*.js chunk. Next may have renamed the polyfill pattern; verify the glob so the strip does not silently no-op.'
    );
  }
  console.log(
    `gen-sw: dropped nomodule polyfill, deleted ${deleted} chunk(s), stripped tag from ${stripped} HTML file(s)`
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

  // 0) strip the nomodule polyfill (chunk + HTML tags) BEFORE the walk
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
  const precacheRevisions = {};
  for (const rel of precacheFiles) {
    const bytes = await readFile(join(OUT_DIR, rel));
    h.update(rel).update('\0').update(bytes);
    const revision = precacheRevision(rel, bytes);
    if (revision) precacheRevisions[toPrecacheUrl(rel)] = revision;
  }
  const precacheHash = h.digest('hex').slice(0, 12);

  // 4) Emit the SW.
  const buildId = (
    await readFile(join(ROOT, '.next', 'BUILD_ID'), 'utf8').catch(() => {
      throw new Error('gen-sw: .next/BUILD_ID is missing; the precache repair needs it.');
    })
  ).trim();
  if (!buildId) throw new Error('gen-sw: .next/BUILD_ID is empty.');
  // Install refuses any page or payload without the build id, so one that lacks it here
  // would fail every install on every device.
  for (const rel of precacheFiles) {
    if (/\.(html|txt)$/.test(rel) && !(await readFile(join(OUT_DIR, rel), 'utf8')).includes(buildId)) {
      throw new Error(`gen-sw: ${rel} does not contain BUILD_ID ${buildId}.`);
    }
  }

  const precacheSet = new Set(precacheFiles);
  const runtimeFiles = allFiles
    .filter((rel) => /^(_next\/static|maplibre|font)\//.test(rel) && !precacheSet.has(rel))
    .sort();
  const runtimeUrls = runtimeFiles.map((rel) => encodeURI(withBase('/' + rel)));
  const r = createHash('sha256');
  for (const rel of runtimeFiles) {
    if (!rel.startsWith('_next/')) r.update(rel).update('\0').update(await readFile(join(OUT_DIR, rel)));
  }
  const runtimeHash = r.digest('hex').slice(0, 12);
  const sw = buildServiceWorker({ precacheUrls, precacheHash, precacheRevisions, buildId, runtimeUrls, runtimeHash });
  await writeFile(join(OUT_DIR, 'sw.js'), sw, 'utf8');
  console.log(
    `gen-sw: wrote out/sw.js (cache trip-precache-${precacheHash}, ${precacheUrls.length} precache entries, ` +
      `${Object.keys(precacheRevisions).length} reusable across builds; ` +
      `trip-runtime-${runtimeHash}, ${runtimeUrls.length} runtime URLs)`
  );

  // 5) Log a few sample URLs for the single-prefix proof.
  console.log('gen-sw: manifest start_url/scope =', withBase('/'));
  console.log('gen-sw: sample precache URLs:');
  for (const u of precacheUrls.slice(0, 4)) console.log('   ', u);
}

// argv[1] is cwd-relative under npm; compare as resolved file URLs.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error('gen-sw FAILED:', err);
    process.exit(1);
  });
}

export { eagerStaticAssets, isDedupedSegmentPayload, precacheRevision };
