import type { ItineraryItem } from './trip-data';
import { effectiveStartMinutes, formatTimeAmPm, getCountryForDate } from '@/core/dates';

export interface ItemTimeDisplay {
  label: string;
  badge: 'NPT' | 'JST' | null;
}

/**
 * The ONE display rule for rendering an item's time anywhere in the UI: a defined
 * `effectiveStartMinutes` renders as AM/PM + the day-country badge (badge derived
 * from the day's country, NEVER a per-item TZ); a legacy-only free-text `time`
 * renders verbatim, UNBADGED (free text carries no asserted zone); no usable time
 * renders nothing (`null`). Pure — reuses the existing `effectiveStartMinutes` /
 * `formatTimeAmPm` / `getCountryForDate` helpers, adds no new parsing/offset math
 * (this module is presentation-only).
 */
export function describeItemTime(item: ItineraryItem, dateStr: string): ItemTimeDisplay | null {
  const eff = effectiveStartMinutes(item);
  if (eff !== undefined) {
    const country = getCountryForDate(dateStr);
    return { label: formatTimeAmPm(eff), badge: country === 'japan' ? 'JST' : 'NPT' };
  }
  if (item.time) return { label: item.time, badge: null };
  return null;
}
