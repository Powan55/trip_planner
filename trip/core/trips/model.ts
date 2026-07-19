/**
 * `core/trips` — the Trip Pack model.
 * Framework-free: plain TS only, NO React / Next / `window`. This is the pack-shape the
 * date backbone (`core/dates`) derives its constants from as of. Import arrow is
 * ONE-WAY: `core/dates` → `core/trips`; `core/trips` imports NOTHING from `core/dates`
 * or `core/content`.
 */

/** One country/currency leg of a trip. Legs are ordered, contiguous, non-overlapping. */
export interface TripLeg {
  /** Stable slug. For the DEFAULT pack these MUST be 'nepal' | 'japan' — they ARE the
   * legacy Leg / DayPlan.country union values; persisted bytes depend on them. */
  id: string;
  /** Human country label ('Nepal', 'Japan'). */
  countryLabel: string;
  /** ISO 4217 LOCAL currency for this leg. */
  currency: string;
  /** Inclusive ISO date span ('YYYY-MM-DD'). leg[i].end + 1 day === leg[i+1].start. */
  start: string;
  end: string;
  /** Key into the pack's content bundle. */
  contentKey: string;
  /** Fixed wall-clock UTC offset in minutes (NPT 345 / JST 540) — feeds item-time.ts. */
  utcOffsetMin: number;
  /** Defensive off-map city fallback for getCityForDate ('Kathmandu' / 'Tokyo').
   * Exists ONLY to keep the pre-pack fallback byte-identical (trip-cities.ts). */
  fallbackCity: string;
}

export interface TripConfig {
  /** Pack id === Firestore TRIP_ID convention. Default pack id = 'nepal-japan-2026'
   * (must equal lib/firebase-config.ts's NEXT_PUBLIC_TRIP_ID default). */
  id: string;
  /** Human label ('Nepal × Japan 2026'). */
  label: string;
  /** Inclusive ISO trip span. start === legs[0].start; end === legs.at(-1).end
   * (enforced by a unit assertion, not runtime code). */
  start: string;
  end: string;
  /** ≥ 1 ordered legs. The DEFAULT pack has exactly the two legacy legs. */
  legs: TripLeg[];
  /** Content-bundle key resolved by core/content/registry.ts. Default: 'nepal-japan-2026'. */
  contentRef: string;
}

/**
 * The leg containing `dateStr` (PURE, TOTAL). TZ-safe **lexicographic** ISO compare —
 * mirrors `getCountryForDate`'s B-01 rule: the input is never `new Date`-parsed, so
 * a date-only string can't slip across a boundary at a negative UTC offset. Clamps: a date
 * before the first leg → the first leg; on or past the last leg's end → the last leg. So the
 * default pack's classification is byte-identical to the old `dateStr <= NEPAL_END_DAY`.
 */
export function legForDate(config: TripConfig, dateStr: string): TripLeg {
  const legs = config.legs;
  if (dateStr < legs[0].start) return legs[0];
  for (const leg of legs) {
    if (dateStr <= leg.end) return leg;
  }
  return legs[legs.length - 1];
}
