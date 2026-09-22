import { TRIP_DATES, getCityForDate } from '@/core/dates';
import { getActiveTrip, legForDate, type TripConfig } from '@/core/trips';

/**
 * lib/city-palette.ts — THE one place that decides what colour a trip day is. Every calendar
 * surface (month grid, day strip, day headers, journey rail, print, map popup) reads it; none
 * may hand-roll `leg === 'nepal' ? ... : ...`.
 *
 * Keyed off the LEG ID and the by-date city only. `DayPlan.countryLabel` ('USA') is display text
 * and must never pick a colour.
 *
 * Rule: one hue per leg (default pack: leg 0 orange->gold = --np-a/--np-b, leg 1 pink->violet =
 * --jp-a/--jp-b; more legs cycle HUES). Inside a leg, BASE cities take shades stepped along the
 * hue in first-visit order. A city with a single day in its leg is a SATELLITE (a day trip): it
 * keeps the shade of the nearest preceding base city in that leg, else the next one. A
 * single-leg trip has no country to tell apart, so its cities spread across the hues instead.
 * A day whose leg differs from the day before, or a first day spent in a satellite city, is a
 * TRANSIT day: it is drawn as two halves and carries no country's colour of its own.
 *
 * KNOWN CEILING: a run of one-day cities that is not a round trip (Paris, Rome, then a week in
 * Berlin) counts as satellites of Berlin. Tighten to "bracketed by the same base" if a pack needs it.
 *
 * Active trip is captured at module load, like lib/leg-label.ts: a trip switch is a full reload.
 */

// Leg 0 / leg 1 mirror --np-a/--np-b and --jp-a/--jp-b in app/globals.css (a unit test pins it).
export const HUES: readonly (readonly [string, string])[] = [
  ['#FF8A3D', '#FFC43D'],
  ['#FF8FC7', '#C08CFF'],
  ['#4FD6C8', '#7AA8FF'],
  ['#4ADE80', '#D4E157'],
];

/** Neutral that belongs to no leg. Seam and border of a transit cell. */
export const TRANSIT_COLOR = '#CFC6E0';

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (c: number[]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
const lerp = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);

/**
 * Shade `index` of `count` along hue `hue`. Evenly spaced between the hue's two stops; every
 * odd step is also lifted 40% toward white, because a hue shift alone leaves 3+ steps too close
 * to tell apart (measured adjacent OKLab distance 0.067 at n=3, 0.045 at n=4 without the lift).
 * KNOWN CEILING: the orange-gold pair spans only 20 degrees, so 3+ shades of leg 0 sit ~0.066 apart.
 */
export function shadeColor(hue: number, index: number, count: number): string {
  const [a, b] = HUES[((hue % HUES.length) + HUES.length) % HUES.length];
  const t = count <= 1 ? 0 : Math.min(index, count - 1) / (count - 1);
  const c = lerp(rgb(a), rgb(b), t);
  return hex(index % 2 ? lerp(c, [255, 255, 255], 0.4) : c);
}

export interface DayShade {
  /** The day's colour: its base city's shade. */
  color: string;
  /** The city this day is coloured for (the base city). */
  city: string;
  /** The city the day is actually spent in. Differs from `city` on a day trip. */
  ownCity: string;
  /** A day trip from `city`; false on a transit day. */
  satellite: boolean;
  /** Colours of the two halves. `from` is null when the origin is outside the trip. */
  transit: { from: string | null; to: string } | null;
  legIndex: number;
}

export interface LegendEntry {
  city: string;
  color: string;
  legId: string;
}

export interface CityPalette {
  byDate: Record<string, DayShade>;
  legend: LegendEntry[];
  hasSatellite: boolean;
  hasTransit: boolean;
}

/** PURE. `dates` in trip order; `cityFor` is the per-day city answer (getCityForDate). */
export function deriveCityPalette(
  trip: Pick<TripConfig, 'legs'>,
  dates: readonly string[],
  cityFor: (dateStr: string) => string,
): CityPalette {
  const legs = trip.legs;
  const single = legs.length === 1;
  const days = dates.map((date) => ({
    date,
    city: cityFor(date),
    leg: legs.indexOf(legForDate(trip as TripConfig, date)),
  }));

  // Per leg: which cities are bases, in first-visit order.
  const bases = legs.map((_, li) => {
    const count = new Map<string, number>();
    for (const d of days) if (d.leg === li) count.set(d.city, (count.get(d.city) ?? 0) + 1);
    const multi = [...count].filter(([, n]) => n >= 2).map(([c]) => c);
    // A leg of only one-day cities has nothing to attach to: every city is its own base.
    const keep = multi.length ? new Set(multi) : new Set(count.keys());
    return [...count.keys()].filter((c) => keep.has(c));
  });

  const colorOf = (li: number, base: string): string => {
    const order = bases[li];
    const k = order.indexOf(base);
    if (!single) return shadeColor(li, k, order.length);
    return shadeColor(k % HUES.length, Math.floor(k / HUES.length), Math.ceil(order.length / HUES.length));
  };

  const byDate: Record<string, DayShade> = {};
  let hasSatellite = false;
  let hasTransit = false;
  days.forEach((d, i) => {
    const order = bases[d.leg];
    let base = d.city;
    if (!order.includes(d.city)) {
      let prior: string | undefined;
      for (let j = i - 1; j >= 0 && days[j].leg === d.leg; j--) {
        if (order.includes(days[j].city)) { prior = days[j].city; break; }
      }
      base = prior ?? order[0] ?? d.city;
    }
    const color = colorOf(d.leg, base);
    const prev = i > 0 ? byDate[days[i - 1].date] : undefined;
    const legChange = i > 0 && d.leg !== days[i - 1].leg;
    const transit =
      legChange || (i === 0 && base !== d.city)
        ? { from: legChange && prev ? prev.color : null, to: color }
        : null;
    const satellite = !transit && base !== d.city;
    hasSatellite ||= satellite;
    hasTransit ||= transit !== null;
    byDate[d.date] = { color, city: base, ownCity: d.city, satellite, transit, legIndex: d.leg };
  });

  const legend = bases.flatMap((order, li) =>
    order.map((city) => ({ city, color: colorOf(li, city), legId: legs[li].id })),
  );
  return { byDate, legend, hasSatellite, hasTransit };
}

const activeTrip = getActiveTrip();
const palette = deriveCityPalette(activeTrip, TRIP_DATES, getCityForDate);

/** TOTAL: a date outside the trip window falls back to the first shade of its clamped leg. */
export function dayShade(date: string): DayShade {
  const hit = Object.prototype.hasOwnProperty.call(palette.byDate, date) ? palette.byDate[date] : undefined;
  if (hit) return hit;
  const li = Math.max(0, activeTrip.legs.indexOf(legForDate(activeTrip, date)));
  const color = shadeColor(activeTrip.legs.length === 1 ? 0 : li, 0, 1);
  const city = getCityForDate(date);
  return { color, city, ownCity: city, satellite: false, transit: null, legIndex: li };
}

export const cityLegend = (): CityPalette => palette;

/**
 * Colour for a map place. Markers carry a leg label and a free-text `area` ('Thamel, Kathmandu'),
 * not a date, so match the area against the legend cities; else the leg's first city.
 */
export function placeColor(countryLabel: string, area: string): string {
  const leg = activeTrip.legs.find((l) => l.countryLabel === countryLabel);
  const inLeg = palette.legend.filter((e) => !leg || e.legId === leg.id);
  const a = area.toLowerCase();
  return (inLeg.find((e) => a.includes(e.city.toLowerCase())) ?? inLeg[0])?.color ?? shadeColor(0, 0, 1);
}

/** Left-to-right fill for leg `i`'s rail segment. */
export const legGradient = (i: number): string => {
  const [a, b] = HUES[i % HUES.length];
  return `linear-gradient(118deg, ${a} 0%, ${b} 100%)`;
};

const tint = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;

/**
 * Inline paint for a day cell/chip. `planned` keeps the app's solid-vs-hollow meaning: a day
 * with nothing on it stays dashed and dim, only its border says which city. A transit day is a
 * diagonal split (origin | seam | destination) with white text, since no single colour is right.
 */
export function cellPaint(
  s: DayShade,
  opts: { planned: boolean; tint?: number; border?: number } = { planned: true },
): Record<string, string> {
  const { planned, tint: t = 10, border = 60 } = opts;
  if (s.transit) {
    const from = tint(s.transit.from ?? TRANSIT_COLOR, 18);
    return {
      color: 'var(--text-hi)',
      borderColor: TRANSIT_COLOR,
      background: `linear-gradient(135deg, ${from} 0 46%, ${TRANSIT_COLOR} 46% 54%, ${tint(s.transit.to, 18)} 54% 100%)`,
    };
  }
  const out: Record<string, string> = { borderColor: tint(s.color, planned ? border : 55) };
  if (planned) {
    out.color = s.color;
    if (t > 0) out.background = tint(s.color, t);
  }
  return out;
}

/** Solid fill for a small swatch: the day's colour, or origin | seam | destination on a transit day. */
export function swatchFill(s: DayShade): string {
  if (!s.transit) return s.color;
  return `linear-gradient(135deg, ${s.transit.from ?? TRANSIT_COLOR} 0 42%, ${TRANSIT_COLOR} 42% 58%, ${s.transit.to} 58% 100%)`;
}

/** Screen-reader suffix that puts the city (and day-trip / travel-day status) in words. */
export function shadeLabel(s: DayShade): string {
  if (s.transit) return `, ${s.ownCity}, travel day`;
  return s.satellite ? `, ${s.ownCity}, day trip from ${s.city}` : `, ${s.ownCity}`;
}
