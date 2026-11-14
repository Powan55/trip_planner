import { describe, it, expect } from 'vitest';
import { buildMapStyle } from '@/lib/map-style';

// The GL canvas is excluded from axe, so this is the only contrast check the basemap gets.
const GROUND = '#0A0818';

function lum(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: string, b: string) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

type Layer = { id: string; paint: Record<string, string> };
const layers = (buildMapStyle().layers as Layer[]);
const color = (id: string, prop: string) => layers.find((l) => l.id === id)!.paint[prop];

describe('basemap contrast vs ground', () => {
  const cases: [string, string, number][] = [
    ['road-minor', 'line-color', 2.2],
    ['road-major', 'line-color', 3.5],
    ['road-motorway', 'line-color', 5],
    ['boundary-country', 'line-color', 2.5],
    ['road-label', 'text-color', 7],
    ['place-minor-label', 'text-color', 7],
    ['place-label', 'text-color', 9],
    ['country-label', 'text-color', 9],
  ];
  it.each(cases)('%s %s >= %d:1', (id, prop, min) => {
    expect(ratio(color(id, prop), GROUND)).toBeGreaterThanOrEqual(min);
  });
});
