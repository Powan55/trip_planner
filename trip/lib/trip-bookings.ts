import type { ItineraryItem } from '@/lib/trip-data';
import { effectiveStartMinutes } from '@/core/dates';

export interface TripBooking {
  date: string;
  item: ItineraryItem;
}

/** Travel and hotel items across the trip, by date then start time. A booking is just an itinerary item. */
export function selectTripBookings(
  itemsOn: (date: string) => ItineraryItem[],
  dates: readonly string[],
): TripBooking[] {
  const out: TripBooking[] = [];
  for (const date of [...dates].sort()) {
    const day = itemsOn(date)
      .filter((it) => (it.category === 'transportation' || it.category === 'hotel') && it.deleted !== true)
      .sort((a, b) => (effectiveStartMinutes(a) ?? 0) - (effectiveStartMinutes(b) ?? 0));
    for (const item of day) out.push({ date, item });
  }
  return out;
}
