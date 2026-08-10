import { describe, it, expect } from 'vitest';
import { haversineKm, type LatLng } from '@/lib/day-anchor';

// S381 / D-281: the `orderByProximity` suite that used to sit at the bottom of this file
// was DELETED with the function itself — nearest-first ordering was retired on every surface.
// `haversineKm` keeps its tests below: the day anchor still labels each stop with its distance.

// Well-known coordinates (WGS84), matching lib/map-data.ts.
const BOUDHA: LatLng = { lat: 27.7215, lng: 85.362 }; // Kathmandu
const SWAYAMBHU: LatLng = { lat: 27.7149, lng: 85.2904 }; // ~7 km W of Boudha
const TOKYO: LatLng = { lat: 35.6762, lng: 139.6503 };

describe('haversineKm', () => {
  it('is zero for identical points', () => {
    expect(haversineKm(BOUDHA, BOUDHA)).toBe(0);
  });

  it('is symmetric', () => {
    expect(haversineKm(BOUDHA, TOKYO)).toBeCloseTo(haversineKm(TOKYO, BOUDHA), 6);
  });

  it('matches the known short intra-valley distance (Boudha↔Swayambhu ≈ 7 km)', () => {
    const d = haversineKm(BOUDHA, SWAYAMBHU);
    expect(d).toBeGreaterThan(6);
    expect(d).toBeLessThan(8);
  });

  it('matches the known Kathmandu↔Tokyo distance (≈ 5150 km)', () => {
    const d = haversineKm(BOUDHA, TOKYO);
    expect(d).toBeGreaterThan(4900);
    expect(d).toBeLessThan(5400);
  });

  it('measures across the antimeridian on the SHORT arc, not the long way round', () => {
    // Two points 2° apart in longitude, straddling the 180° line, on the equator.
    const west: LatLng = { lat: 0, lng: 179 };
    const east: LatLng = { lat: 0, lng: -179 };
    const short = haversineKm(west, east);
    // ~222 km (2° of longitude at the equator), NOT ~39,700 km (358° the long way).
    expect(short).toBeGreaterThan(200);
    expect(short).toBeLessThan(250);
  });
});
