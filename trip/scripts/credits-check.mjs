// The image attribution audit. Exits 1 on any failure.
//   npm run credits-check   (or: node scripts/credits-check.mjs)
//
// WHY THIS EXISTS. D-015 requires every bundled image to be freely licensed and, where the
// licence asks for credit, attributed in public/images/CREDITS.md. Nothing enforced that.
// lib/__tests__/image-srcset.test.ts checks refs against lib/image-manifest.json (the AVIF/LQIP
// table) and never reads CREDITS.md or scripts/image-map.json, so a hand-edited map, a partial
// `--only=` re-fetch, or a raster dropped into public/images/ by hand all ship green. That is
// exactly the drift that once left most of the tree uncredited with two non-free logos in it.
//
// Offline and dependency-free, like the other three pre-install checks. It reads the committed
// files and compares them to each other — it does NOT re-fetch from Wikimedia. A gate that hits
// a remote is a flake, and the upstream metadata can change under a tree that is still correct.
//
// KNOWN CEILING: this proves the bundled rasters are all credited, credited to something free,
// and that image-map.json agrees with the table. It cannot prove the recorded licence is the one
// Wikimedia actually states — only a network fetch can, and that is the re-fetch, not the gate.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IMAGES_DIR = resolve(APP_ROOT, 'public/images');
const CREDITS_PATH = resolve(IMAGES_DIR, 'CREDITS.md');
const MAP_PATH = resolve(APP_ROOT, 'scripts/image-map.json');

// Source rasters are what gets credited. .avif siblings are generated from them by
// scripts/gen-images.mjs and inherit the row of the file they were derived from.
const SOURCE_EXT = /\.(jpe?g|png)$/i;

// Free-licence allowlist (D-015). Anything else in a licence cell fails, which is what stops a
// non-free logo or an all-rights-reserved photo from being bundled with a plausible-looking row.
// A two-letter suffix is a CC jurisdiction port (e.g. 'CC BY-SA 3.0 de'), same terms as the unported licence.
const FREE_LICENCE = /^(CC0|Public domain|CC BY(-SA)? \d+(\.\d+)?( [a-z]{2})?)$/;
// The only non-Wikimedia rows: screenshots of this app, which no third party holds a right in.
// Scoped to the directory they live in so a sourced photo cannot be waved through as "Own work".
const OWN_WORK = new Set(['Own work', 'Own work; basemap ODbL / CC BY']);
const OWN_WORK_DIR = '/images/landing/';

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = walk(IMAGES_DIR).map((f) => f.replace(/\\/g, '/').slice(IMAGES_DIR.length - '/images'.length));
const rasters = files.filter((f) => SOURCE_EXT.test(f));
const derived = files.filter((f) => /\.avif$/i.test(f));

// One row per bundled path: | `/images/a/b.jpg` | Subject | Author | Licence | Source |
const credits = readFileSync(CREDITS_PATH, 'utf8');
const rows = new Map();
const problems = [];
for (const m of credits.matchAll(/^\|\s*`(\/images\/[^`]+)`\s*\|[^|]*\|([^|]*)\|([^|]*)\|/gm)) {
  const [, path, author, licence] = m;
  if (rows.has(path)) problems.push(`CREDITS.md: ${path} has more than one row`);
  rows.set(path, { author: author.trim(), licence: licence.trim() });
}

// A licence cell is either `[LABEL](url)` or bare text; the label is what we check.
const label = (cell) => (cell.match(/^\[([^\]]+)\]\(/)?.[1] ?? cell).trim();

// 1. every bundled raster is credited, and 2. every row points at a file that is actually here
for (const path of rasters) if (!rows.has(path)) problems.push(`${path}: bundled but has no CREDITS.md row`);
for (const path of rows.keys()) if (!rasters.includes(path)) problems.push(`CREDITS.md: row for ${path}, which is not in public/images/`);

// 3. generated variants must descend from a credited raster, or they are an uncredited image
for (const path of derived) {
  const stem = path.replace(/(-\d+w)?\.avif$/i, '');
  if (!rasters.some((r) => r.replace(SOURCE_EXT, '') === stem)) problems.push(`${path}: generated variant with no source raster (so nothing credits it)`);
}

// 4. every licence is free
for (const [path, row] of rows) {
  const lic = label(row.licence);
  if (OWN_WORK.has(lic)) {
    if (!path.startsWith(OWN_WORK_DIR)) problems.push(`${path}: "${lic}" is only valid for ${OWN_WORK_DIR} screenshots`);
  } else if (!FREE_LICENCE.test(lic)) {
    problems.push(`${path}: licence "${lic}" is not on the free allowlist (D-015)`);
  }
  if (!row.author) problems.push(`${path}: row has no author`);
}

// 5. image-map.json is the fetcher's output and the table's upstream; they must agree
const map = JSON.parse(readFileSync(MAP_PATH, 'utf8'));
for (const [id, entry] of Object.entries(map)) {
  const row = rows.get(entry.path);
  if (!row) {
    problems.push(`image-map.json ${id}: path ${entry.path} has no CREDITS.md row`);
    continue;
  }
  // fetch-images.mjs writes an empty artist into the table as 'Unknown'.
  if ((entry.artist || 'Unknown') !== row.author) problems.push(`image-map.json ${id}: artist "${entry.artist}" but CREDITS.md says "${row.author}"`);
  if (entry.license !== label(row.licence)) problems.push(`image-map.json ${id}: licence "${entry.license}" but CREDITS.md says "${label(row.licence)}"`);
}

// Fails closed: either number at zero means the walk or the row parser stopped matching, and the
// clean verdict below would be vacuous — the failure mode a green run hides.
if (rasters.length === 0) problems.push('no source rasters found under public/images/ — the walk moved and this audit proves nothing');
if (rows.size === 0) problems.push('no rows parsed out of CREDITS.md — the table format moved and this audit proves nothing');

console.log(`image attribution audit · ${rasters.length} raster(s) · ${derived.length} generated variant(s) · ${rows.size} CREDITS.md row(s) · ${Object.keys(map).length} image-map.json entr(ies)\n`);
if (problems.length) {
  console.log(problems.length + ' PROBLEM(S):');
  for (const p of problems) console.log('  · ' + p);
} else {
  console.log('EVERY BUNDLED IMAGE IS CREDITED AND FREELY LICENSED');
}
process.exit(problems.length ? 1 : 0);
