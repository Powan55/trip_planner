#!/usr/bin/env node
/**
 * Post-export fixup for Next 16's segment-prefetch payloads. Runs between
 * `next build --webpack` and `scripts/gen-sw.mjs` (see package.json "build").
 *
 * THE DEFECT (next@16.3.2, `output: 'export'`). Next 16 replaced the old
 * whole-route RSC prefetch with a per-segment cache, and the exporter writes one
 * payload file per segment under each route directory. For a route whose segment
 * path is a single name it writes a flat file and everything lines up:
 *
 *     out/__next.__PAGE__.txt          <- the "/" page segment, requested as
 *                                         /__next.__PAGE__.txt          200
 *
 * For every other route the segment path is two names deep ("plan" then
 * "__PAGE__"), and there the exporter writes a DIRECTORY where the client
 * expects a dot-joined filename:
 *
 *     out/plan/__next.plan/__PAGE__.txt   <- what the export writes
 *     /plan/__next.plan.__PAGE__.txt      <- what the router actually requests
 *
 * No static host can bridge that, so every `<Link>` that scrolls into view
 * prefetches a 404. Measured on the built artifact: 4 x
 * "Failed to load resource: the server responded with a status of 404" on the
 * home route alone, and 27 e2e specs fail purely on their zero-console-errors
 * assertion. Navigation itself still works — the router falls back to the
 * whole-route payload — so this is console noise plus a dead prefetch, not a
 * broken app. It is still a hard blocker here because console-clean is an
 * acceptance criterion, and a 404 on every page of a deployed site is not
 * something to ship knowingly.
 *
 * THE FIX. Copy each nested payload up to the dot-joined name the router asks
 * for. Verified against a served `out/`: before, 4 x 404 on "/" and the
 * prefetch never lands; after, zero 4xx and navigation is still a soft nav.
 *
 * DELETE THIS FILE when a Next release writes the flat name itself. It is a
 * no-op the moment the `__next.*` directories stop appearing, so a fixed Next
 * needs no coordination — but it also stops being free to keep, because a
 * silent no-op is indistinguishable from a scheme change. The throws below are
 * what makes that distinguishable: any shape this has not seen is loud.
 */

import { readdir, copyFile, access } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'out');

const SEGMENT_DIR_PREFIX = '__next.';

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Flatten one `__next.<segment>/` directory into sibling `__next.<segment>.<file>` files. */
async function flattenDir(parent, dirName) {
  const dir = join(parent, dirName);
  const entries = await readdir(dir, { withFileTypes: true });
  let copied = 0;

  for (const entry of entries) {
    if (!entry.isFile()) {
      // Two levels of nesting would need a different join than the one measured.
      // Guessing at it would ship prefetches that 404 exactly as they do today,
      // under a green build.
      throw new Error(
        `flatten-segment-payloads: ${relative(OUT_DIR, join(dir, entry.name))} is not a file. ` +
          'Next\'s segment-payload layout is deeper than this script has seen — re-derive the ' +
          'URL scheme from a served build before shipping.'
      );
    }
    const target = join(parent, `${dirName}.${entry.name}`);
    if (await exists(target)) {
      throw new Error(
        `flatten-segment-payloads: ${relative(OUT_DIR, target)} already exists, so the export is ` +
          'writing both shapes. Next may have fixed this upstream — confirm which one the router ' +
          'requests, then delete this script rather than letting it pick.'
      );
    }
    await copyFile(join(dir, entry.name), target);
    copied += 1;
  }
  return copied;
}

async function walk(dir) {
  let copied = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(SEGMENT_DIR_PREFIX)) {
      copied += await flattenDir(dir, entry.name);
    } else {
      copied += await walk(join(dir, entry.name));
    }
  }
  return copied;
}

if (!(await exists(OUT_DIR))) {
  throw new Error(`flatten-segment-payloads: out/ not found at ${OUT_DIR}. Run \`next build\` first.`);
}

const copied = await walk(OUT_DIR);
console.log(
  copied === 0
    ? 'flatten-segment-payloads: no __next.* segment directories — Next may have fixed this; see the header before deleting.'
    : `flatten-segment-payloads: wrote ${copied} flat segment payload(s) next to their nested originals`
);
