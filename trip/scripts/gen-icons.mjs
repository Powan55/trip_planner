// scripts/gen-icons.mjs — run ONCE manually; the emitted PNGs are committed.
//
// node scripts/gen-icons.mjs
//
// Rasterizes public/favicon.svg (the app's brand glyph) into the PWA icon set
// under public/icons/ using `sharp` (already a devDependency — no new deps).
//
// Outputs:
// public/icons/icon-192.png 192x192 (any-purpose)
// public/icons/icon-512.png 512x512 (any-purpose)
// public/icons/icon-maskable-512.png 512x512 (maskable — glyph rendered at
// ~80% inside a padded safe zone on the
// app's navy-900 background so Android's
// circular/rounded mask never clips it)
// public/icons/apple-touch-icon.png 180x180 (iOS home-screen)
//
// The maskable safe zone: the spec guarantees the inner 80% (a centered circle
// of radius 40% of the icon) is never masked away. We render the glyph into that
// inner box and pad the rest with the brand background so no glyph pixels fall
// in the mask-clipped border.
//
// Background = navy-900 (#0a0e27), the color the app's <body> actually paints
// (Tailwind token `navy-900`, tailwind.config.ts; body className bg-navy-900 in
// app/layout.tsx). Same hex feeds the manifest theme/background_color in
// gen-sw.mjs, so the installed app, splash, and address bar all agree.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SVG_PATH = join(ROOT, 'public', 'favicon.svg');
const OUT_DIR = join(ROOT, 'public', 'icons');

// The app's navy-900 (matches manifest background_color/theme_color).
const BG = { r: 0x0a, g: 0x0e, b: 0x27, alpha: 1 };

async function renderGlyph(svgBuffer, size) {
 // Render the SVG crisply at the requested edge length.
 return sharp(svgBuffer, { density: 384 })
 .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
 .png()
 .toBuffer();
}

async function writeStandard(svgBuffer, size, name) {
 // The favicon.svg already fills its own 256x256 viewBox on a navy field, so a
 // plain contain-resize onto the brand background gives a full-bleed icon.
 const glyph = await renderGlyph(svgBuffer, size);
 await sharp({
 create: { width: size, height: size, channels: 4, background: BG },
 })
 .composite([{ input: glyph, top: 0, left: 0 }])
 .png()
 .toFile(join(OUT_DIR, name));
 console.log(` wrote icons/${name} (${size}x${size})`);
}

async function writeMaskable(svgBuffer, size, name) {
 // Render the glyph at ~80% and center it, padding to `size` with the brand
 // background so nothing important sits in the ~10% mask-clipped border.
 const inner = Math.round(size * 0.8);
 const offset = Math.round((size - inner) / 2);
 const glyph = await renderGlyph(svgBuffer, inner);
 await sharp({
 create: { width: size, height: size, channels: 4, background: BG },
 })
 .composite([{ input: glyph, top: offset, left: offset }])
 .png()
 .toFile(join(OUT_DIR, name));
 console.log(` wrote icons/${name} (${size}x${size}, maskable safe zone)`);
}

async function main() {
 await mkdir(OUT_DIR, { recursive: true });
 const svgBuffer = await readFile(SVG_PATH);
 console.log(`gen-icons: rasterizing ${SVG_PATH}`);
 await writeStandard(svgBuffer, 192, 'icon-192.png');
 await writeStandard(svgBuffer, 512, 'icon-512.png');
 await writeMaskable(svgBuffer, 512, 'icon-maskable-512.png');
 await writeStandard(svgBuffer, 180, 'apple-touch-icon.png');
 console.log('gen-icons: done.');
}

main().catch((err) => {
 console.error('gen-icons FAILED:', err);
 process.exit(1);
});
