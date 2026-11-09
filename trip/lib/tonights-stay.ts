import type { ItineraryItem } from '@/lib/trip-data';
import { effectiveStartMinutes } from '@/core/dates';

const CHECK_OUT = /check(?:ing)?[\s-]*out/i;
const CHECK_IN_PREFIX = /^check(?:ing)?[\s-]*in\s+(?:to|at)\s+/i;

/** "Check in to the Thamel hotel" -> "the Thamel hotel". */
export function stayName(item: ItineraryItem): string {
  return item.title.replace(CHECK_IN_PREFIX, '').trim() || item.title;
}

/**
 * Where you sleep on `today`: replay every hotel item up to and including today in order;
 * a check-out clears the stay, anything else sets it. An `endDate` stay lapses after that day.
 */
export function selectTonightsStay(
  itemsOn: (date: string) => ItineraryItem[],
  dates: readonly string[],
  today: string,
): ItineraryItem | null {
  let stay: ItineraryItem | null = null;
  for (const date of [...dates].sort()) {
    if (date > today) break;
    const hotels = itemsOn(date)
      .filter((it) => it.category === 'hotel' && it.deleted !== true)
      .sort((a, b) => (effectiveStartMinutes(a) ?? 0) - (effectiveStartMinutes(b) ?? 0));
    for (const it of hotels) stay = CHECK_OUT.test(it.title) ? null : it;
  }
  return stay?.endDate && today > stay.endDate ? null : stay;
}
