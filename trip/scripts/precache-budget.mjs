#!/usr/bin/env node
// Byte budget for what the service worker actually precaches (issue #676).
//   npm run precache-budget     (or: node scripts/precache-budget.mjs)
//
// asset-budget.mjs measures the SOURCE tree, pre-build (see its header). This
// script measures the BUILT artifact instead: it reads out/sw.js (written by
// scripts/gen-sw.mjs), pulls the PRECACHE_URLS array back out, maps each URL to
// its file under out/, gzips each (the transfer size a real install pays), and
// sums it. Runs post-build, in CI right after the Build step.
//
// FAIL CLOSED: any of out/sw.js missing, the array not parsing, a URL with no
// file on disk, or the URL count dropping under a sanity floor all exit 1 —
// a check that silently measured nothing would be worse than no check.

import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(APP_ROOT, 'out');
const SW_PATH = join(OUT_DIR, 'sw.js');

// Measured baseline + ~15% headroom (CEILING, NOT A PIN — see asset-budget.mjs).
// Raise only with a reason; bring it down if a cleanup drops the real total.
const GZIP_BYTES_CEILING = 2_180_000; // measured baseline ~1,892,350 B + ~15%
const URL_COUNT_FLOOR = 10; // sanity check: a near-empty list means parsing broke

function fail(msg) {
  console.error(`precache-budget: FAIL — ${msg}`);
  process.exit(1);
}

if (!existsSync(SW_PATH)) fail(`${SW_PATH} not found — run \`npm run build\` first`);

const swSrc = readFileSync(SW_PATH, 'utf8');
const match = swSrc.match(/const PRECACHE_URLS = (\[[\s\S]*?\]);/);
if (!match) fail('PRECACHE_URLS array not found in out/sw.js');

let urls;
try {
  urls = JSON.parse(match[1]);
} catch (err) {
  fail(`PRECACHE_URLS did not parse as JSON: ${err.message}`);
}
if (!Array.isArray(urls) || urls.length < URL_COUNT_FLOOR) {
  fail(`only ${urls?.length ?? 0} precache URLs found, floor is ${URL_COUNT_FLOOR}`);
}

// Strip the basePath prefix (e.g. "/trip_planner") the CI build sets, same
// derivation gen-sw.mjs uses — every URL is basePath-prefixed exactly once.
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

let totalGzip = 0;
for (const url of urls) {
  let rel = BASE_PATH && url.startsWith(BASE_PATH) ? url.slice(BASE_PATH.length) : url;
  if (rel === '/' || rel === '') rel = '/index.html';
  else if (rel.endsWith('/')) rel = `${rel}index.html`;
  const filePath = join(OUT_DIR, rel);
  if (!existsSync(filePath)) fail(`precache URL ${url} has no file at ${filePath}`);
  totalGzip += gzipSync(readFileSync(filePath)).length;
}

console.log(`precache-budget: ${urls.length} URLs, ${totalGzip.toLocaleString()} bytes gzipped`);

if (totalGzip > GZIP_BYTES_CEILING) {
  fail(`precache gzip total ${totalGzip} exceeds ceiling ${GZIP_BYTES_CEILING}`);
}
