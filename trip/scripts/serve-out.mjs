#!/usr/bin/env node
/**
 * Zero-dependency static file server for `nextjs_space/out/` ().
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
 */
function resolveFile(pathname) {
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
 // eslint-disable-next-line no-console
 console.log(`serve-out: serving ${OUT_DIR} at http://localhost:${PORT}`);
});
