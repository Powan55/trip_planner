// maplibre-gl 6 loads its worker from a URL instead of a blob, so the worker and the
// chunk it imports have to be served from public/. See setWorkerUrl in trip-map.tsx.
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const from = fileURLToPath(new URL('../node_modules/maplibre-gl/dist/', import.meta.url));
const to = fileURLToPath(new URL('../public/maplibre/', import.meta.url));

mkdirSync(to, { recursive: true });
for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  copyFileSync(from + file, to + file);
}
