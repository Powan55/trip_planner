import { SAMPLE_ITINERARY } from '@/lib/sample-itinerary';
import { getActiveTrip, isDefaultTrip } from '@/core/trips';
import { getCityForDate, getCountryForDate } from '@/core/dates';

/**
 * lib/leg-label.ts — THE one place that turns a leg id into a human label and composes
 * the "City, Country" day line. Display-only, and that boundary is load-bearing:
 *
 * `DayPlan.country` / `Leg` are LEG IDS, not labels. They drive `legCurrency`
 * (core/budget/model.ts) and `offsetForCountry` (core/dates/item-time.ts). Nothing in this
 * module feeds behaviour — it is a layer ON TOP of the id, never a rename of it.
 *
 * Before this module every surface hand-rolled `country === 'nepal' ? 'Nepal': 'Japan'`, which
 * (a) printed "Syracuse, Nepal" for the Dec-9 departure day and (b) printed "Bali, Japan" on
 * every day of every CUSTOM trip. The labels themselves already existed on the pack —
 * `TripLeg.countryLabel` (core/trips/model.ts) — so this reuses them; there is no second map.
 *
 * ── THE COMPOSITION RULE (the whole point of this file) ───────────────────────────────────
 * A country label is appended to the city ONLY when it adds information:
 *
 * 1. A per-day authored label wins (`DayPlan.countryLabel`, else the content-derived
 * DAY_LABELS by date). Dec 9 is spent in Syracuse/JFK/the air, so it reads
 * "Syracuse, USA" while its leg id stays 'nepal' for currency + offset.
 * 2. Otherwise the leg's label is appended ONLY on a MULTI-leg trip. Every custom trip is a
 * SINGLE leg (core/trips/custom.ts) whose `countryLabel` is `destinations.join(' × ')`,
 * so on a custom trip the label is constant across the whole trip and says nothing. This
 * clause is what makes BOTH bad outputs unreachable: "Bali, Japan" (the old ternary) and
 * "Bali, Bali × Lombok" (naively appending the joined label).
 * 3. A label that repeats the city either way is dropped ("Bali", not "Bali, Bali").
 *
 * The active trip is captured at MODULE LOAD — the same pattern as core/dates/trip-cities.ts
 * and core/budget/model.ts, and correct by design: a trip switch is a pointer write + a full
 * page reload, so a fresh module graph re-captures the new trip.
 */

const activeTrip = getActiveTrip();
const activeIsDefault = isDefaultTrip();
const multiLeg = activeTrip.legs.length > 1;

/**
 * ISO date → authored per-day label, DERIVED from the content root (the pattern used by
 * TRIP_CITIES). Consulted only for the DEFAULT pack ( trip-scoping — a custom trip whose
 * span overlaps Dec 9 – Jan 9 must not inherit the default trip's authored labels). Deriving it
 * by DATE as well as reading `DayPlan.countryLabel` matters: a LEGACY day-doc written before the
 * label existed arrives over Firestore sync without one, and this map fills it back in. (Sync no
 * longer strips it: `docToDayPlan` passes unknown/optional day keys through, #42. So this is a
 * fallback for old data, not a workaround for the mapper.)
 */
const DAY_LABELS: Record<string, string> = Object.fromEntries(
  SAMPLE_ITINERARY.flatMap((d) => (d.countryLabel ? [[d.date, d.countryLabel] as const] : [])),
);

/** A leg id's label from the active pack, or '' when the id is not one of this trip's legs. */
function labelForLeg(legId: string): string {
  return activeTrip.legs.find((l) => l.id === legId)?.countryLabel ?? '';
}

/** The label to hang off a city for `dateStr` on leg `legId` — '' when it would add nothing. */
function dayLabel(dateStr: string, legId: string): string {
  const authored = activeIsDefault ? DAY_LABELS[dateStr] : undefined;
  return authored ?? (multiLeg ? labelForLeg(legId) : '');
}

/** Join city + label, dropping a label that is empty or that just repeats the city (rule 3). */
function compose(city: string, label: string): string {
  if (!city) return label;
  if (!label || label.includes(city) || city.includes(label)) return city;
  return `${city}, ${label}`;
}

/**
 * The human label of a leg id on its own — the expense leg toggle, settle-up, Wrapped.
 * TOTAL: an id the active trip does not know falls back to the CAPITALIZED raw id, so a stale
 * persisted leg from another trip renders 'Nepal', never blank and never lowercase 'nepal'
 * (the hand-rolled sites did `LEG_LABEL[s.leg] ?? s.leg` and `capitalize(leg)` respectively).
 */
export function legLabel(legId: string): string {
  return labelForLeg(legId) || legId.charAt(0).toUpperCase() + legId.slice(1);
}

/** The "City, Country" line for a day plan — "Syracuse, USA" / "Kathmandu, Nepal" / "Bali". */
export function dayPlaceLabel(day: {
  date: string;
  city: string;
  country: string;
  countryLabel?: string;
}): string {
  // #6: a day that arrived over sync can carry `city: ''`. `docToDayPlan` defaults a missing or
  // ill-typed field to '', and a remote-only day passes through `mergeDays` unmerged. Fall back to
  // the SAME by-date city `placeLabelForDate` uses, so the line never renders a bare "USA" (default
  // pack) or an empty string (custom trip). A day with its own city is untouched.
  return compose(day.city || getCityForDate(day.date), day.countryLabel ?? dayLabel(day.date, day.country));
}

/** The same line for a bare trip DATE, when no day plan is in hand (dialog option lists). */
export function placeLabelForDate(dateStr: string): string {
  return compose(getCityForDate(dateStr), dayLabel(dateStr, getCountryForDate(dateStr)));
}
