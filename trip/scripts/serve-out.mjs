#!/usr/bin/env node
/**
 * Zero-dependency static file server for `trip/out/`.
 *
 * Serves the EXACT static-export artifact (`next build`, `output:'export'` +
 * `trailingSlash:true`) that deploys to GitHub Pages — the Playwright E2E harness
 * points at this, never `next dev` (standing QA-harness rule, memory
 * `headless-qa-env`). Built with only Node core modules (`http`/`fs`/`path`) —
 * no new runtime dependency, per (free-tools-only) and the project's
 * dependency-diet ethos.
 *
 * Route -> file mapping (mirrors trailingSlash:true's on-disk layout):
 * / -> out/index.html
 * /plan/ -> out/plan/index.html
 * /nepal/ -> out/nepal/index.html
 * /japan/ -> out/japan/index.html
 * /map/ -> out/map/index.html
 * /_next/... -> out/_next/... (literal asset file, exact path)
 * /images/... -> out/images/... (literal asset file, exact path)
 * anything else with a matching literal file -> served as-is
 * anything else -> 404
 *
 * Port: `--port <n>` CLI flag, or `PORT` env var, default 4173 (Vite's own
 * preview-server convention; arbitrary but avoids the common 3000/5173 clashes).
 *
 * No directory listing, no SPA-style catch-all-to-index fallback (this is a
 * multi-page static export, not a client-router SPA) — an unknown path is a
 * genuine 404, matching what GitHub Pages would actually do.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'out');

function parsePort() {
  const flagIdx = process.argv.indexOf('--port');
  if (flagIdx !== -1 && process.argv[flagIdx + 1]) {
    const fromFlag = Number(process.argv[flagIdx + 1]);
    if (Number.isFinite(fromFlag) && fromFlag > 0) return fromFlag;
  }
  const fromEnv = Number(process.env.PORT);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return 4173;
}

const PORT = parsePort();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json; charset=utf-8',
};

function contentTypeFor(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

/**
 * Resolve a URL pathname to an on-disk file under OUT_DIR, mirroring
 * trailingSlash:true's export layout. Returns null if nothing matches (404).
 *
 * Costs up to 3 candidates x 2 SYNC disk ops (`existsSync` + `statSync`). Call
 * `resolveFile` below — the memoized entry point — rather than this directly.
 */
function resolveUncached(pathname) {
  // Strip query/hash (http.request URLs already exclude these, but be safe).
  const decoded = decodeURIComponent(pathname.split('?')[0].split('#')[0]);

  // Guard against path traversal — resolve then confirm containment in OUT_DIR.
  const safeRelative = path.normalize(decoded).replace(/^([./\\])+/, '');
  const candidates = [];

  if (decoded === '/' || decoded === '') {
    candidates.push(path.join(OUT_DIR, 'index.html'));
  } else if (decoded.endsWith('/')) {
    // Directory route (trailingSlash:true) -> <dir>/index.html
    candidates.push(path.join(OUT_DIR, safeRelative, 'index.html'));
  } else {
    // Literal asset file first (e.g. /_next/static/..., /images/foo.png, /sw.js).
    candidates.push(path.join(OUT_DIR, safeRelative));
    // Fall back to treating it as a route missing its trailing slash
    // (e.g. someone requests "/plan" instead of "/plan/").
    candidates.push(path.join(OUT_DIR, safeRelative, 'index.html'));
    candidates.push(path.join(OUT_DIR, `${safeRelative}.html`));
  }

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (!resolved.startsWith(OUT_DIR)) continue; // traversal guard
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      return resolved;
    }
  }
  return null;
}

/**
 * URL -> resolved-path memo, and the entry point the request handler calls.
 *
 * Correct by `out/`'s own lifecycle: it is a FINISHED build artifact, served
 * read-only for the whole life of this process (the harness runs `npm run
 * build` first, then starts this server), so a URL's resolution — the file path
 * OR the `null` that means 404 — cannot change under us. `null` is memoized
 * too; a 404 otherwise re-pays the full 6 sync stats on every repeat.
 *
 * Why it is worth memoizing: `resolveUncached` runs SYNCHRONOUSLY inside the
 * request handler, so every miss head-of-line-blocks Node's single event loop
 * on disk. One page load is an HTML request plus dozens of chunk requests, and
 * the E2E specs set `serviceWorkers: 'block'`, so no cache absorbs the repeats.
 *
 * unbounded Map. Fine for a local harness serving a fixed URL set —
 * add an LRU cap only if this ever faces a client that can invent URLs.
 */
const resolveCache = new Map();

function resolveFile(pathname) {
  if (resolveCache.has(pathname)) return resolveCache.get(pathname);
  const resolved = resolveUncached(pathname);
  resolveCache.set(pathname, resolved);
  return resolved;
}

const server = http.createServer((req, res) => {
  const file = resolveFile(req.url || '/');

  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  res.writeHead(200, { 'Content-Type': contentTypeFor(file) });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => {
  console.log(`serve-out: serving ${OUT_DIR} at http://localhost:${PORT}`);
});
