import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import colors from 'tailwindcss/colors';
import { CATEGORY_COLOR } from '@/lib/map-style';
import tailwindConfig from '@/tailwind.config';

/**
 * S353C — the map category palette is a HAND-SYNCED MIRROR with no compiler tie:
 *
 *   lib/map-style.ts      CATEGORY_COLOR   raw hex  -> the maplibre GL circle/symbol paint layers
 *   components/trip-map.tsx CATEGORY_STYLES Tailwind -> the DOM pin + filter chip + legend badge
 *
 * Change one side only and the map's markers disagree with its own chips — and until this
 * file existed, nothing in the suite noticed. (S353C moved `Day Trip` cyan -> green because
 * cyan-500 is hsl(189), the same hue as the interactive `--ring`/`--primary` signal.)
 *
 * This asserts the mirror in the direction that actually catches drift: the Tailwind FAMILY is
 * read out of the component source, its real hex is resolved from the Tailwind palette/config
 * (never hardcoded here), and that hex must equal the GL layer's. So it fails if either side
 * moves, AND if a family is paired with a hex that was hand-typed slightly wrong.
 */

const tripMapSrc = readFileSync(
  resolve(__dirname, '../../components/trip-map.tsx'),
  'utf8',
);

const globalsCss = readFileSync(resolve(__dirname, '../../app/globals.css'), 'utf8');

/**
 * The LIVE chrome accent, read out of `app/globals.css` rather than hardcoded.
 *
 * D-334. The hue check below used to compare against a literal `189` — the cyan that was
 * the interaction signal when the guard was written. Two accent changes later that number
 * described nothing, so the guard PASSED THROUGH a real three-way collision: against the
 * live marigold, `Attraction` sat 0.0 degrees away, `Cultural` 4.1 and `Restaurant` 19.7.
 * A guard whose reference value is a copy is a guard that stops being about the thing it
 * names, so it reads the token instead.
 *
 * `--primary`, `--accent`, `--ring` and `--accent-scroll` are ONE accent expressed four
 * times (globals.css says so twice, at length, because moving a subset is the recurring
 * mistake). They are all parsed and asserted equal, which makes THAT a test too.
 */
const ACCENT_TOKENS = ['--primary', '--accent', '--ring', '--accent-scroll'] as const;

function accentHslFromCss(token: string): string {
  // Matches a declaration carrying a real HSL triplet, never the prose in the comments.
  const m = globalsCss.match(new RegExp(`${token}:\\s*(\\d+ \\d+% \\d+%)\\s*;`));
  if (!m) throw new Error(`no HSL triplet declared for ${token} in app/globals.css`);
  return m[1];
}

/** hue of a hex, 0-360 */
function hueOf(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let hue = 0;
  if (d !== 0) {
    if (max === r) hue = 60 * (((g - b) / d) % 6);
    else if (max === g) hue = 60 * ((b - r) / d + 2);
    else hue = 60 * ((r - g) / d + 4);
  }
  return hue < 0 ? hue + 360 : hue;
}

/** shortest angular distance between two hues, 0-180 */
const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/** `'Day Trip': { icon: Bus, pin: 'bg-green-500 text-surface', ... }` -> ['Day Trip', 'green'] */
function pinFamiliesFromSource(): Map<string, string> {
  const out = new Map<string, string>();
  const re = /'?([A-Za-z ]+)'?:\s*\{\s*icon:[^}]*?pin:\s*'bg-([a-z]+)-500/g;
  for (const m of tripMapSrc.matchAll(re)) out.set(m[1].trim(), m[2]);
  return out;
}

/** Resolve `green` -> '#22c55e' from the real palette: brand scales first, then Tailwind's. */
function hexForFamily(family: string): string {
  const brand = (tailwindConfig.theme?.extend?.colors ?? {}) as Record<
    string,
    Record<string, string> | string
  >;
  const brandScale = brand[family];
  if (brandScale && typeof brandScale === 'object' && brandScale['500']) return brandScale['500'];
  const stock = (colors as unknown as Record<string, Record<string, string>>)[family];
  if (stock?.['500']) return stock['500'];
  throw new Error(`no 500 step found for Tailwind family "${family}"`);
}

describe('map category palette — GL hex vs DOM Tailwind class', () => {
  const families = pinFamiliesFromSource();
  const categories = Object.keys(CATEGORY_COLOR);

  // Fails CLOSED: if CATEGORY_STYLES is ever reformatted past the regex, this trips rather
  // than letting the suite pass having silently asserted nothing.
  it('parses a pin class for every category in CATEGORY_COLOR', () => {
    expect(categories).toHaveLength(7);
    expect([...families.keys()].sort()).toEqual([...categories].sort());
  });

  it.each(Object.keys(CATEGORY_COLOR))(
    '%s: the GL hex equals the 500 step of the DOM pin family',
    (category) => {
      const family = families.get(category);
      expect(family, `no pin class parsed for ${category}`).toBeTruthy();
      expect(CATEGORY_COLOR[category as keyof typeof CATEGORY_COLOR].toLowerCase()).toBe(
        hexForFamily(family!).toLowerCase(),
      );
    },
  );

  // The four names are one accent. If this fails, somebody moved a subset of them and the
  // chrome is now painting two colours — see the --accent-scroll block in globals.css.
  it('the four chrome-accent tokens are one value', () => {
    const values = ACCENT_TOKENS.map(accentHslFromCss);
    expect(new Set(values).size, `chrome accent disagrees: ${values.join(' | ')}`).toBe(1);
  });

  it.each(Object.keys(CATEGORY_COLOR))(
    '%s sits >= 30 deg off the LIVE interaction accent (S353C/Ruling-3)',
    (category) => {
      const accentHue = Number(accentHslFromCss('--primary').split(' ')[0]);
      const hue = hueOf(CATEGORY_COLOR[category as keyof typeof CATEGORY_COLOR]);
      const gap = hueGap(hue, accentHue);
      expect(
        gap,
        `${category} is ${hue.toFixed(1)} deg, accent is ${accentHue} deg, gap ${gap.toFixed(1)}`,
      ).toBeGreaterThanOrEqual(30);
    },
  );
});
