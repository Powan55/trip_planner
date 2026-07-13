// gen-images.mjs — build-time image derivative + LQIP pipeline ().
//
// WHY THIS EXISTS: the site ships as a static export with
// `images:{unoptimized:true}`, so Next's runtime image optimizer is OFF. To still
// serve modern formats and kill CLS we PRE-GENERATE derivatives here, LOCALLY, and
// COMMIT them. This script is invoked ONLY by `npm run gen:images` — it is NOT part
// of `build`/`prebuild`, and `sharp` is a devDependency imported by NO client code,
// so 0 bytes of sharp ship to the browser.
//
// For each source raster (.jpg/.jpeg/.png) under public/images/** it emits a sibling
// `.webp` and `.avif`, reads the intrinsic width/height, and computes a tiny base64
// `blurDataURL` (LQIP). It writes lib/image-manifest.json mapping the SAME root-
// relative string the app passes to withBasePath() (e.g. "/images/nepal/na1.jpg")
// → { webp, avif, blurDataURL, width, height }. SVGs and already-tiny files are skipped.
//
// Idempotent: re-running regenerates derivatives and the manifest from sources.

import { readdir, stat, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.join(__dirname, '..');
const IMAGES_DIR = path.join(APP_ROOT, 'public', 'images');
const MANIFEST_PATH = path.join(APP_ROOT, 'lib', 'image-manifest.json');

// Encode quality. AVIF is dramatically smaller at a given perceptual quality than
// JPEG/WebP, so we can afford a slightly lower numeric quality for the same look.
const WEBP_QUALITY = 80; // visually ~lossless for photographic content
const AVIF_QUALITY = 50; // AVIF q50 ≈ WebP q80 perceptually, far fewer bytes
const AVIF_EFFORT = 4; // 0..9 encode effort (speed vs size); 4 is a good local default

// LQIP: downscale to a tiny raster and inline as base64. ~20px wide keeps the data
// URL small (a few hundred bytes) while giving a recognizable blur-up.
const LQIP_WIDTH = 20;
const LQIP_QUALITY = 40;

// Files at/under this many bytes are not worth derivatives (overhead > savings).
const MIN_SOURCE_BYTES = 4 * 1024;

const SOURCE_EXT = new Set(['.jpg', '.jpeg', '.png']);

/** Recursively collect every file under `dir`. */
async function walk(dir) {
 const out = [];
 for (const entry of await readdir(dir, { withFileTypes: true })) {
 const full = path.join(dir, entry.name);
 if (entry.isDirectory()) out.push(...(await walk(full)));
 else if (entry.isFile()) out.push(full);
 }
 return out;
}

/** Absolute fs path → the root-relative "/images/..." key the app uses (POSIX slashes). */
function toManifestKey(absPath) {
 const rel = path.relative(path.join(APP_ROOT, 'public'), absPath);
 return '/' + rel.split(path.sep).join('/');
}

function fmtKB(bytes) {
 return (bytes / 1024).toFixed(1) + ' KB';
}

async function run() {
 if (!existsSync(IMAGES_DIR)) {
 console.error(`[gen-images] images dir not found: ${IMAGES_DIR}`);
 process.exit(1);
 }

 const all = await walk(IMAGES_DIR);
 const sources = all.filter((f) => SOURCE_EXT.has(path.extname(f).toLowerCase()));

 console.log(`[gen-images] found ${sources.length} source raster(s) under public/images`);

 const manifest = {};
 let processed = 0;
 let skippedTiny = 0;
 let totalSrc = 0;
 let totalWebp = 0;
 let totalAvif = 0;
 const samples = [];

 for (const src of sources.sort()) {
 const ext = path.extname(src);
 const base = src.slice(0, -ext.length);
 const webpPath = `${base}.webp`;
 const avifPath = `${base}.avif`;
 const key = toManifestKey(src);

 const srcStat = await stat(src);
 if (srcStat.size <= MIN_SOURCE_BYTES) {
 skippedTiny += 1;
 continue;
 }

 const input = await readFile(src);

 // Intrinsic dimensions — drive explicit width/height on the <img> so the box is
 // reserved before load (CLS ≈ 0).
 const meta = await sharp(input).metadata();
 const width = meta.width ?? 0;
 const height = meta.height ?? 0;

 // Derivatives. `rotate()` with no arg applies EXIF orientation so the encoded
 // raster matches the intrinsic w/h we report.
 await sharp(input).rotate().webp({ quality: WEBP_QUALITY }).toFile(webpPath);
 await sharp(input).rotate().avif({ quality: AVIF_QUALITY, effort: AVIF_EFFORT }).toFile(avifPath);

 // LQIP — tiny WebP, inlined base64.
 const lqipBuf = await sharp(input)
 .rotate()
 .resize(LQIP_WIDTH, null, { fit: 'inside' })
 .webp({ quality: LQIP_QUALITY })
 .toBuffer();
 const blurDataURL = `data:image/webp;base64,${lqipBuf.toString('base64')}`;

 const webpSize = (await stat(webpPath)).size;
 const avifSize = (await stat(avifPath)).size;

 manifest[key] = {
 webp: key.replace(ext, '.webp'),
 avif: key.replace(ext, '.avif'),
 blurDataURL,
 width,
 height,
 };

 totalSrc += srcStat.size;
 totalWebp += webpSize;
 totalAvif += avifSize;
 processed += 1;
 if (samples.length < 6) {
 samples.push({ key, src: srcStat.size, webp: webpSize, avif: avifSize, width, height });
 }
 }

 // Stable key order for a clean, reviewable diff.
 const ordered = {};
 for (const k of Object.keys(manifest).sort()) ordered[k] = manifest[k];
 await writeFile(MANIFEST_PATH, JSON.stringify(ordered, null, 2) + '\n', 'utf8');

 console.log(`\n[gen-images] processed ${processed}, skipped ${skippedTiny} tiny`);
 console.log(`[gen-images] manifest → ${path.relative(APP_ROOT, MANIFEST_PATH)} (${processed} entries)`);
 console.log('\n[gen-images] sample savings (source → derivative):');
 for (const s of samples) {
 const wPct = ((1 - s.webp / s.src) * 100).toFixed(0);
 const aPct = ((1 - s.avif / s.src) * 100).toFixed(0);
 console.log(
 ` ${s.key} ${s.width}x${s.height} jpg ${fmtKB(s.src)} → webp ${fmtKB(s.webp)} (-${wPct}%) avif ${fmtKB(s.avif)} (-${aPct}%)`,
 );
 }
 if (processed > 0) {
 const wTot = ((1 - totalWebp / totalSrc) * 100).toFixed(0);
 const aTot = ((1 - totalAvif / totalSrc) * 100).toFixed(0);
 console.log(
 `\n[gen-images] TOTAL jpg ${fmtKB(totalSrc)} → webp ${fmtKB(totalWebp)} (-${wTot}%) avif ${fmtKB(totalAvif)} (-${aTot}%)`,
 );
 }
}

run().catch((err) => {
 console.error('[gen-images] FAILED:', err);
 process.exit(1);
});
