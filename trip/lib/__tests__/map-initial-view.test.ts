import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MAP_MARKERS } from '@/lib/map-data';

const today = vi.hoisted(() => ({ value: null as { country: string } | null }));
vi.mock('@/lib/trip-now', () => ({ getTodayInTrip: () => today.value }));

import { boundsOf, currentLegMarkers, markersForLeg } from '@/lib/map-initial-view';

beforeEach(() => {
  today.value = null;
});

describe('boundsOf', () => {
  it('is null for no points and the SW/NE box otherwise', () => {
    expect(boundsOf([])).toBeNull();
    expect(
      boundsOf([
        { lng: 85.3, lat: 27.7 },
        { lng: 85.1, lat: 27.9 },
        { lng: 85.5, lat: 27.5 },
      ]),
    ).toEqual([
      [85.1, 27.5],
      [85.5, 27.9],
    ]);
  });
});

describe('currentLegMarkers', () => {
  it('before the trip frames the first leg (Nepal), not both countries', () => {
    const got = currentLegMarkers(MAP_MARKERS);
    expect(got.length).toBeGreaterThan(0);
    expect(got.every((mk) => mk.country === 'Nepal')).toBe(true);
    // Kathmandu Valley box is well under 1 degree wide; both countries span ~55 degrees.
    const [[w], [e]] = boundsOf(got)!;
    const [[aw], [ae]] = boundsOf(MAP_MARKERS)!;
    expect(e - w).toBeLessThan(1);
    expect(ae - aw).toBeGreaterThan(40);
  });

  it('in the Japan leg frames Japan', () => {
    today.value = { country: 'japan' };
    const got = currentLegMarkers(MAP_MARKERS);
    expect(got.length).toBeGreaterThan(0);
    expect(got.every((mk) => mk.country === 'Japan')).toBe(true);
  });

  it('is empty when no marker sits on the leg (caller falls back to all markers)', () => {
    expect(markersForLeg(MAP_MARKERS, 'main')).toEqual([]);
    expect(currentLegMarkers([])).toEqual([]);
  });
});
