#!/usr/bin/env node
// Byte budgets for the assets this repo ships. Exits 1 over any ceiling.
//   npm run budget-check     (or: node scripts/asset-budget.mjs)
//
// WHY THIS EXISTS. Nothing in CI measured bytes. The one size-adjacent guard was
// `expect(imageEntries).toHaveLength(6)` in e2e/pwa.spec.ts, whose failure message
// quotes "555.2 KiB" — the COUNT is asserted and the bytes are not, so re-encoding a
// hero photograph at 2 MB keeps it green while every new install pays for it. The
// number had already drifted before anyone noticed: the six hero AVIFs measure
// 570,022 B against 568,494 B one commit earlier. And that spec runs on pull
// requests only, so it is absent from the path a direct push to main takes.
//
// SOURCE TREE ONLY, AND THAT IS A REAL LIMIT — say it rather than paper over it.
// This runs in the dependency-free block, before `npm ci` and long before a build,
// so out/ does not exist here. The install payload's JS and HTML half is therefore
// NOT covered: it only exists after `npm run build`, and a check that silently
// skipped itself when out/ was missing would report green having measured nothing,
// which is the failure mode this whole file is about. What IS covered is every byte
// the service worker precaches out of public/ (scripts/gen-sw.mjs HERO_PRECACHE +
// icons + favicon), which is where the install-weight risk actually sits, plus the
// image tree as a whole.
//
// CEILINGS, NOT PINS. Each number below is a measured baseline plus headroom, so an
// ordinary re-encode does not fail the build and a doubling does. Raise one only
// with a reason; when a cleanup drops a measured total well under its ceiling, bring
// the ceiling down with it in the same commit or it stops meaning anything.

import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Every file under `rel`, recursively. Throws if the directory is gone — see atLeast. */
function filesUnder(rel, keep = () => true) {
  const out = [];
  const walk = (abs) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const full = join(abs, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (keep(entry.name)) out.push(full);
    }
  };
  walk(resolve(APP_ROOT, rel));
  return out;
}

const bytes = (files) => files.reduce((total, f) => total + statSync(f).size, 0);
const kib = (n) => `${(n / 1024).toFixed(1)} KiB`;
const mib = (n) => `${(n / 1024 / 1024).toFixed(2)} MiB`;

// `atLeast` is the fail-closed half and it is not decoration: a renamed or moved
// directory makes an empty set measure 0 bytes, which passes every ceiling and proves
// nothing. A count floor turns that into a failure. It is a FLOOR, not the current
// count — the count itself is pinned once, in e2e/pwa.spec.ts, and does not belong twice.
const BUDGETS = [
  {
    label: 'hero rasters (precached — gen-sw.mjs HERO_PRECACHE)',
    files: () => filesUnder('public/images/hero', (n) => n.endsWith('.avif')),
    atLeast: 6,
    // 570,022 B measured across 6 files + 5%. This is the tight one: it is the only
    // image set that lands in every install, and D-335 prices the exception in bytes.
    ceiling: 598_523,
    format: kib,
  },
  {
    label: 'the rest of the precache from public/ (icons, favicon)',
    files: () => [...filesUnder('public/icons'), resolve(APP_ROOT, 'public/favicon.svg')],
    atLeast: 5,
    // 70,577 B measured + 5%. Small and static; it is here so the precache's
    // public-tree half is measured in full rather than only where it hurts today.
    ceiling: 74_106,
    format: kib,
  },
  {
    label: 'the whole image tree (public/images/**, runtime-cached)',
    files: () => filesUnder('public/images'),
    // 800 files today. The floor is here to catch the tree moving, and at 400 half of it
    // could vanish before this row noticed — which is the same silence it exists to break.
    atLeast: 700,
    // 111,968,974 B measured across 800 files + 5%, re-measured after the unreachable-image
    // deletion landed in this commit. These bytes are runtime-cached, never precached, so
    // the cost is per-view rather than per-install and the guard is against a bulk add
    // rather than a re-encode — the hero row above is the one that catches those.
    ceiling: 117_567_423,
    format: mib,
  },
];

let failed = 0;
console.log('asset byte budgets · source tree only (no build required)\n');
console.log('set'.padEnd(56), 'files'.padStart(6), 'measured'.padStart(12), 'ceiling'.padStart(12), '  headroom  verdict');

for (const { label, files, atLeast, ceiling, format } of BUDGETS) {
  const found = files();
  const size = bytes(found);
  const over = size > ceiling;
  const short = found.length < atLeast;
  if (over || short) failed++;
  console.log(
    label.padEnd(56),
    String(found.length).padStart(6),
    format(size).padStart(12),
    format(ceiling).padStart(12),
    `  ${((1 - size / ceiling) * 100).toFixed(1)}%`.padStart(10),
    short
      ? `*** FAIL *** only ${found.length} file(s), expected at least ${atLeast} — the set moved and this row measured nothing`
      : over
        ? `*** FAIL *** ${size - ceiling} bytes over the ceiling`
        : 'within budget',
  );
  if (over) {
    for (const f of found.sort((a, b) => statSync(b).size - statSync(a).size).slice(0, 5)) {
      console.log(`      ${relative(APP_ROOT, f).replace(/\\/g, '/').padEnd(52)} ${format(statSync(f).size)}`);
    }
  }
}

console.log(
  failed
    ? `\n${failed} BUDGET(S) BLOWN — shrink the asset, or move the ceiling on purpose and say why`
    : '\nEVERY ASSET SET IS WITHIN BUDGET',
);
process.exit(failed ? 1 : 0);
