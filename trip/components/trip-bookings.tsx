'use client';

import { useItineraryContext } from '@/components/itinerary-provider';
import { TRIP_DATES, formatDate } from '@/lib/trip-data';
import { selectTripBookings } from '@/lib/trip-bookings';
import { withBasePath } from '@/lib/base-path';

/** /flights body on a custom trip: its travel and hotel itinerary items, plus the way to add more. */
export default function TripBookings() {
  const { getDayPlan, hydrated } = useItineraryContext();
  const bookings = hydrated ? selectTripBookings((d) => getDayPlan(d).items, TRIP_DATES) : [];

  return (
    <section
      aria-labelledby="trip-bookings-title"
      data-testid="trip-bookings"
      className="mx-auto max-w-2xl px-4 pb-16 pt-[calc(var(--nav-h)+2rem)] sm:px-6"
    >
      <h1 id="trip-bookings-title" className="pr">Flights and stays</h1>
      {bookings.length === 0 ? (
        <p className="empty mt-3">
          Nothing booked yet. Add a flight as a Transportation item and a stay as a Hotel item.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-[color:var(--border-ui)]">
          {bookings.map(({ date, item }) => (
            <li key={`${date}:${item.id}`} className="py-3">
              <p className="pr pr--lo">
                {formatDate(date)} · {item.category === 'hotel' ? 'Stay' : 'Travel'}
              </p>
              <p className="mt-1 text-t-body font-semibold leading-snug text-ink-hi">{item.title}</p>
              {item.location && <p className="pr pr--lo mt-1">{item.location}</p>}
            </li>
          ))}
        </ul>
      )}
      <a
        href={withBasePath('/plan/')}
        className="pr mt-6 inline-flex min-h-tap items-center rounded-r1 border border-[color:hsl(var(--accent))] px-4 text-[color:hsl(var(--accent))] outline-none transition-colors hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-ring"
      >
        Add in the planner
      </a>
    </section>
  );
}
