import type { ItineraryItem } from './trip-data';
import {
  declaredOffsetForCountry,
  effectiveOffsetMin,
  effectiveStartMinutes,
  formatTimeAmPm,
  getCountryForDate,
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
 *
 * #243: that second property was STATED here but not actually delivered, because the day offset
 * came from `offsetForCountry`, which substitutes the DEVICE's own offset for a pack with no
 * geography — so a custom pack's leg offset never reached the table at all and a Paris trip
 * planned from a US-Eastern phone in December badged every item `EST`. The base offset is now
 * `declaredOffsetForCountry`, which is the pack's own value (0 for a custom leg ⇒ no table entry
 * ⇒ `null`). A per-item `tzOffsetMin` is a real declaration and still badges, on any pack. The
 * UTC-instant math is untouched and keeps its device anchor — see that function's comment for
 * why the two questions take different answers.
 */
export function describeItemTime(item: ItineraryItem, dateStr: string): ItemTimeDisplay | null {
  const eff = effectiveStartMinutes(item);
  if (eff !== undefined) {
    const dayOffset = declaredOffsetForCountry(getCountryForDate(dateStr));
    const badge = zoneAbbrevForOffset(effectiveOffsetMin(item, dayOffset));
    return { label: formatTimeAmPm(eff), badge };
  }
  if (item.time) return { label: item.time, badge: null };
  return null;
}
