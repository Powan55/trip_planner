import { describe, expect, it } from 'vitest';
import { daySunTimes, endsAfterSunset, sunTimes } from '@/lib/sun-times';
import type { ItineraryItem } from '@/lib/trip-data';

const KTM = { lat: 27.7172, lng: 85.324, off: 345 };
const TYO = { lat: 35.6762, lng: 139.6503, off: 540 };

const utcToLocalMin = (iso: string, off: number) => {
  const d = new Date(iso);
  return (d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60 + off) % 1440;
};

// Reference: api.sunrise-sunset.org (formatted=0), same -0.833 degree horizon as NOAA.
const CASES: [string, typeof KTM, string, string][] = [
  ['Kathmandu 2026-12-21', KTM, '2026-12-21T01:04:59+00:00', '2026-12-21T11:28:18+00:00'],
  ['Kathmandu 2026-03-20', KTM, '2026-03-20T00:22:40+00:00', '2026-03-20T12:29:47+00:00'],
  ['Kathmandu 2026-12-10', KTM, '2026-12-10T00:58:24+00:00', '2026-12-10T11:24:20+00:00'],
  ['Tokyo 2026-12-21', TYO, '2026-12-20T21:46:59+00:00', '2026-12-21T07:31:33+00:00'],
  ['Tokyo 2026-06-21', TYO, '2026-06-20T19:25:49+00:00', '2026-06-21T10:00:27+00:00'],
  ['Tokyo 2026-12-23', TYO, '2026-12-22T21:47:57+00:00', '2026-12-23T07:32:33+00:00'],
];

describe('sunTimes', () => {
  it.each(CASES)('%s within 2 min of reference', (label, p, rise, set) => {
    const date = label.split(' ')[1];
    const got = sunTimes(date, p.lat, p.lng, p.off)!;
    expect(Math.abs(got.sunriseMin - utcToLocalMin(rise, p.off))).toBeLessThanOrEqual(2);
    expect(Math.abs(got.sunsetMin - utcToLocalMin(set, p.off))).toBeLessThanOrEqual(2);
  });

  it('returns null in polar night', () => {
    expect(sunTimes('2026-12-21', 78.22, 15.65, 60)).toBeNull();
  });
});

describe('daySunTimes', () => {
  it('uses the city zone, not the device zone', () => {
    const tokyo = daySunTimes('2026-12-21', 'Tokyo', 'japan')!;
    expect(Math.abs(tokyo.sunsetMin - 991.5)).toBeLessThanOrEqual(2);
  });

  it('uses the city own zone on the New York day that carries the nepal leg id', () => {
    const ny = daySunTimes('2026-12-09', 'New York', 'nepal')!;
    expect(ny.sunsetMin).toBeGreaterThan(16 * 60);
    expect(ny.sunsetMin).toBeLessThan(17 * 60);
  });

  it('is null for a city with no coordinate', () => {
    expect(daySunTimes('2026-12-21', 'Atlantis', 'nepal')).toBeNull();
  });
});

describe('endsAfterSunset', () => {
  const item = (o: Partial<ItineraryItem>): ItineraryItem =>
    ({ id: 'x', title: 't', category: 'sightseeing', time: '16:30', duration: '2h', ...o }) as ItineraryItem;
  const sunset = 17 * 60 + 13;

  it('flags an outdoor item that ends after sunset', () => {
    expect(endsAfterSunset(item({}), sunset)).toBe(true);
  });
  it('passes one that ends before', () => {
    expect(endsAfterSunset(item({ time: '14:00' }), sunset)).toBe(false);
  });
  it('ignores indoor categories, untimed items and other-zone items', () => {
    expect(endsAfterSunset(item({ category: 'food' }), sunset)).toBe(false);
    expect(endsAfterSunset(item({ time: undefined }), sunset)).toBe(false);
    expect(endsAfterSunset(item({ tzOffsetMin: -300 }), sunset)).toBe(false);
  });
});
