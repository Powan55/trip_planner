// Map style + brand tokens for the real MapLibre GL map.
//
// PURE data/helper module — no maplibre-gl import, no side effects — so it is
// safe to import from anywhere and stays out of the dormant hot path. The GL
// canvas itself is mounted client-only by map-section.tsx.
//
// Basemap: OpenFreeMap vector tiles (OpenMapTiles schema), keyless and free, with
// our own trimmed dark layer set below (D-606). CARTO's raster tiles now need a
// key. The OpenFreeMap style JSON is not fetched at runtime: sprite-dependent
// layers are dropped, and labels read `name:latin` only so MapLibre never asks
// for a glyph range we do not self-host (Devanagari, kana, ...).

import type { MarkerCategory } from '@/lib/map-data';
// The single basePath source (lib/utils.ts). Pure — no React, no browser API, no
// 'use client' — so importing it keeps this module safe to import from anywhere.
import { withBasePath } from '@/lib/utils';

// Brand hex, mirrored from tailwind.config.ts / globals.css. These are READ copies
// of the token layer — the config is the source of truth; we do not write it. Kept
// here so GL paint properties (which take raw colors, not Tailwind classes) stay in
// one place.
//
// THE RULE FOR THIS OBJECT, because it is now deliberately half-swept:
//   · SURFACES FOLLOW THE CANVAS. navy900 (the map's own background layer, the label
//     halo, and the approx-marker fill/stroke) and navy800 (the popup and tooltip
//     chrome) are re-valued with the rest of the app every time the ramp moves; leaving
//     them behind frames the map in the retired palette. navy800 was once still
//     '#111640' — a leftover from the blue field two palettes ago, older than the
//     charcoal it outlived. navy700 is NOT re-valued because it has zero consumers;
//     it is stale, harmless, and deletable by whoever next touches this object.
//     Measured, since two of these are contrast pairs, at the re-cast ramp: gold400 on
//     navy900 12.09 -> 12.30, white on the navy800 popup 16.45 -> 16.38, navy900 ink on
//     a gold500 pin 8.79 -> 8.94. All three stay far above AA.
//   · BRAND HUES ARE FROZEN. gold400/gold500/sakura400/himalaya500 are the map's own
//     identity colours — route line, stop stroke, label halo, marker stroke, and the
//     CATEGORY_COLOR pins below. They stay at the retired values until /map's palette
//     is designed. D-292 is where that is open: it asserted /map into a tier without
//     designing the route, so choosing new pin and route hues is that slice's call,
//     not a token slice's. Moving one of these without the others is what produces a
//     map whose line disagrees with its own legend.
//
//     D-334 is why that slice got easier rather than harder. While marigold was the
//     interaction accent, THREE of the seven CATEGORY_COLOR pins collided with it —
//     `Attraction` at 0.0 degrees of hue separation, `Cultural` at 4.1, `Restaurant`
//     at 19.7 — so a pin and "this is pressable" were the same signal. The chrome
//     accent is now volt (hue 192) and the closest of the seven is `Hotel` at 46.7,
//     which clears the >= 30 degree rule with room. That rule is enforced for EVERY
//     category by lib/__tests__/map-category-mirror.test.ts, which now reads the live
//     accent out of globals.css instead of the hardcoded 189 that let the collision
//     through. So the freeze is no longer hiding a defect — it is just an unfinished
//     palette.
export const BRAND = {
  navy900: '#0A0818',
  navy800: '#1C1948',
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
  'Day Trip': '#22c55e', // green-500
  Shopping: '#e88fa2', // sakura-500
  Cultural: '#f59e0b', // amber-500
};

// TileJSON, not an inlined tile URL: OpenFreeMap rotates its dated planet build
// weekly and the TileJSON is the documented way to find the current one.
export const OPENFREEMAP_TILEJSON = 'https://tiles.openfreemap.org/planet';

export const MAP_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">© OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>';

const GROUND = {
  water: '#04030c',
  park: '#0f0d20',
  building: '#13112a',
  roadMinor: '#1b1930',
  roadMajor: '#27253d',
  motorway: '#333049',
  rail: '#211f36',
  border: '#3a3752',
  borderState: '#28263c',
  label: '#7d7a93',
  labelDim: '#5d5a73',
} as const;

const LATIN_NAME = ['get', 'name:latin'];
const LABEL_PAINT = {
  'text-color': GROUND.label,
  'text-halo-color': BRAND.navy900,
  'text-halo-width': 1.2,
};

function roadLayer(id: string, classes: string[], color: string, minzoom: number, widths: number[]) {
  return {
    id,
    type: 'line',
    source: 'openfreemap',
    'source-layer': 'transportation',
    minzoom,
    filter: [
      'all',
      ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
      ['match', ['get', 'class'], classes, true, false],
      ['!=', ['get', 'brunnel'], 'tunnel'],
    ],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': color, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], ...widths] },
  };
}

/**
 * Build the MapLibre StyleSpecification for the brand-tuned dark basemap.
 * Typed loosely (`any` at the boundary) so this module need not import
 * maplibre-gl's types onto the dormant path; map-section.tsx passes it straight
 * to `new maplibregl.Map({ style })`, which validates it at runtime.
 */
export function buildMapStyle(): Record<string, unknown> {
  return {
    version: 8,
    // Glyphs endpoint for every symbol layer: cluster counts, numbered day
    // markers and the basemap labels. SELF-HOSTED under public/font/ — the PBFs
    // are ours, served same-origin, no third-party host on the runtime path.
    //
    // Ranges on disk: 0-255 for both stacks (the pin labels are numeric), plus
    // 256-511, 7680-7935 and 8192-8447 for "Noto Sans Regular", the ranges the
    // basemap's `name:latin` labels were seen to request across Nepal, Japan and
    // the default view (macrons, Vietnamese letters, curly apostrophes). A rarer
    // codepoint falls back to MapLibre's local drawing after a 404; the tile
    // still renders.
    //
    // The byte count decided it, but the stronger reason is an OFFLINE DEFECT the
    // old cross-origin URL had: the service worker's fetch handler returns
    // cross-origin requests untouched as its FIRST line (scripts/gen-sw.mjs), so
    // demotiles glyphs were never cacheable and the numbered day markers rendered
    // BLANK offline. Same-origin PBFs are precached with the rest of the shell,
    // so labels now survive the offline state the app promises.
    //
    // Historical, so it is not re-litigated: demotiles was chosen over
    // fonts.openmaptiles.org, which returns an HTML page (text/html) for these
    // stacks — MapLibre parses it as protobuf and throws "Unimplemented type: 4",
    // silently breaking every symbol layer. Both are moot now.
    //
    // PATH SHAPE: MapLibre substitutes the fontstack into the template RAW
    // (`url.replace('{fontstack}', stack)`, no encodeURIComponent), so the
    // directory on disk carries literal spaces — public/font/Noto Sans Bold/
    // 0-255.pbf — and the browser percent-encodes the space on the wire. The
    // basePath prefix is mandatory: this deploys to GitHub Pages under a subpath,
    // where a bare '/font/...' 404s.
    glyphs: withBasePath('/font/{fontstack}/{range}.pbf'),
    sources: {
      openfreemap: {
        type: 'vector',
        url: OPENFREEMAP_TILEJSON,
        attribution: MAP_ATTRIBUTION,
      },
    },
    layers: [
      // The ground, and all that shows offline or before the first tile lands.
      {
        id: 'brand-navy-underlay',
        type: 'background',
        paint: { 'background-color': BRAND.navy900 },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'openfreemap',
        'source-layer': 'water',
        filter: ['!=', ['get', 'brunnel'], 'tunnel'],
        paint: { 'fill-color': GROUND.water, 'fill-antialias': false },
      },
      {
        id: 'waterway',
        type: 'line',
        source: 'openfreemap',
        'source-layer': 'waterway',
        minzoom: 8,
        paint: { 'line-color': GROUND.water, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 14, 2] },
      },
      {
        id: 'park',
        type: 'fill',
        source: 'openfreemap',
        'source-layer': 'landuse',
        filter: ['==', ['get', 'class'], 'park'],
        paint: { 'fill-color': GROUND.park },
      },
      {
        id: 'building',
        type: 'fill',
        source: 'openfreemap',
        'source-layer': 'building',
        minzoom: 13,
        paint: { 'fill-color': GROUND.building, 'fill-opacity': 0.7 },
      },
      roadLayer('road-minor', ['minor', 'service'], GROUND.roadMinor, 12, [12, 0.5, 17, 6]),
      roadLayer('road-major', ['primary', 'secondary', 'tertiary', 'trunk'], GROUND.roadMajor, 7, [7, 0.4, 12, 1.5, 17, 10]),
      roadLayer('road-motorway', ['motorway'], GROUND.motorway, 5, [5, 0.4, 12, 2, 17, 12]),
      roadLayer('rail', ['rail', 'transit'], GROUND.rail, 10, [10, 0.5, 17, 2]),
      {
        id: 'boundary-state',
        type: 'line',
        source: 'openfreemap',
        'source-layer': 'boundary',
        minzoom: 4,
        filter: ['all', ['==', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
        paint: { 'line-color': GROUND.borderState, 'line-dasharray': [2, 2], 'line-width': 0.8 },
      },
      {
        id: 'boundary-country',
        type: 'line',
        source: 'openfreemap',
        'source-layer': 'boundary',
        filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
        paint: { 'line-color': GROUND.border, 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.6, 10, 1.5] },
      },
      {
        id: 'road-label',
        type: 'symbol',
        source: 'openfreemap',
        'source-layer': 'transportation_name',
        minzoom: 13,
        layout: {
          'symbol-placement': 'line',
          'text-field': LATIN_NAME,
          'text-font': ['Noto Sans Regular'],
          'text-size': 10,
        },
        paint: { ...LABEL_PAINT, 'text-color': GROUND.labelDim },
      },
      {
        id: 'place-minor-label',
        type: 'symbol',
        source: 'openfreemap',
        'source-layer': 'place',
        minzoom: 11,
        filter: ['match', ['get', 'class'], ['village', 'suburb', 'neighbourhood', 'quarter', 'hamlet'], true, false],
        layout: { 'text-field': LATIN_NAME, 'text-font': ['Noto Sans Regular'], 'text-size': 10 },
        paint: { ...LABEL_PAINT, 'text-color': GROUND.labelDim },
      },
      {
        id: 'place-label',
        type: 'symbol',
        source: 'openfreemap',
        'source-layer': 'place',
        filter: ['match', ['get', 'class'], ['city', 'town'], true, false],
        layout: {
          'text-field': LATIN_NAME,
          'text-font': ['Noto Sans Regular'],
          'text-size': ['match', ['get', 'class'], 'city', 13, 11],
          'symbol-sort-key': ['get', 'rank'],
        },
        paint: LABEL_PAINT,
      },
      {
        id: 'country-label',
        type: 'symbol',
        source: 'openfreemap',
        'source-layer': 'place',
        maxzoom: 7,
        filter: ['==', ['get', 'class'], 'country'],
        layout: {
          'text-field': LATIN_NAME,
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.1,
        },
        paint: LABEL_PAINT,
      },
    ],
  };
}
