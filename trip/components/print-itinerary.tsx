'use client';

import { useItineraryContext } from '@/components/itinerary-provider';
import PrintButton from '@/components/print-button';
import { getActiveTrip, isDefaultTrip } from '@/core/trips';
import { JOURNEYS, BOOKED_STAYS } from '@/lib/booking-data';
import { describeItemTime } from '@/lib/item-time-display';
import { dayPlaceLabel } from '@/lib/leg-label';
import { groupItemsByPhase } from '@/lib/phase-of-day';
import { TRIP_DATES, TRIP_DATE_LABEL, formatDateLong } from '@/lib/trip-data';

/**
 * PrintItinerary — the whole trip on paper (issue #223), plus the button that gets it
 * there. Mounted on /plan; `display: none` at `screen`, `display: block` at `print`.
 *
 * WHY A PRINT-ONLY RENDER INSTEAD OF RESTYLING THE PLANNER. `calendar-planner.tsx` shows
 * exactly ONE day at a time — that is its whole design (a month grid plus a day-detail
 * column, `selectedDate`), and it is what makes it good at editing. Restyled for paper it
 * would print a calendar and a single day, which is not the artefact anybody wants in a
 * passport pocket. So /plan hides the planner in print and prints this instead: the same
 * store, read straight through `getDayPlan` for every trip date, so the sheet can never
 * disagree with the screen. Item order is `groupItemsByPhase`, the SAME derivation the
 * planner renders — never a re-sort, so the manual drag order survives onto the page.
 *
 * THE BOOKINGS BLOCK is here rather than on a print-styled /flights because a traveller
 * carries ONE piece of paper, not three, and "proof of onward travel" is only proof if it
 * is attached to the itinerary it belongs to. It reads the same static
 * `lib/booking-data.ts` /flights does — no second source — and is gated on
 * `isDefaultTrip()` for the same reason `DefaultTripOnly` gates /flights itself: a custom
 * trip must not print another trip's flight numbers.
 *
 * SSR: mounted through `dynamic(ssr:false)` (app/plan/sections.tsx). The store's value is
 * a localStorage read, so a server render would emit the seed pack and hydration would
 * fight it — the same reason every other island on this route is ssr:false.
 */
export default function PrintItinerary() {
  const { getDayPlan } = useItineraryContext();
  const days = TRIP_DATES.map((date) => getDayPlan(date));

  return (
    <>
      <div className="mx-auto flex w-full max-w-[1200px] justify-end px-gut pb-2 print:hidden">
        <PrintButton label="Print itinerary" />
      </div>

      <section className="print-sheet hidden print:block" data-testid="print-itinerary">
        <header className="print-head">
          {/* The pack's own label. Every other value on this sheet is active-pack derived, so a
              hardcoded title printed a custom trip's real dates and days under someone else's
              trip name — the same leak class the bookings block below is gated against. */}
          <h2>{getActiveTrip().label} — day by day</h2>
          <p className="print-meta">
            {TRIP_DATE_LABEL} · {days.length} days
          </p>
        </header>

        {isDefaultTrip() && (
          <section className="print-block">
            <h3>Bookings</h3>
            <table className="print-table">
              <caption className="sr-only">Booked flights, in departure order</caption>
              <thead>
                <tr>
                  <th scope="col">Flight</th>
                  <th scope="col">Route</th>
                  <th scope="col">Departs</th>
                  <th scope="col">Arrives</th>
                </tr>
              </thead>
              <tbody>
                {JOURNEYS.flatMap((journey) => journey.legs).map((leg) => (
                  <tr key={leg.id}>
                    <td>{leg.flightNumber}</td>
                    <td>
                      {leg.fromCode} → {leg.toCode}
                    </td>
                    {/* `departLabel` / `arriveLabel` are rendered VERBATIM from the
                        booking, never recomputed — see lib/booking-data.ts on why the
                        date-line-crossing legs must not be re-derived. */}
                    <td>{leg.departLabel}</td>
                    <td>{leg.arriveLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <ul>
              {BOOKED_STAYS.map((stay) => (
                <li key={stay.id} className="print-item">
                  <span className="print-time">{stay.city}</span>
                  <span className="print-what">
                    <span>{stay.name}</span>
                    <span className="print-sub">{stay.address ?? stay.area ?? stay.city}</span>
                    {stay.checkIn && (
                      <span className="print-sub">
                        {stay.checkIn}
                        {stay.checkOut ? ` – ${stay.checkOut}` : ''}
                        {stay.note ? ` · ${stay.note}` : ''}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {days.map((day, i) => {
          // A leg change starts a fresh sheet (`break-before: page`), so Nepal and Japan
          // come off the printer as two documents. `country` is the LEG id, which is
          // 'main' for the whole of a custom trip — one leg, so no break ever fires and a
          // custom trip prints continuously. That is the right answer, not a fallback.
          const legStart = i > 0 && day.country !== days[i - 1].country;
          const items = groupItemsByPhase(day.items ?? []).map((g) => g.item);

          return (
            <section
              key={day.date}
              className="print-day"
              data-leg-start={legStart ? 'true' : undefined}
            >
              <h3 className="print-day-head">
                <span className="print-day-n">Day {i + 1}</span>
                <span>{formatDateLong(day.date)}</span>
                <span className="print-meta">{dayPlaceLabel(day)}</span>
              </h3>

              {items.length === 0 ? (
                <p className="print-empty">Nothing planned.</p>
              ) : (
                <ul>
                  {items.map((item) => {
                    const when = describeItemTime(item, day.date);
                    return (
                      <li key={item.id} className="print-item">
                        {/* An em dash, not an empty cell: a blank there reads as a
                            printing fault rather than as "no time set". */}
                        <span className="print-time">
                          {when ? `${when.label}${when.badge ? ` ${when.badge}` : ''}` : '—'}
                        </span>
                        <span className="print-what">
                          <span>{item.title}</span>
                          {item.endDate && (
                            <span className="print-sub">through {formatDateLong(item.endDate)}</span>
                          )}
                          {item.location && <span className="print-sub">{item.location}</span>}
                          {item.notes && <span className="print-sub">{item.notes}</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </section>
    </>
  );
}
