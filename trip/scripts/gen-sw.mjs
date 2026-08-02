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
const THEME_COLOR = '#0b0c0e';

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
// costs ~17 more entries but silently breaks the/TD-04 + invariant:
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
// hand-kept list is the/TD-04 failure mode this file already fixed once for
// route HTML, and it is how a new island would silently fall out again.
//
// 🔴 SCOPE — and this is the part that must NOT be hand-picked. The obvious seed
// is `app/chrome-islands.tsx`, and it is WRONG BY MEASUREMENT: seeding only that
// module still left the app crashing cold-offline, because `<TravelModeMounts />`
// is an EIGHTH root-layout ssr:false island, declared in
// `components/itinerary-provider.tsx` (which `app/layout.tsx` mounts) and rendered
// unconditionally there. Any list a human writes has that shape of hole — which is
// the/TD-04 failure mode this file already fixed once for route HTML. So the
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
// 🔴 maplibre — CHANGED THE MECHANISM, read this before trusting it.
// Under maplibre was excluded "twice over": `maplibre-gl` is a bare specifier
// (step 3 stops there), AND it was reached only from `app/map/sections.tsx`, which
// was not in the layout's graph at all. **The second of those is no longer true** —
// seeds every route entry, so `app/map/sections.tsx -> @/components/map-section`
// IS walked now. Only the bare-specifier stop still applies, and it alone is NOT
// enough: `map-section`'s own chunk list carries maplibre-bearing chunks. So the
// exclusion is now EXPLICIT and by CONTENT — see isMaplibreChunk() below — and the
// call sites it reduces are printed at build time, because a reduced call site
// THROWS cold-offline unless it is wrapped in components/map-island-boundary.tsx.
//
// Entries this returns that are NOT on disk are ignored for free: `buildPrecacheList`
// iterates the real out/ walk and only membership-tests this set, so a stale manifest
// row can never inject a URL that 404s and break the atomic install.
const NEXT_DIR = join(ROOT, '.next'); // next.config.js: distDir = '.next'
const APP_DIR = 'app';
const ROOT_LAYOUT = 'app/layout.tsx';
const SOURCE_EXTS = ['.tsx', '.ts', '.jsx', '.js'];

// every ROUTE ENTRY POINT under app/ — `app/**​/page.tsx` — DISCOVERED by
// walking the directory, never hand-listed. Same TD-04 rule the route-HTML walk
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

// maplibre's engine chunks must NEVER enter the precache — ~1008 KiB
// for a page many users never open, and an offline map engine with no cached tiles
// paints a blank canvas anyway.
//
// Matched by CONTENT, never by filename: next.config.js sets
// `output.chunkFilename = 'static/chunks/[contenthash:16].js'`, so async chunk
// filenames carry no name at all and any filename-pattern approach is a non-starter.
//
// Scoped to `.js` DELIBERATELY, and this is measured, not theoretical: 2 built CSS
// files also contain `maplibregl` (maplibre's stylesheet is bundled into the app's
// CSS), so an all-file-types grep would withhold the app's OWN stylesheet and ship a
// completely unstyled offline app. is about the ENGINE, which is JS.
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
  const mapReduced = [];
  while (queue.length) {
    const source = queue.shift();
    if (visited.has(source)) continue;
    visited.add(source);
    for (const { specifier, files: chunkFiles } of bySource.get(source) ?? []) {
      const target = await resolveLocal(source, specifier);
      if (!target || !target.startsWith('components/')) continue; // render path only
      sites.push(`${source} -> ${specifier}`);
      let withheld = 0;
      for (const file of chunkFiles) {
        if (await isMaplibreChunk(file)) {
          withheld++; // the engine stays out
          continue;
        }
        files.add(`_next/${file}`);
      }
      if (withheld > 0) mapReduced.push({ site: `${source} -> ${specifier}`, withheld });
      if (bySource.has(target)) queue.push(target);
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

  // report. These call sites render a component whose chunk is DELIBERATELY
  // absent from the precache, so React.lazy THROWS there cold-offline and the throw
  // escapes to app/error.tsx — taking the whole route down, hero included — unless
  // the call site is wrapped in an island error boundary.
  console.log(
    `gen-sw: maplibre withheld from ${mapReduced.length} call site(s) — each MUST be ` +
      'wrapped in components/map-island-boundary.tsx or it crashes its route cold-offline:'
  );
  for (const { site, withheld } of mapReduced) {
    console.log(`    map-reduced ${site}  (${withheld} chunk(s) withheld)`);
  }
  // and the report is now ENFORCED, not just printed (see assertMapIslandsWrapped).
  await assertMapIslandsWrapped(mapReduced);
  return files;
}

// — PROVE each maplibre-reduced call site is actually wrapped, and fail the
// build if it is not.
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

async function assertMapIslandsWrapped(mapReduced) {
  for (const { site } of mapReduced) {
    const [source, specifier] = site.split(' -> ');
    const fix =
      `FIX: in ${source}, import ${MAP_BOUNDARY_MODULE} and wrap every render of the ` +
      `${specifier} island in <MapIslandBoundary label="…">…</MapIslandBoundary>. ` +
      'See app/map/sections.tsx for the shape.';
    const why =
      `gen-sw withholds ${specifier}'s maplibre chunk from the precache, so cold-offline ` +
      'React.lazy THROWS at this call site and app/error.tsx replaces the ENTIRE route.';

    let src;
    try {
      src = blankComments(await readFile(join(ROOT, source), 'utf8'));
    } catch {
      throw new Error(
        `gen-sw — ${site} is maplibre-reduced but ${source} could not be read, ` +
          `so the island error boundary CANNOT be verified. ${why} ${fix}`
      );
    }

    // 1) The boundary's LOCAL name in this file (a rename still verifies).
    const boundary = src.match(
      new RegExp(`import\\s+(\\w+)\\s+from\\s+['"]${MAP_BOUNDARY_MODULE}['"]`)
    )?.[1];
    if (!boundary) {
      throw new Error(
        `gen-sw — ${site} is maplibre-reduced but ${source} does not import ` +
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
        `gen-sw — ${site} is maplibre-reduced but its \`const X = dynamic(() => ` +
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
        `gen-sw — ${site} is maplibre-reduced and UNPROTECTED: ${detail}. ${why} ${fix}`
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
// - EXCLUDE public/images/** (~10 MB AVIF/WebP) — runtime-cached instead.
//
// TD-04: route HTML is DISCOVERED by walking out/ (below), not a hand-kept
// literal. Every route MUST be precached so navigations resolve offline; the
// old ROUTE_HTML array silently dropped any new route someone forgot to add
// Discovery removes that footgun.
//
// _next/static/** is NOT precached wholesale — only what the precached
// routes actually reference (see eagerStaticAssets above). Route HTML itself is
// untouched and still precached in full: that is the/TD-04 contract and
// the torn-update invariant, NOT a side effect of scoping chunks.
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
      // ALLOWLIST cleanup: delete ANY cache key not in the current set —
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
          // Nav backfill: a route missed at install (or added between
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
