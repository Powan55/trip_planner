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

  it('Day Trip is off the interaction signal hue (S353C/Ruling-3)', () => {
    // --ring / --primary is hsl(189 90% 60%). The old cyan-500 was hsl(189 94% 43%) — the
    // SAME hue, which is the collision this slice existed to remove. Require >= 30 deg away.
    const hex = CATEGORY_COLOR['Day Trip'];
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
    if (hue < 0) hue += 360;
    const delta = Math.min(Math.abs(hue - 189), 360 - Math.abs(hue - 189));
    expect(delta).toBeGreaterThanOrEqual(30);
  });
});
