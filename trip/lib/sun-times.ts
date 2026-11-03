import { cityCoord } from '@/lib/city-coords';
import {
  declaredOffsetForCountry,
  effectiveDurationMinutes,
  effectiveStartMinutes,
} from '@/core/dates';
import type { ItineraryItem } from '@/lib/trip-data';
import type { ItineraryCategory } from '@/lib/itinerary-category';

export interface SunTimes {
  sunriseMin: number;
  sunsetMin: number;
}

const RAD = Math.PI / 180;
const OUTDOOR: ReadonlySet<ItineraryCategory> = new Set(['sightseeing', 'photography', 'nature']);

function sunAt(jd: number) {
  const t = (jd - 2451545) / 36525;
  const l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const m = (357.52911 + t * (35999.05029 - 0.0001537 * t)) * RAD;
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c =
    Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m) * 0.000289;
  const omega = (125.04 - 1934.136 * t) * RAD;
  const lambda = (l0 + c - 0.00569 - 0.00478 * Math.sin(omega)) * RAD;
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = (eps0 + 0.00256 * Math.cos(omega)) * RAD;
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const y = Math.tan(eps / 2) ** 2;
  const l0r = l0 * RAD;
  const eqTime =
    4 *
    (1 / RAD) *
    (y * Math.sin(2 * l0r) -
      2 * e * Math.sin(m) +
      4 * e * y * Math.sin(m) * Math.cos(2 * l0r) -
      0.5 * y * y * Math.sin(4 * l0r) -
      1.25 * e * e * Math.sin(2 * m));
  return { decl, eqTime };
}

/** UTC minutes from 0h UTC of `utcMidnightJd`; may fall outside 0..1440. NaN when the sun never crosses the horizon. */
function eventUtcMin(utcMidnightJd: number, lat: number, lng: number, rising: boolean): number {
  let minutes = 720;
  // second pass re-evaluates the sun at the event itself, not at the date's midnight
  for (let pass = 0; pass < 2; pass++) {
    const { decl, eqTime } = sunAt(utcMidnightJd + minutes / 1440);
    const latR = lat * RAD;
    const cosHa = Math.cos(90.833 * RAD) / (Math.cos(latR) * Math.cos(decl)) - Math.tan(latR) * Math.tan(decl);
    if (cosHa < -1 || cosHa > 1) return NaN;
    const ha = Math.acos(cosHa) / RAD;
    minutes = 720 - 4 * (lng + (rising ? ha : -ha)) - eqTime;
  }
  return minutes;
}

/** Sunrise/sunset as minutes since local midnight at the given UTC offset; null in polar day/night. */
export function sunTimes(date: string, lat: number, lng: number, offsetMin: number): SunTimes | null {
  const [y, mo, d] = date.split('-').map(Number);
  const jd = Date.UTC(y, mo - 1, d) / 86400000 + 2440587.5;
  const rise = eventUtcMin(jd, lat, lng, true);
  const set = eventUtcMin(jd, lat, lng, false);
  if (Number.isNaN(rise) || Number.isNaN(set)) return null;
  const local = (utcMin: number) => ((Math.round(utcMin + offsetMin) % 1440) + 1440) % 1440;
  return { sunriseMin: local(rise), sunsetMin: local(set) };
}

/** The day's sun in the city's own zone; null for a city with no coordinate or a pack with no real time zone. */
export function daySunTimes(date: string, city: string, country: string): SunTimes | null {
  const coord = cityCoord(city);
  if (!coord) return null;
  const offset = coord.utcOffsetMin ?? declaredOffsetForCountry(country);
  if (offset === 0) return null;
  return sunTimes(date, coord.latitude, coord.longitude, offset);
}

/** An outdoor item that ends (or, with no duration, starts) after sunset. Items in another zone are skipped. */
export function endsAfterSunset(item: ItineraryItem, sunsetMin: number): boolean {
  if (!OUTDOOR.has(item.category) || typeof item.tzOffsetMin === 'number') return false;
  const start = effectiveStartMinutes(item);
  if (start === undefined) return false;
  return start + (effectiveDurationMinutes(item) ?? 0) > sunsetMin;
}
