import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildMapStyle } from '@/lib/map-style';

/**
 * "The map says 'No API keys'" (owner report, blocks main).
 *
 * The map has no key branch to fix. D-079 (LOCKED) put the basemap on free keyless CARTO
 * raster tiles and D-319 moved the glyphs same-origin under `public/font/`, so there is no
 * provider account, no `NEXT_PUBLIC_*` map key, and no keyed/unkeyed state the UI could
 * report. What the owner read was OUR OWN marketing copy: `components/landing-page.tsx`
 * printed the words "no API key" on the annunciator row whose left column says "Map".
 *
 * So this file pins the two halves of that:
 *
 *   1. The style is keyless with a key present AND absent — i.e. no env var can ever put
 *      the map into a keyed mode, which is what makes CI, local builds and production
 *      identical and is why no secret is required.
 *   2. The landing page carries no "API key" vocabulary in anything a stranger reads.
 *      Comments are stripped first: the source legitimately DISCUSSES keylessness.
 */

const landingSrc = readFileSync(resolve(__dirname, '../../components/landing-page.tsx'), 'utf8');

/** Every URL-shaped string the style hands to MapLibre: tile endpoints + the glyph template. */
function styleUrls(): string[] {
  const style = buildMapStyle();
  const sources = style.sources as Record<string, { tiles?: string[] }>;
  return [
    style.glyphs as string,
    ...Object.values(sources).flatMap((s) => s.tiles ?? []),
  ];
}

/** `key=`, `apikey=`, `access_token=`, a bare `{key}` placeholder — any shape of credential. */
const CREDENTIAL = /[?&](api_?key|key|token|access_token|apikey)=|\{key\}|<your[_ -]?key>/i;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('the map is keyless in both directions', () => {
  it('carries no credential in any tile or glyph URL (the key-ABSENT case: CI, local, prod)', () => {
    const urls = styleUrls();
    expect(urls.length).toBeGreaterThan(0); // positive control: the instrument sees the URLs
    for (const url of urls) expect(url).not.toMatch(CREDENTIAL);
  });

  it('ignores a map key in the environment (the key-PRESENT case: no keyed mode exists)', async () => {
    const withoutKey = JSON.stringify(buildMapStyle());

    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_MAP_KEY', 'pk.should-be-ignored');
    vi.stubEnv('NEXT_PUBLIC_MAPTILER_KEY', 'pk.should-be-ignored');
    vi.stubEnv('NEXT_PUBLIC_MAPBOX_TOKEN', 'pk.should-be-ignored');
    const { buildMapStyle: rebuilt } = await import('@/lib/map-style');

    // Byte-identical with a key present => the map cannot branch on one => no secret to add,
    // and no "key missing" state to render.
    expect(JSON.stringify(rebuilt())).toBe(withoutKey);
  });

  it('reaches no keyed provider host', () => {
    for (const url of styleUrls()) {
      expect(url).not.toMatch(/maptiler|mapbox|stadiamaps|thunderforest|geoapify/i);
    }
  });
});

describe('the landing page speaks to a stranger, not to a developer', () => {
  it('prints no "API key" vocabulary in any user-facing string', () => {
    const code = landingSrc
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments, incl. the {/* JSX */} ones
      .replace(/^\s*\/\/.*$/gm, ''); // line comments
    expect(code).toContain('const ONBOARD'); // positive control: stripping left the code
    expect(code.split('\n').filter((line) => /api[ _-]?key/i.test(line))).toEqual([]);
  });

  it('still states the Map row, with a reading a traveller understands', () => {
    const row = landingSrc.split('\n').find((line) => line.includes("name: 'Map',"));
    expect(row).toMatch(/unit: 'street map'/);
  });
});
