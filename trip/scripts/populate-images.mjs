// scripts/populate-images.mjs
//
// One-shot data populator for slice. Reads scripts/image-map.json and
// injects `image: '/images/<area>/<id>.<ext>'` into each RESOLVED record across
// the four data files. Idempotent: it never adds a duplicate `image` to a record
// that already has one, and it only touches ids that resolved (skips keep their
// design fallback). Run from nextjs_space/: node scripts/populate-images.mjs

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const imageMap = JSON.parse(
  await readFile(path.join(__dirname, 'image-map.json'), 'utf8'),
);

// Inject `image: '<path>'` right after each record's `id: '<id>'` field.
// Matches both single-line records and multi-line records (the map file),
// preserving the indentation that precedes `id:`.
function injectImages(src, ids) {
  let count = 0;
  let out = src;
  for (const id of ids) {
    const entry = imageMap[id];
    if (!entry) continue; // not resolved → leave fallback
    // Find the exact `id: '<id>',` occurrence (with optional surrounding ws).
    const idRe = new RegExp(`(\\bid:\\s*'${escapeRe(id)}',)`);
    const m = out.match(idRe);
    if (!m) {
      console.warn(`  WARN: id '${id}' not found in source`);
      continue;
    }
    // Skip if this record already has an image immediately after the id field.
    const after = out.slice(m.index + m[0].length, m.index + m[0].length + 40);
    if (/^\s*image:/.test(after)) continue;
    const insertion = `${m[0]} image: '${entry.path}',`;
    out = out.slice(0, m.index) + insertion + out.slice(m.index + m[0].length);
    count += 1;
  }
  return { out, count };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function idsForArea(area) {
  return Object.keys(imageMap).filter((id) => imageMap[id].path.startsWith(`/images/${area}/`));
}

// ── nepal-data.ts ────────────────────────────────────────────────────────────
{
  const file = path.join(ROOT, 'lib', 'nepal-data.ts');
  let src = await readFile(file, 'utf8');
  const { out, count } = injectImages(src, idsForArea('nepal'));
  await writeFile(file, out, 'utf8');
  console.log(`nepal-data.ts: injected ${count} image fields`);
}

// ── japan-data.ts ────────────────────────────────────────────────────────────
{
  const file = path.join(ROOT, 'lib', 'japan-data.ts');
  let src = await readFile(file, 'utf8');
  const { out, count } = injectImages(src, idsForArea('japan'));
  await writeFile(file, out, 'utf8');
  console.log(`japan-data.ts: injected ${count} image fields`);
}

// ── photography-data.ts ──────────────────────────────────────────────────────
{
  const file = path.join(ROOT, 'lib', 'photography-data.ts');
  let src = await readFile(file, 'utf8');
  // Add `image?: string` to the PhotoSpot interface if not present.
  if (!/interface PhotoSpot[\s\S]*?image\?:/.test(src)) {
    src = src.replace(
      /(export interface PhotoSpot \{[\s\S]*?category: string;)/,
      `$1\n  image?: string;`,
    );
  }
  const { out, count } = injectImages(src, idsForArea('photography'));
  await writeFile(file, out, 'utf8');
  console.log(`photography-data.ts: injected ${count} image fields`);
}

// ── map-data.ts ──────────────────────────────────────────────────────────────
{
  const file = path.join(ROOT, 'lib', 'map-data.ts');
  let src = await readFile(file, 'utf8');
  if (!/interface MapMarker[\s\S]*?image\?:/.test(src)) {
    // Append after the `y: number;` field doc/line inside MapMarker.
    src = src.replace(
      /(\/\*\* 0-100 — vertical % position on that country's mock panel\. \*\/\n\s*y: number;)/,
      `$1\n  \n  image?: string;`,/** Optional bundled photo for the popup. */
    );
  }
  const { out, count } = injectImages(src, idsForArea('map'));
  await writeFile(file, out, 'utf8');
  console.log(`map-data.ts: injected ${count} image fields`);
}

// ── travel-tips-data.ts (FeaturedDestination — match by name, not id) ─────────
{
  const file = path.join(ROOT, 'lib', 'travel-tips-data.ts');
  let src = await readFile(file, 'utf8');

  // Add `image?: string` to the FeaturedDestination interface if not present.
  if (!/interface FeaturedDestination \{[\s\S]*?image\?:/.test(src)) {
    src = src.replace(
      /(export interface FeaturedDestination \{[\s\S]*?emoji: string;)/,
      `$1\n  image?: string;`,
    );
  }

  // slug -> the `name` field value as it appears in travel-tips-data.ts
  const featuredByName = {
    'Boudhanath Stupa': 'boudhanath',
    'Patan Durbar Square': 'patan-durbar',
    'Nagarkot Sunrise': 'nagarkot',
    'Shibuya, Tokyo': 'shibuya',
    'Arashiyama, Kyoto': 'arashiyama',
    'Mt. Fuji': 'mount-fuji',
  };

  let count = 0;
  for (const [name, slug] of Object.entries(featuredByName)) {
    const entry = imageMap[slug];
    if (!entry) continue;
    const nameRe = new RegExp(`(\\bname:\\s*'${escapeRe(name)}',)`);
    const m = src.match(nameRe);
    if (!m) {
      console.warn(`  WARN: featured name '${name}' not found`);
      continue;
    }
    const after = src.slice(m.index + m[0].length, m.index + m[0].length + 40);
    if (/^\s*image:/.test(after)) continue;
    src = src.slice(0, m.index) + `${m[0]} image: '${entry.path}',` + src.slice(m.index + m[0].length);
    count += 1;
  }
  await writeFile(file, src, 'utf8');
  console.log(`travel-tips-data.ts: injected ${count} featured image fields`);
}

console.log('Done.');
