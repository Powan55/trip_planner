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
// Behaviour change: this script also deletes Next's nomodule
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

// The page field the app's <body> actually paints (the --navy-900 channel /
// --background token, app/globals.css). Same hex as gen-icons.mjs and as
// `themeColor` in app/layout.tsx, so installed app + splash + address bar all agree
// — three hand-synced copies with no compiler tie, so they move together or the
// installed app is framed in a palette the app no longer uses. Re-valued to the
// D-334 page field.
const THEME_COLOR = '#0E0920';

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

// the _next/static assets that the PRECACHED ROUTES actually reference —
// i.e. every `_next/static/...` mentioned by any route HTML, plus everything the
// CSS among them url()-references (the woff2 fonts). Returned as out/-relative
// paths WITHOUT a leading slash, so the match is basePath-agnostic (: the
// HTML carries the prefix, disk paths do not, and the pattern starts at `_next/`).
//
// This DROPS the per-route lazy chunks (maplibre's ~1 MB bundle, the heaviest
// single win) while KEEPING every route's own eager `app/<route>/page-*.js`.
//
// It must be EVERY route HTML, not just index.html. Scraping only index.html
// costs ~17 more entries but silently breaks the precache invariant:
// a route's HTML would still be precached and would still serve offline with the
// correct <title>, but without its own page chunk React cannot render it, so the
// route paints the error boundary ("The app hit a problem") instead of the page.
// Measured, not theorised: index.html-only scraping failed
// `e2e/pwa-torn-update.spec.ts` Part A 6 runs out of 8 — it passed at all only
// when Next's <Link> prefetch happened to warm the chunk before the test cut the
// network, i.e. it turned a hard guarantee into a race. See e2e/sw-shell-scope.spec.ts.
//
// What legitimately falls out (per-route LAZY chunks) is backfilled by the
// static-asset cacheFirst handler on its first successful ONLINE fetch — that
// handler plus the nav backfill is the safety argument for the rest.
//
// 🔴: this scrape is NOT the whole shell, and must never again be treated as
// if it were. It cannot see a `dynamic(..., {ssr:false})` island — that island is
// absent from the HTML BY CONSTRUCTION — and the ROOT LAYOUT's entire chrome is
// declared that way. `islandAssets()` below covers it; the two are unioned
// in buildPrecacheList. The backfill argument above does NOT rescue the root
// layout: a cold install that goes offline before browsing has backfilled nothing,
// and a missing root-layout chunk is a crash, not a degraded route.
async function eagerStaticAssets(htmlFiles) {
  const REF = /_next\/static\/[A-Za-z0-9._\/-]+/g;
  const set = new Set();
  for (const rel of htmlFiles) {
    const html = await readFile(join(OUT_DIR, rel), 'utf8');
    for (const ref of html.match(REF) ?? []) set.add(ref);
  }
  for (const rel of [...set]) {
    if (!rel.endsWith('.css')) continue;
    const css = await readFile(join(OUT_DIR, rel), 'utf8');
    for (const ref of css.match(REF) ?? []) set.add(ref);
  }
  // Fail-LOUD floor (mirrors stripPolyfills' WARN): if a future Next output
  // shape stops matching REF, this silently drops the whole shell from the
  // precache and offline rendering degrades with a still-green build.
  if (set.size < 5) {
    console.warn(
      `gen-sw: WARNING — only ${set.size} eager asset(s) scraped from route HTML; ` +
        'the _next/static reference shape may have changed.'
    );
  }
  return set;
}

// +: the chunks the app's `dynamic(..., { ssr:false })` islands need —
// the ROOT LAYOUT's chrome AND every ROUTE's own sections.
//
// 🔴 THE REGRESSION THIS REPAIRS. `eagerStaticAssets` above scrapes route HTML.
// `app/layout.tsx` renders its chrome — Navbar, Footer, BottomTabBar, QuickAddFab,
// QuickAddHost, ExpenseLogHost, TripJoinHandshake via `app/chrome-islands.tsx`, plus
// TravelModeMounts via `components/itinerary-provider.tsx` — and declares EVERY one
// of them `ssr:false`. An ssr:false island is BY
// CONSTRUCTION absent from server-rendered HTML, so an HTML scrape can never see
// its chunks. therefore dropped the entire app chrome from the precache, and
// a COLD-OFFLINE install (install → offline without browsing first, so the worker
// never saw a single chunk fetch and never backfilled one) crashed on EVERY route:
// the root layout threw ChunkLoadError, which is the ONE crash `app/error.tsx`
// cannot catch, so `app/global-error.tsx` painted instead of the app.
//
// SOURCE OF TRUTH: `.next/react-loadable-manifest.json`, emitted by `next build`,
// which maps every `next/dynamic` CALL SITE — keyed "<source file> -> <specifier>"
// — to the exact chunk files that import needs. READ, never hand-maintained: a
// hand-kept list is the failure mode this file already fixed once for
// route HTML, and it is how a new island would silently fall out again.
//
// 🔴 SCOPE — and this is the part that must NOT be hand-picked. The obvious seed
// is `app/chrome-islands.tsx`, and it is WRONG BY MEASUREMENT: seeding only that
// module still left the app crashing cold-offline, because `<TravelModeMounts />`
// is an EIGHTH root-layout ssr:false island, declared in
// `components/itinerary-provider.tsx` (which `app/layout.tsx` mounts) and rendered
// unconditionally there. Any list a human writes has that shape of hole — which is
// the failure mode this file already fixed once for route HTML. So the
// seed is DERIVED:
//
// 1. walk the STATIC import graph, over local modules, of `app/layout.tsx` PLUS
// every `app/**/page.tsx` ( — seeded the layout ALONE, which precached
// the chrome but left every route BODY crashing cold-offline on app/error.tsx).
// That graph IS "what the app mounts", read off the source. Route entries are
// themselves DISCOVERED by walking app/ (routeEntryFiles) — never hand-listed;
// 2. intersect it with the manifest's call-site sources — those are the dynamic
// islands the app can render;
// 3. follow only specifiers resolving under `components/`, transitively.
//
// Step 3 is the render-path/promise-path distinction and it is what keeps the
// shell small: a `dynamic()` COMPONENT throws during render if its chunk is missing
// (→ global-error from the layout, app/error.tsx from a route), whereas
// `import('@/lib/presence')` or `import('firebase/app')` is loaded inside an
// effect and merely rejects a promise the caller already handles. `lib/presence.ts`
// IS in the layout's static graph, so without step 3 this would sweep ~600 KB of
// Firebase into the offline shell. DO NOT LOOSEN IT.
//
// 🔴 maplibre — WITHHELD. This flipped twice; read it, do not trust an older comment.
// ① kept the engine out, ② unioned it in ("prefetch it, it is under 2 MB"), and
// V6-14 takes it back out on a MEASUREMENT ② did not have: the engine plus the glyph
// PBFs are ~363 KB GZIPPED — 21% of the gzipped install — spent on `/map`, the one
// route the app already declines to promise offline (D-274). Two mechanisms keep it
// out, and both are load-bearing because they cover different files:
// (a) `isMaplibreChunk()` — the content-based exclusion in the walk below, which
// withholds the small ~23 KB maplibre chunk that appears in three call sites' own
// chunk lists;
// (b) the BARE-SPECIFIER STOP in step 3 — the ~1008 KiB ENGINE is reached only via
// `components/trip-map.tsx -> maplibre-gl`, and `resolveLocal('maplibre-gl')`
// returns null, so that call site is skipped before its chunk list is even read.
// The engine is therefore not a candidate at all; the explicit content scan below
// still runs, but only to MEASURE what is withheld and to keep the anti-vacuity
// floor honest. Measured under ②: 1,032,412 + 23,621 = 1,056,033 B = 1.01 MiB raw.
//
// THE REGRESSION, NAMED: a cold-offline `/map` degrades to the island boundary, and
// map labels are blank on a cold-offline first open. The ENGINE comes back on the first
// online /map visit — it is a same-origin, non-image, non-navigate GET, so it lands on
// the last branch of the fetch listener and cacheFirst() writes it into PRECACHE.
// The GLYPHS take the same branch IF the worker sees them: maplibre requests them from
// a BLOB-URL web worker, and a blob worker inherits its creator's controller, so the SW
// should intercept — spec-and-implementation reasoning, NOT measured on this tree. If it
// does not hold, the glyphs are never cached and offline map LABELS stay blank
// permanently. Blank labels on a route D-274 already refuses to promise offline is a
// degradation, not a crash; measure it before promising otherwise.
//
// 🔴 THE BOUNDARY IS REQUIRED, MORE THAN UNDER ②. A missing dynamic() chunk THROWS
// out to app/error.tsx and takes the whole route down, and the chunk is now missing
// on EVERY cold-offline render, not just after an eviction. The maplibre call sites
// are still collected and still ENFORCED by assertMapIslandsWrapped(). Emptying that
// list would turn a fail-closed gate into one that passes because it inspects
// nothing — see the floor below.
//
// Entries this returns that are NOT on disk are ignored for free: `buildPrecacheList`
// iterates the real out/ walk and only membership-tests this set, so a stale manifest
// row can never inject a URL that 404s and break the atomic install.
const NEXT_DIR = join(ROOT, '.next'); // next.config.js: distDir = '.next'
const APP_DIR = 'app';
const ROOT_LAYOUT = 'app/layout.tsx';
const SOURCE_EXTS = ['.tsx', '.ts', '.jsx', '.js'];

// every ROUTE ENTRY POINT under app/ — `app/**​/page.tsx` — DISCOVERED by
// walking the directory, never hand-listed. Same rule the route-HTML walk
// already follows, and for the same measured reason: proved a hand-picked
// seed grows a hole (it missed TravelModeMounts, and that build LOOKED fixed).
// A route's `page.tsx` statically imports its `./sections` client module, so
// seeding page.tsx reaches every route's ssr:false island declarations through
// the existing static-graph walk in step 1 — no second mechanism needed.
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

// Does this built chunk carry the maplibre ENGINE?
//
// ① used this to KEEP maplibre out of the precache. reversed that ruling
// (the owner: prefetch it, it is under 2 MB) so the same predicate now decides what to
// PULL IN — both for the union below and for "which call sites render a map island and
// therefore still need the error boundary". One predicate, two readers; do not grow a
// second scanner beside it.
//
// Matched by CONTENT, never by filename: next.config.js sets
// `output.chunkFilename = 'static/chunks/[contenthash:16].js'`, so async chunk
// filenames carry no name at all and any filename-pattern approach is a non-starter.
//
// Scoped to `.js` DELIBERATELY: 2 built CSS files also contain `maplibregl`
// (maplibre's stylesheet is bundled into the app's CSS). Under that scoping
// stopped an all-file-types grep from withholding the app's OWN stylesheet and
// shipping a completely unstyled offline app; it stays because this predicate is
// about the ENGINE, which is JS. (Those two CSS files are already precached by the
// route-HTML scrape — no CSS work is needed here.)
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

  // 1) The static import graph of the root layout AND every route entry = the
  // modules the app can mount. widened the seed here ( seeded only
  // ROOT_LAYOUT, which precached the chrome but left every route BODY crashing
  // cold-offline on app/error.tsx). The WALK is unchanged — only the seed grew.
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
  // the call sites whose chunk set the maplibre exclusion REDUCED.
  // This list is the load-bearing output of this function besides the file set:
  // it is EXACTLY the set of call sites that can still throw a ChunkLoadError at
  // render time, so it is exactly the set that needs an island error boundary
  // (components/map-island-boundary.tsx). Derived, so it self-maintains — add a
  // new map island next month and the build names it for the next person.
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
        // WITHHELD again (V6-14 / C-5) — see the maplibre note in this function's
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

  // — the maplibre ENGINE. NOT unioned in (V6-14 / C-5): it is scanned for, MEASURED
  // and REPORTED, and then deliberately left out of `files`. The walk above cannot
  // reach it anyway — it hangs off `components/trip-map.tsx -> maplibre-gl`, a BARE
  // specifier, so `resolveLocal` returns null and the render-path `continue` fires
  // before the chunk list is even read — so this scan exists ONLY to keep the numbers
  // honest and to feed the anti-vacuity floor below. Scanning by CONTENT is still the
  // only option: the filenames are bare contenthashes (next.config.js sets
  // `output.chunkFilename = 'static/chunks/[contenthash:16].js'`) so nothing can be
  // matched by name. Bounded and cheap: ~110 unique chunk files, deduped, read once.
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

  // Fail-LOUD floor. turned this from console.warn into a THROW: a warning
  // nobody reads is a weak floor, and the symptom of a silent zero here is a GREEN
  // build that crashes on every route cold-offline — the exact ship-blocker
  // had to fix. The e2e guard in e2e/pwa.spec.ts does have teeth now, but it runs
  // at gate time on one machine; this throw runs on EVERY build, including CI and
  // the deploy workflow. Zero call sites means the derivation lost its grip (the
  // root layout moved out of app/layout.tsx, app/ was restructured, islands were
  // re-declared outside components/, or Next changed the manifest shape).
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

  // 🔴 ANTI-VACUITY FLOOR. Everything below — the prefetch AND the boundary gate —
  // hangs off isMaplibreChunk() finding something. If maplibre ever renames its global
  // (MAPLIBRE_MARKER stops matching) or the chunk stops reaching the manifest, the
  // failure is DOUBLY SILENT under a green build: the engine quietly falls back out of
  // the precache, AND assertMapIslandsWrapped iterates an empty list, inspects nothing,
  // and "passes". A gate that passes because it looked at nothing is the defect class
  // this project spent a session removing. Refuse to build instead.
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

  // …and these call sites render a map island, so each needs the island error
  // boundary — now MORE than before. The chunk is no longer precached at all, so any
  // cold-offline (or captive-portal) render of /map finds it missing, and React.lazy
  // THROWS there — escaping to app/error.tsx and taking the whole route down.
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

// — PROVE each maplibre island call site is actually wrapped, and fail the
// build if it is not.
//
// 🔴: the input list is "call sites that render a maplibre island", NOT "call sites
// we withheld a chunk from" — and it stays that way even though V6-14 made the two
// coincide again. They came apart once already (② precached the engine and the withheld
// list went empty); keying the gate on the withheld list would have quietly emptied it
// too and left a gate that passes by inspecting nothing. The floor in islandAssets()
// refuses that outcome outright.
//
// 🔴 WHY THIS REPLACED A PRINTED LINE. printed the map-reduced list with a
// "MUST be wrapped" instruction and stopped there. That is the same object as the
// `console.warn` floors itself converted to `throw`s on the grounds that "a
// warning nobody reads is a weak floor": add a map island next month without
// wrapping it and the build prints the instruction, stays GREEN, and the route
// crashes cold-offline for anyone who installed the PWA.
//
// 🔴 IT MUST FAIL CLOSED, AND THAT IS THE WHOLE DESIGN. The obvious check —
// "does the declaring file contain the string MapIslandBoundary?" — is what
// used as a manual probe, and it is NOT good enough to ship as a gate: it
// passes when the file imports the boundary but wraps a DIFFERENT island, when the
// name only appears in a comment, or when the wrap was deleted but the import left
// behind. A gate that can be fooled by ordinary refactoring is worse than the
// printed line, because it LOOKS enforced. So this resolves the island's actual
// local identifier and requires every JSX use of it to sit inside a boundary region.
//
// Every way it can be wrong points the SAME way — at a failed build, never at a
// silent pass:
// - boundary not imported -> throw
// - island declaration not found -> throw (cannot verify => refuse)
// - ZERO JSX uses of the island -> throw (rendered via createElement or
// re-exported for someone else to render;
// either way this file cannot prove the wrap)
// - any JSX use outside a boundary -> throw
// - boundaries nested (naive pairing yields a SHORTER region) -> throw
// The false-negative cost is a loud build failure a human resolves in a minute.
// The false-positive cost is a route that dies offline on a mountain in Nepal.
//
// lexical, single-file check — it cannot follow an island exported
// unwrapped from file A and wrapped in file B (that arrangement fails the build
// and must be restructured, or excluded here deliberately). Upgrade path if that
// ever becomes a real pattern: parse with the TS compiler already in devDeps
// instead of matching text.
const MAP_BOUNDARY_MODULE = '@/components/map-island-boundary';

// Blank out comments IN PLACE — same length, newlines kept — so offsets and reported
// line numbers stay exact while prose that merely MENTIONS a component stops matching.
// This is not hypothetical tidying: the first run of this check failed the build on
// components/calendar-planner.tsx because a comment reads "one <PlanDayMap> instance,
// placed responsively". Docblocks in this codebase name components constantly.
// blanks block comments and WHOLE-LINE `//` comments, which is every case in
// this repo. A trailing `code(); // <Foo />` would still match — it fails the build
// (safe direction), and the fix is to reword the comment.
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

    // 3) Boundary regions. MapIslandBoundary is never nested in itself; naive pairing
    // of each opening with the NEXT close therefore yields the true region, and if
    // someone ever does nest it, the region computed is SHORTER — which fails the
    // build rather than waving something through.
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

// Build the precache list per the contract:
// - every route HTML (trailingSlash:true => <route>/index.html) + 404.html
// - the _next/static assets the precached routes reference,
// UNION the root layout's ssr:false island chunks ( — invisible to that
// scrape by construction; without them every route crashes cold-offline)
// - manifest.webmanifest
// - icons/** and favicon.svg
// - EXCLUDE font/** — the self-hosted MapLibre glyph PBFs (154 KiB, issue #8) are
//   runtime-cached, not precached (V6-14; see the font/ note in the loop below)
// - EXCLUDE public/images/** (~10 MB AVIF/WebP) — runtime-cached instead,
//   WITH ONE NAMED EXCEPTION: images/hero/*.avif (D-335; see HERO_PRECACHE below).
//
// Route HTML is DISCOVERED by walking out/ (below), not a hand-kept
// literal. Every route MUST be precached so navigations resolve offline; the
// old ROUTE_HTML array silently dropped any new route someone forgot to add
// Discovery removes that footgun.
//
// _next/static/** is NOT precached wholesale — only what the precached
// routes actually reference (see eagerStaticAssets above). Route HTML itself is
// untouched and still precached in full: that is the D-073 contract and
// the torn-update invariant, NOT a side effect of scoping chunks.

// THE ONE IMAGE EXCEPTION — the Home hero rasters, and nothing else (D-335, issue #89).
//
// D-335 AMENDS D-073 and D-086(b), which say images are NEVER precached. Read D-335
// before touching this: the "never" is superseded for THIS PATH PREFIX and for nothing
// else, and everything else in D-086 (the LRU-80 cap, the content-hashed precache name,
// the origin-check-first rule, the images cache surviving `activate`) is untouched.
//
// WHY (i) — THE NEW BUG. The hero photograph follows the trip leg (lib/hero-image.ts):
// the Himalaya frame everywhere, the Shinjuku frame for the Japan leg. The Japan frame
// is a URL the device has NEVER requested before the leg flips on 19 Dec, so it is not
// in the runtime image cache either — and offline is this product's whole premise. Cold,
// the fetch fails, OptimizedImage's onError fires, and the hero paints the invented SVG
// mountain range in hero-section.tsx. A leg-aware hero that shows fake mountains on the
// one day it changes is worse than no swap at all.
//
// WHY (ii) — THE PRE-EXISTING ONE, AND IT IS THE BIGGER HALF. `trip-images-v1` is
// FIFO-80, not LRU-80: trimImageCache() evicts oldest BY INSERTION and a cache HIT does
// not refresh recency. There are 105 other manifest images. Home is the entry route, so
// the hero is among the very FIRST things inserted and therefore among the very first
// evicted — ordinary gallery browsing is enough. The DEFAULT hero was already cold
// offline before the leg swap existed. This exception fixes that too.
//
// WHY THIS SHAPE. `images/hero/` holds ONLY the two hero frames and their build-time
// derivatives — every gallery photograph lives under images/{nepal,japan,map,featured,
// photography,landing}/ — so a path PREFIX matched against the real out/ walk is narrow
// BY CONSTRUCTION rather than by a list somebody has to keep. A renamed variant cannot
// silently fall out of coverage. A third hero (hero-antarctica) would join
// automatically, which is intended; a gallery image cannot, because it is not here.
//
// WHY .avif ONLY, AND THE HOLE THAT LEAVES — NAMED. OptimizedImage renders <picture>
// with an AVIF <source> and the .jpg as the universal <img> fallback — there is no
// WebP tier (V6-13 deleted it: zero delivered bytes changed under the declared
// browserslist). A <source> whose `type` the browser supports WINS, so an AVIF-capable
// engine never requests the .jpg. The engines that are SW-capable but have NO AVIF
// decoder are Edge < 121, iOS Safari 16.0–16.3, Firefox < 93 and Chrome < 85; those
// fall through to the .jpg, which is not precached. MEASURED, not assumed: offline with
// the runtime image cache wiped, `hero-japan.jpg` comes back FETCH REJECTED — so those
// engines get the SVG fallback art offline, not a soft miss. That hole is bounded and
// ACCEPTED (D-335): closing it costs +1.22 MB of JPG to serve browsers three-plus
// years behind.
//
// WHY ALL THREE WIDTHS. The hero passes `sizes="100vw"`, so the browser picks by
// viewport x DPR and there is no partial credit: a device that selects 1024w gets NO
// benefit from a precached 1920w. Measured selections — 390@3 and every desktop
// >=1280 take the native 1920 (that includes the `chromium` Playwright project, which
// is Desktop Chrome at 1280x720), 375@2 and 768@1 take 1024w, 390@1 takes 640w.
//
// WHAT IT COSTS, IN THE DENOMINATOR THAT MATTERS. Raw, the six files are 555.2 KiB of a
// 4.57 MiB precache — 11.9%, which understates it. AVIF does not compress and the HTML
// and JS do, so on the wire the install is 1.81 MiB gzipped and the hero is 555.3 KiB of
// THAT: 30.0%. Without it a new user downloads 1.26 MiB; with it, 1.81 MiB — +43% on the
// install payload for the offline hero guarantee. All six stay (D-335): every trim drops
// a real device class, and dropping the two native 1920s would put the hole on DPR-3
// phones, which select native.
const HERO_PRECACHE = /^images\/hero\/[^/]+\.avif$/;

async function buildPrecacheList(allFiles) {
  const set = new Set();
  const eager = await eagerStaticAssets(allFiles.filter((r) => r.endsWith('.html')));
  // UNION in the root layout's ssr:false island chunks, which the HTML scrape
  // above cannot see by construction (see islandAssets). A Set union, so an
  // asset both arms name is precached exactly once.
  for (const rel of await islandAssets()) eager.add(rel);

  for (const rel of allFiles) {
    // Route HTML: top-level index.html + every nested <route>/index.html, plus
    // the export's 404.html fallback. EXCLUDE 404/index.html: Next emits BOTH
    // 404.html (the canonical fallback the nav handler serves — see
    // NAV_FALLBACK/404 logic) and a redundant 404/index.html route dir;
    // precaching the fallback alone matches historical behavior and avoids a
    // duplicate /404/ precache entry.
    if (rel === 'index.html' || rel === '404.html') set.add(rel);
    else if (rel.endsWith('/index.html') && rel !== '404/index.html') set.add(rel);
    else if (rel.startsWith('_next/static/') && eager.has(rel)) set.add(rel);
    else if (rel.startsWith('icons/')) set.add(rel);
    // NOTE: font/** — the self-hosted MapLibre SDF glyph PBFs
    // (public/font/<fontstack>/0-255.pbf, 154 KiB / ~87 KB gzip — issue #8) — is
    // deliberately NOT precached (V6-14). It only ever serves /map, and 154 KiB on
    // EVERY install for a route most sessions never open is the wrong trade; the
    // maplibre engine that consumes them is withheld for the same reason (see
    // islandAssets). What issue #8 actually fixed was the CROSS-ORIGIN problem —
    // while the glyphs were cross-origin the SW's first fetch-handler line returned
    // them untouched and nothing could ever cache them. Self-hosted, they are
    // same-origin non-image GETs, so the static cacheFirst handler should pick them up
    // on the first online map visit — with the caveat named in islandAssets: maplibre
    // requests glyphs from a BLOB-URL worker, and that interception is reasoned, not
    // measured. The named regression: map labels are blank on a COLD-offline first
    // open of /map, and possibly on every offline open if the worker is not
    // intercepted. Labels on /map is a promise D-274 does not make.
    else if (rel === 'favicon.svg') set.add(rel);
    else if (rel === 'manifest.webmanifest') set.add(rel);
    // NOTE: images/** is deliberately excluded (runtime cache) EXCEPT the hero
    // rasters (D-335) — see HERO_PRECACHE above for the whole argument. Matching against
    // what the walk actually found (rather than a literal URL list) also keeps the
    // ATOMIC install honest: a variant that gen-images.mjs did not emit is simply
    // not listed, instead of 404-ing every install.
    else if (HERO_PRECACHE.test(rel)) set.add(rel);
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
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
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
      // ALLOWLIST cleanup, scoped to OUR caches: delete any cache key of ours
      // that is not in the current set — the active precache PLUS the two runtime
      // caches. This drops the previous build's trip-precache-* (atomic activation)
      // AND garbage-collects renamed runtime caches (e.g. a bumped trip-images-v1 ->
      // v2, or a retired frankfurter cache) that a prefix-only filter would have
      // leaked forever. FRANKFURTER_CACHE is declared lower in this file; it is only
      // read here at activate time (well after module eval), so no TDZ issue.
      //
      // The OWNERSHIP predicate is load-bearing and is not a duplicate of the
      // allowlist: caches.keys() is scoped to the ORIGIN, not to this worker's
      // scope, and the live app is a GitHub Pages PROJECT page — powan55.github.io
      // is shared with every other Pages project on the account. Without the
      // prefix, accepting an update here wipes a sibling app's Cache Storage, and
      // that sibling only repopulates on ITS own next version bump.
      const allowlist = new Set([PRECACHE, IMAGES_CACHE, FRANKFURTER_CACHE]);
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('trip-') && !allowlist.has(k))
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
function cacheKey(request) {
  const url = new URL(request.url);
  if (!url.searchParams.has('_rsc')) return request;
  url.searchParams.delete('_rsc');
  return url.href;
}

async function cacheFirst(request, cacheName) {
  const key = cacheKey(request);
  const cached = await cacheMatch(key);
  if (cached) return cached;
  const res = await fetch(request);
  if (res && res.ok && res.type === 'basic') {
    const cache = await caches.open(cacheName);
    cache.put(key, res.clone());
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
        if (cached) return cached;
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
          if (res && res.ok && res.type === 'basic') {
            const copy = res.clone(); // clone NOW, before the browser locks the body
            caches.open(PRECACHE).then((cache) => cache.put(normalized, copy)).catch(() => {});
          }
          return res;
        } catch (err) {
          const shell = await cacheMatch(NAV_FALLBACK);
          if (shell) return shell;
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
  event.respondWith(
    (async () => {
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
