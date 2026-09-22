// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TRIP_DATES, getCityForDate } from '@/core/dates';
import { TRIP_PACKS } from '@/core/trips';
import { setActiveTripId } from '@/core/storage/gateway';
import { setTripConfig } from '@/core/trips/registry';
import {
  HUES,
  TRANSIT_COLOR,
  cellPaint,
  deriveCityPalette,
  dayShade,
  shadeColor,
  shadeLabel,
} from '@/lib/city-palette';

const pack = deriveCityPalette(TRIP_PACKS['nepal-japan-2026'], TRIP_DATES, getCityForDate);
const d = (n: number) => pack.byDate[`2026-12-${String(n).padStart(2, '0')}`];

// WCAG + OKLab, kept local: the shades are computed at runtime so the check must run over the real function.
const ch = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a: number[], b: number[]) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const grain = (c: number[]) =>
  c.map((v) => {
    const b = v / 255;
    return Math.round(255 * (b * 0.94 + (b <= 0.5 ? Math.min(1, 2 * b) : 1) * 0.06));
  });
const mix = (fg: number[], bg: number[], a: number) => fg.map((v, i) => v * a + bg[i] * (1 - a));
const oklab = (c: number[]) => {
  const [r, g, b] = c.map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};
const dE = (a: string, b: string) => Math.hypot(...oklab(ch(a)).map((v, i) => v - oklab(ch(b))[i]));
const hueDeg = (c: string) => {
  const [, a, b] = oklab(ch(c));
  return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
};

describe('default pack', () => {
  it('Kathmandu base days share one shade', () => {
    const k = d(10);
    for (const n of [11, 12, 15, 17, 18]) {
      expect(d(n).color).toBe(k.color);
      expect(d(n).satellite).toBe(false);
      expect(d(n).transit).toBeNull();
    }
    expect(k.city).toBe('Kathmandu');
  });

  it('day trips keep Kathmandu shade and carry the satellite flag', () => {
    const cities: Record<number, string> = { 13: 'Lalitpur', 14: 'Nagarkot', 16: 'Bhaktapur' };
    for (const n of [13, 14, 16]) {
      expect(d(n).color).toBe(d(10).color);
      expect(d(n).city).toBe('Kathmandu');
      expect(d(n).ownCity).toBe(cities[n]);
      expect(d(n).satellite).toBe(true);
    }
  });

  it('Dec 9 is a transit day out of the trip, not a day trip', () => {
    expect(d(9).ownCity).toBe('New York');
    expect(d(9).transit).toEqual({ from: null, to: d(10).color });
    expect(d(9).satellite).toBe(false);
  });

  it('Dec 19 is a Nepal to Japan split', () => {
    expect(d(19).ownCity).toBe('Osaka');
    expect(d(19).transit).toEqual({ from: d(18).color, to: d(20).color });
    expect(d(19).transit!.from).not.toBe(d(19).transit!.to);
  });

  it('Osaka, Kyoto and Tokyo get three distinct shades inside the Japan hue', () => {
    const osaka = pack.byDate['2026-12-20'].color;
    const kyoto = pack.byDate['2026-12-25'].color;
    const tokyo = pack.byDate['2026-12-30'].color;
    expect(new Set([osaka, kyoto, tokyo]).size).toBe(3);
    expect(pack.byDate['2026-12-23'].city).toBe('Osaka');
    expect(pack.legend.map((e) => e.city)).toEqual(['Kathmandu', 'Osaka', 'Kyoto', 'Tokyo']);
    expect(osaka).toBe(HUES[1][0]);
    expect(tokyo).toBe(HUES[1][1]);
    // every Japan shade stays in the pink to violet band, far from Nepal's orange
    for (const c of [osaka, kyoto, tokyo]) expect(Math.abs(hueDeg(c) - hueDeg(HUES[0][0]))).toBeGreaterThan(60);
  });

  it('Nepal and Japan hues differ, and the colour never keys off countryLabel', () => {
    expect(d(10).color).toBe(HUES[0][0]);
    expect(d(10).color).not.toBe(pack.byDate['2026-12-20'].color);
    expect(pack.hasSatellite && pack.hasTransit).toBe(true);
  });

  it('labels put the city in words', () => {
    expect(shadeLabel(d(10))).toBe(', Kathmandu');
    expect(shadeLabel(d(13))).toBe(', Lalitpur, day trip from Kathmandu');
    expect(shadeLabel(d(19))).toBe(', Osaka, travel day');
  });

  it('dayShade (active trip binding) matches the pure derivation and is total', () => {
    expect(dayShade('2026-12-13')).toEqual(d(13));
    expect(dayShade('2030-01-01').color).toMatch(/^#[0-9A-F]{6}$/);
    expect(dayShade('constructor').color).toMatch(/^#[0-9A-F]{6}$/);
  });
});

describe('cellPaint', () => {
  it('transit is a split with white text and the neutral seam; planned is tinted; unplanned is dim', () => {
    const t = cellPaint(d(19));
    expect(t.color).toBe('var(--text-hi)');
    expect(t.background).toContain(TRANSIT_COLOR);
    expect(cellPaint(d(10), { planned: true }).color).toBe(d(10).color);
    expect(cellPaint(d(10), { planned: false }).color).toBeUndefined();
  });
});

describe('other packs', () => {
  const leg = (id: string, start: string, end: string) => ({
    id, countryLabel: id, currency: 'USD', start, end, contentRef: '', contentKey: '', utcOffsetMin: 0, fallbackCity: '',
  });
  const dates = (n: number) => Array.from({ length: n }, (_, i) => `2027-03-${String(i + 1).padStart(2, '0')}`);

  it('single-leg trip: cities spread across hues, one leg, no country clash', () => {
    const cities = ['A', 'A', 'B', 'B', 'C', 'C', 'D', 'D', 'E', 'E'];
    const p = deriveCityPalette({ legs: [leg('main', '2027-03-01', '2027-03-10')] }, dates(10), (x) => cities[dates(10).indexOf(x)]);
    const colors = p.legend.map((e) => e.color);
    expect(new Set(colors).size).toBe(5);
    expect(colors.slice(0, 4)).toEqual(HUES.map((h, i) => shadeColor(i, 0, 2)));
    expect(p.hasTransit).toBe(false);
  });

  it('single-leg custom trip re-imported under a custom pack is one calm colour with no transit', async () => {
    setActiveTripId('custom-x');
    setTripConfig('custom-x', { start: '2026-12-05', end: '2027-01-15', destinations: ['Reykjavik', 'Vik'], vibe: 'city', currency: 'ISK', updatedAt: 1 });
    vi.resetModules();
    const m = await import('@/lib/city-palette');
    const a = m.dayShade('2026-12-09');
    expect(a.ownCity).toBe('Reykjavik');
    expect(a.transit).toBeNull();
    expect(a.satellite).toBe(false);
    expect(m.dayShade('2026-12-19').color).toBe(a.color);
    expect(m.cityLegend().legend).toHaveLength(1);
  });

  it('a leg of only one-day cities makes each its own base', () => {
    const p = deriveCityPalette(
      { legs: [leg('a', '2027-03-01', '2027-03-03'), leg('b', '2027-03-04', '2027-03-06')] },
      dates(6),
      (x) => ['P', 'Q', 'R', 'S', 'S', 'S'][dates(6).indexOf(x)],
    );
    expect(p.legend.map((e) => e.city)).toEqual(['P', 'Q', 'R', 'S']);
    expect(p.hasSatellite).toBe(false);
  });

  it('a five-leg trip cycles the hue palette by leg index', () => {
    const legs = Array.from({ length: 5 }, (_, i) => leg(`l${i}`, `2027-03-0${i + 1}`, `2027-03-0${i + 1}`));
    const p = deriveCityPalette({ legs }, dates(5), (x) => `C${x}`);
    const c = dates(5).map((x) => p.byDate[x].color);
    expect(c[4]).toBe(c[0]);
    expect(new Set(c.slice(0, 4)).size).toBe(4);
  });
});

describe('measured on the rendered ground', () => {
  const ground = ch('#141033');
  const bg = ch('#0A0818');

  it('every shade clears AA on the grain-lightened cell tint and on the page ground', () => {
    for (let hue = 0; hue < HUES.length; hue++) {
      for (let n = 1; n <= 6; n++) {
        for (let i = 0; i < n; i++) {
          const c = ch(shadeColor(hue, i, n));
          expect(ratio(c, grain(mix(c, ground, 0.1))), `hue ${hue} ${i}/${n} on tint`).toBeGreaterThanOrEqual(4.5);
          expect(ratio(c, grain(bg)), `hue ${hue} ${i}/${n} on bg`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('adjacent shades stay apart (OKLab): four per hue, two for the short leg-0 blue stop pair', () => {
    for (let hue = 0; hue < HUES.length; hue++) {
      for (let n = 2; n <= (hue === 0 ? 2 : 4); n++) {
        for (let i = 1; i < n; i++) {
          expect(dE(shadeColor(hue, i, n), shadeColor(hue, i - 1, n)), `hue ${hue} ${i}/${n}`).toBeGreaterThan(0.07);
        }
      }
    }
  });

  it('hue 1 mirrors the --jp tokens; hue 0 deliberately does not mirror --np', () => {
    const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');
    const tok = (n: string) => new RegExp(`${n}:\\s*(#[0-9A-Fa-f]{6})`).exec(css)![1].toUpperCase();
    expect([tok('--jp-a'), tok('--jp-b')]).toEqual([...HUES[1]]);
    expect([tok('--np-a'), tok('--np-b')]).not.toEqual([...HUES[0]]);
  });

  it('hue 0 (calendar Nepal blue) reads well against a dark ground and stays apart from hue 1', () => {
    const bgDark = [10, 8, 24]; // --background
    for (const c of HUES[0]) expect(ratio(ch(c), bgDark)).toBeGreaterThanOrEqual(4.5);
    expect(Math.abs(hueDeg(HUES[0][0]) - hueDeg(HUES[1][0]))).toBeGreaterThan(60);
  });
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
