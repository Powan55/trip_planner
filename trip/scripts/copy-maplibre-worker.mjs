// maplibre-gl 6 loads its worker from a URL instead of a blob, so the worker and the
// chunk it imports have to be served from public/. See setWorkerUrl in trip-map.tsx.
//
// Issue #503 — versioned under the installed maplibre-gl's own version so a
// maplibre-only bump (no other precached file changing) can't run the new engine
// against a stale cached worker: the URL itself changes, so cache-first can't
// serve the old bytes. Old version dirs are removed so a stale worker never ships
// alongside the new one.
import { copyFileSync, mkdirSync, readdirSync, rmSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { version } = JSON.parse(
  readFileSync(fileURLToPath(new URL('../node_modules/maplibre-gl/package.json', import.meta.url)), 'utf8'),
);

const from = fileURLToPath(new URL('../node_modules/maplibre-gl/dist/', import.meta.url));
const root = fileURLToPath(new URL('../public/maplibre/', import.meta.url));
const to = root + version + '/';

mkdirSync(root, { recursive: true });
for (const entry of readdirSync(root, { withFileTypes: true })) {
  // Old sibling version dirs AND loose files from the pre-#503 flat layout
  // (public/maplibre/*.mjs directly) — anything that isn't the current version dir.
  if (entry.name !== version) {
    rmSync(root + entry.name, { recursive: true, force: true });
  }
}

mkdirSync(to, { recursive: true });
for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  copyFileSync(from + file, to + file);
}
