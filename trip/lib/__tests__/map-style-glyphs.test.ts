import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildMapStyle } from '@/lib/map-style';

/**
 * Issue #8 — the map's SDF glyphs are SELF-HOSTED, and the wiring that makes that
 * true is spread over four files that can drift apart silently:
 *
 *   lib/map-style.ts        the `glyphs` URL template (must be same-origin + basePath'd)
 *   components/trip-map.tsx the `text-font` stacks MapLibre substitutes into it
 *   public/font/**          the PBFs that must sit at exactly the resulting path
 *   scripts/gen-sw.mjs      the precache list — which must NOT carry them (V6-14, below)
 *
 * Every failure mode here is SILENT at runtime: a wrong directory name, a missing
 * range file or an external host that is merely unreachable all render as markers
 * with no number on them, with no error the app surfaces. So the checks below
 * derive the on-disk path from the template + the real `text-font` values rather
 * than restating either.
 */

const publicFontDir = resolve(__dirname, '../../public/font');
const tripMapSrc = readFileSync(resolve(__dirname, '../../components/trip-map.tsx'), 'utf8');
const genSwSrc = readFileSync(resolve(__dirname, '../../scripts/gen-sw.mjs'), 'utf8');

/**
 * The fontstacks MapLibre can actually request, read out of the GL symbol layers.
 * `'text-font': ['Noto Sans Bold']` -> `Noto Sans Bold`. MapLibre keys a stack by
 * the joined font list, so a multi-font stack would need its own comma-named
 * directory — this returns the joined form so such a change fails loudly below
 * rather than 404ing in production.
 */
function fontStacksFromSource(): string[] {
  const out = new Set<string>();
  for (const m of tripMapSrc.matchAll(/'text-font':\s*\[([^\]]+)\]/g)) {
    out.add(
      [...m[1].matchAll(/'([^']+)'/g)].map((f) => f[1]).join(','),
    );
  }
  return [...out];
}

// MapLibre requests range N as `${N*256}-${N*256+255}`. Both label fields are
// numeric (cluster counts, day numbers), so range 0 is the only one it can ask
// for — see the comment block in lib/map-style.ts.
const RANGE = '0-255';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('map glyphs — self-hosted, never a third-party host', () => {
  it('the glyphs template is same-origin and root-relative', () => {
    const glyphs = buildMapStyle().glyphs as string;
    expect(glyphs).not.toMatch(/^[a-z]+:\/\//i); // no scheme => no external host
    expect(glyphs).not.toContain('demotiles.maplibre.org');
    expect(glyphs).not.toContain('openmaptiles');
    expect(glyphs).not.toContain('//');
    expect(glyphs.startsWith('/')).toBe(true);
  });

  it('keeps both MapLibre tokens (a template missing one fails style validation)', () => {
    const glyphs = buildMapStyle().glyphs as string;
    expect(glyphs).toContain('{fontstack}');
    expect(glyphs).toContain('{range}');
  });

  it('honours NEXT_PUBLIC_BASE_PATH — a bare /font/... 404s on the project page', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/trip_planner');
    const { buildMapStyle: rebuilt } = await import('@/lib/map-style');
    expect(rebuilt().glyphs).toBe('/trip_planner/font/{fontstack}/{range}.pbf');
  });
});

describe('map glyphs — the PBFs sit where MapLibre will ask for them', () => {
  const stacks = fontStacksFromSource();

  // Fails CLOSED: if the layers are ever reformatted past the regex this trips,
  // rather than the suite passing having asserted nothing.
  it('parses the text-font stacks out of the GL symbol layers', () => {
    expect(stacks).toEqual(['Noto Sans Regular', 'Noto Sans Bold']);
  });

  it('public/font holds exactly the stacks the map requests — no orphans, no gaps', () => {
    expect(readdirSync(publicFontDir).sort()).toEqual([...stacks].sort());
  });

  it.each(fontStacksFromSource())(
    '%s: the file exists at the path the template resolves to, and is that stack',
    (stack) => {
      const template = buildMapStyle().glyphs as string;
      const rel = template.replace('{fontstack}', stack).replace('{range}', RANGE);
      const bytes = readFileSync(resolve(__dirname, '../../public', rel.replace(/^\//, '')));
      // A real glyph PBF, not an HTML error page or an empty placeholder.
      expect(bytes.byteLength).toBeGreaterThan(50_000);
      // fontstack.name is the first string field in the protobuf, so a swapped
      // Regular/Bold file (identical size class, silently wrong weight on the
      // map) shows up right here.
      expect(bytes.subarray(0, 64).toString('latin1')).toContain(stack);
    },
  );
});

describe('map glyphs — RUNTIME-cached, never precached (V6-14)', () => {
  /**
   * 🔴 THIS INVARIANT IS INVERTED FROM WHAT IT ONCE WAS, deliberately — the old shape
   * ("gen-sw.mjs adds font/** to the precache list") is worth knowing so nobody restores it.
   *
   * V6-14 took the glyph PBFs BACK OUT of the install list: 154 KiB (~87 KB gzip) on EVERY
   * install, for `/map` — the one route D-274 already declines to promise offline. The
   * maplibre engine that consumes them is withheld for the same reason.
   *
   * What issue #8 actually bought is untouched and is what makes the runtime path possible
   * at all: while the glyphs were CROSS-ORIGIN the SW's first fetch-handler line returned
   * them untouched and nothing could ever cache them. Self-hosted, they are same-origin
   * non-image GETs, so they fall to the static cacheFirst branch and land in the precache on
   * the first ONLINE map visit. The named cost: labels are blank on a COLD-offline first
   * open of /map. Everything above this describe — same-origin template, basePath, the PBFs
   * sitting at the resolved path — is what that runtime path depends on, so it all stands.
   */
  it('gen-sw.mjs does NOT add font/** to the precache list', () => {
    // Deliberately keyed to `startsWith('font/` and NOT to the full branch shape: the exact
    // form `else if (rel.startsWith('font/')) set.add(rel);` is only one way to put the
    // glyphs back. Braces, or an `&&`, would re-add them under a green test. There are zero
    // hits for this substring in gen-sw.mjs today, so the stronger form is free.
    expect(genSwSrc).not.toMatch(/startsWith\('font\//);
  });

  it('…and the branch shape that negative is written against is still the one gen-sw uses', () => {
    // ANTI-VACUITY. A bare `not.toMatch` passes for the wrong reason the moment
    // buildPrecacheList is reformatted past the pattern — font/** would be back in every
    // install under a green test. `icons/` is the sibling branch, precached on purpose and
    // written in the identical shape, so it proves the pattern still has a subject to match.
    expect(genSwSrc).toMatch(/rel\.startsWith\('icons\/'\)\)\s*set\.add\(rel\)/);
  });
});
