import type { ItineraryItem } from './trip-data';
import {
  effectiveOffsetMin,
  effectiveStartMinutes,
  formatTimeAmPm,
  getCountryForDate,
  offsetForCountry,
  zoneAbbrevForOffset,
  type ZoneAbbrev,
} from '@/core/dates';

export interface ItemTimeDisplay {
  label: string;
  badge: ZoneAbbrev | null;
}

/**
 * The ONE display rule for rendering an
 * item's time anywhere in the UI: a defined `effectiveStartMinutes` renders as
 * AM/PM + the day-country badge (badge derived from the day's country, NEVER a
 * per-item TZ —); a legacy-only free-text `time` renders verbatim, UNBADGED
 * (free text carries no asserted zone); no usable time renders nothing (`null`).
 * Pure — reuses `effectiveStartMinutes`/`formatTimeAmPm`/`getCountryForDate`,
 * adds no new parsing/offset math.
 *
 *-A found the defect: `j22-5` (the Detroit layover, `tzOffsetMin: -300`, on a
 * `country: 'japan'` day) rendered "3:35 PM JST" — a claim 14 hours away from the time the item
 * actually means. Sorting, `whats-next` and `travel-hero` were always right because they resolve
 * `effectiveOffsetMin`; only this LABEL lied.-A SUPPRESSED the badge there, which stopped the
 * lie but left the ceiling it named: an unbadged time among badged siblings still reads as the
 * day's zone by context.
 *
 * closes it — an item in another zone is now badged with its
 * REAL zone (EST/IST/CST) instead of nothing. **The time itself is still never TZ-converted**
 * `startMinutes` stays wall-clock-at-place and we only label that
 * wall-clock correctly. Only "the badge is derived from the day's country ONLY" gave way.
 *
 * ⚖️ Two properties are load-bearing, keep both:
 * · The override is detected via `effectiveOffsetMin`, never `item.tzOffsetMin` directly, so the
 * badge cannot drift out of agreement with the instant math — one resolver, one answer.
 * · The day-country path (no override) now goes through the SAME `zoneAbbrevForOffset` lookup as
 * an overridden item, rather than a hardcoded `country === 'japan' ? 'JST' : 'NPT'` ternary. For
 * the default pack this is still NPT/JST (345/540 are both table entries), but a day offset with
 * no entry in the table — e.g. a custom pack's own leg offset — now stays UNBADGED (`null`)
 * instead of fabricating "NPT". Silence, never a guess.
 */
export function describeItemTime(item: ItineraryItem, dateStr: string): ItemTimeDisplay | null {
  const eff = effectiveStartMinutes(item);
  if (eff !== undefined) {
    const country = getCountryForDate(dateStr);
    const dayOffset = offsetForCountry(country);
    const itemOffset = effectiveOffsetMin(item, dayOffset);
    const badge = zoneAbbrevForOffset(itemOffset);
    return { label: formatTimeAmPm(eff), badge };
  }
  if (item.time) return { label: item.time, badge: null };
  return null;
}
