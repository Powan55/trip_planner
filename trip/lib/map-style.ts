// Map style + brand tokens for the real MapLibre GL map.
//
// PURE data/helper module — no maplibre-gl import, no side effects — so it is
// safe to import from anywhere and stays out of the dormant hot path. The GL
// canvas itself is mounted client-only by map-section.tsx.
//
// Basemap choice (free-keyless HARD RULE): CARTO "dark-matter" raster XYZ
// tiles. Genuinely free, NO API key required, dark by design — a clean fit for
// the navy/gold brand. Attribution (CARTO + OpenStreetMap) is legally required
// and is rendered via MapLibre's AttributionControl (see map-section.tsx).
//
//   Tiles:  https://{a-d}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png
//   Docs:   https://github.com/CartoDB/basemap-styles  (free basemaps, no token)
//
// REJECTED alternatives (need a key in production → free-only rule): Stadia,
// MapTiler, Mapbox. Raw tile.openstreetmap.org is also rejected (usage policy
// discourages app embedding + it is light, not dark).
//
// Brand-tune: a navy fill sits UNDER the raster (shows through tile gaps / while
// loading and warms the dark grey toward the app's navy), and the raster is
// drawn at slightly reduced opacity so it never fights the gold accents. Labels
// and land are already muted in dark-matter, so no extra label-layer overrides
// are needed for a raster source.

import type { MarkerCategory } from '@/lib/map-data';

// Brand hex, mirrored from tailwind.config.ts (navy/gold/himalaya/sakura). These
// are READ copies of the design tokens — the config is the source of truth; we do
// not write it. Kept here so GL paint properties (which take raw colors, not
// Tailwind classes) stay in one place.
export const BRAND = {
  navy900: '#0a0e27',
  navy800: '#111640',
  navy700: '#1a2050',
  gold400: '#f0c760',
  gold500: '#d4a843',
  sakura400: '#f7a0b3',
  himalaya500: '#e67635',
  white: '#ffffff',
} as const;

// Per-category marker fill, echoing CATEGORY_STYLES in map-section.tsx but as raw
// hex for the GL circle/symbol layers. Kept in sync with the Tailwind palette.
export const CATEGORY_COLOR: Record<MarkerCategory, string> = {
  Attraction: '#d4a843', // gold-500
  Restaurant: '#e67635', // himalaya-500
  Hotel: '#6366f1', // indigo-500
  'Photo Spot': '#a855f7', // purple-500
  'Day Trip': '#06b6d4', // cyan-500
  Shopping: '#e88fa2', // sakura-500
  Cultural: '#f59e0b', // amber-500
};

// CARTO dark-matter raster XYZ endpoints (subdomained a-d for throughput). Free,
// no key. Retina ({r}) omitted for a smaller, universally-served 256px tile.
export const CARTO_DARK_TILES = [
  'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
  'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
  'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
  'https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
];

export const MAP_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a>';

/**
 * Build the MapLibre StyleSpecification for the brand-tuned dark basemap.
 * Typed loosely (`any` at the boundary) so this module need not import
 * maplibre-gl's types onto the dormant path; map-section.tsx passes it straight
 * to `new maplibregl.Map({ style })`, which validates it at runtime.
 */
export function buildMapStyle(): Record<string, unknown> {
  return {
    version: 8,
    // Glyphs endpoint (free, keyless) for the symbol layers that render cluster
    // counts and numbered day markers. MapLibre's own demotiles font server
    // serves valid SDF glyph PBFs for the exact fonts we use ("Noto Sans
    // Regular"/"Noto Sans Bold"). NOTE: fonts.openmaptiles.org was rejected — it
    // returns an HTML page (text/html) for these font stacks, which MapLibre
    // parses as protobuf and throws "Unimplemented type: 4", silently breaking
    // every symbol layer (verified in headless). demotiles returns a real PBF
    // (application/octet-stream), so counts/numbers render and the error is gone.
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      'carto-dark': {
        type: 'raster',
        tiles: CARTO_DARK_TILES,
        tileSize: 256,
        attribution: MAP_ATTRIBUTION,
        maxzoom: 20,
      },
    },
    layers: [
      // Navy underlay — warms the basemap toward the brand and fills tile gaps.
      {
        id: 'brand-navy-underlay',
        type: 'background',
        paint: { 'background-color': BRAND.navy900 },
      },
      {
        id: 'carto-dark',
        type: 'raster',
        source: 'carto-dark',
        paint: {
          // Slightly translucent so the navy underlay tints it and the raster
          // never overpowers the gold accents / markers.
          'raster-opacity': 0.92,
          'raster-saturation': -0.15,
          'raster-contrast': 0.05,
        },
      },
    ],
  };
}
